/**
 * RecordingService — manages continuous/event-triggered MP4 recording per camera.
 *
 * Responsibilities:
 * - Start/stop recording per camera using FFmpeg to capture from go2rtc RTSP
 * - Segment management: split by configurable duration (default 15 min)
 * - Track segments in `recording_segments` DB table
 * - Retention cleanup: delete segments older than `recording_retention_days`
 * - Recording modes: `continuous`, `event_triggered`, `off`
 * - Disk usage tracking per camera
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
import { getMainStreamRtspUrl } from './Go2RtcService';
import {
  getSetting,
  createRecordingSegment,
  getRecordingSegments,
} from './DatabaseService';

export type RecordingMode = 'continuous' | 'event_triggered' | 'off';
export type RecordingStatus = 'recording' | 'stopped' | 'error';

interface CameraRecordingState {
  status: RecordingStatus;
  mode: RecordingMode;
  ffmpegProcess: ChildProcess | null;
  currentSegmentId: string | null;
  currentSegmentPath: string | null;
  segmentStartTime: Date | null;
  segmentTimer: ReturnType<typeof setTimeout> | null;
  errorMessage: string | null;
}

const cameraStates = new Map<string, CameraRecordingState>();
let retentionInterval: ReturnType<typeof setInterval> | null = null;

function getDefaultStoragePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'recordings');
}

function getStoragePath(): string {
  const customPath = getSetting('recording_storage_path');
  if (customPath && customPath.trim().length > 0) {
    return customPath.trim();
  }
  return getDefaultStoragePath();
}

function getSegmentDurationMs(): number {
  const minStr = getSetting('recording_segment_duration_min');
  const min = parseInt(minStr || '15', 10);
  return Math.max(1, min) * 60 * 1000;
}

function getRetentionDays(): number {
  const daysStr = getSetting('recording_retention_days');
  return parseInt(daysStr || '30', 10);
}

function getRecordingMode(): RecordingMode {
  const mode = getSetting('recording_mode') as RecordingMode;
  if (mode === 'continuous' || mode === 'event_triggered' || mode === 'off') {
    return mode;
  }
  return 'event_triggered';
}

function ensureStorageDir(cameraId: string): string {
  const base = getStoragePath();
  const camDir = path.join(base, cameraId);
  if (!fs.existsSync(camDir)) {
    fs.mkdirSync(camDir, { recursive: true });
  }
  return camDir;
}

function getOrCreateState(cameraId: string): CameraRecordingState {
  let state = cameraStates.get(cameraId);
  if (!state) {
    state = {
      status: 'stopped',
      mode: 'off',
      ffmpegProcess: null,
      currentSegmentId: null,
      currentSegmentPath: null,
      segmentStartTime: null,
      segmentTimer: null,
      errorMessage: null,
    };
    cameraStates.set(cameraId, state);
  }
  return state;
}

function generateSegmentFilename(cameraId: string, startTime: Date): string {
  const ts = startTime.toISOString().replace(/[:.]/g, '-');
  return `${cameraId}_${ts}.mp4`;
}

function finalizeSegment(cameraId: string): void {
  const state = cameraStates.get(cameraId);
  if (!state || !state.currentSegmentId || !state.segmentStartTime || !state.currentSegmentPath) {
    return;
  }

  const endTime = new Date();
  const durationSec = Math.round((endTime.getTime() - state.segmentStartTime.getTime()) / 1000);

  let fileSizeBytes: number | undefined;
  try {
    if (fs.existsSync(state.currentSegmentPath)) {
      const stats = fs.statSync(state.currentSegmentPath);
      fileSizeBytes = stats.size;
    }
  } catch {
    /* ignore */
  }

  try {
    createRecordingSegment({
      id: state.currentSegmentId,
      cameraId,
      filePath: state.currentSegmentPath,
      startTime: state.segmentStartTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSec,
      fileSizeBytes,
      format: 'mp4',
      recordingMode: state.mode,
    });
    console.log(
      `[RecordingService] Segment finalized: ${state.currentSegmentId} (${durationSec}s, ${fileSizeBytes ?? 0} bytes)`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RecordingService] Failed to save segment to DB: ${msg}`);
  }

  state.currentSegmentId = null;
  state.currentSegmentPath = null;
  state.segmentStartTime = null;
}

function killFfmpeg(state: CameraRecordingState): void {
  if (state.ffmpegProcess) {
    try {
      state.ffmpegProcess.stdin?.write('q');
      state.ffmpegProcess.stdin?.end();
    } catch {
      try {
        state.ffmpegProcess.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    state.ffmpegProcess = null;
  }
}

function startSegment(cameraId: string): void {
  const state = getOrCreateState(cameraId);

  // Finalize any existing segment
  if (state.currentSegmentId) {
    killFfmpeg(state);
    finalizeSegment(cameraId);
  }

  const rtspUrl = getMainStreamRtspUrl(cameraId);
  if (!rtspUrl) {
    console.error(`[RecordingService] No RTSP URL for camera ${cameraId}`);
    state.status = 'error';
    state.errorMessage = 'No RTSP stream URL configured';
    return;
  }

  const storageDir = ensureStorageDir(cameraId);
  const startTime = new Date();
  const segmentId = crypto.randomUUID();
  const filename = generateSegmentFilename(cameraId, startTime);
  const filePath = path.join(storageDir, filename);

  state.currentSegmentId = segmentId;
  state.currentSegmentPath = filePath;
  state.segmentStartTime = startTime;

  try {
    const ffmpeg = spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c', 'copy',
      '-movflags', '+frag_keyframe+empty_moov+faststart',
      '-f', 'mp4',
      '-y',
      filePath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    state.ffmpegProcess = ffmpeg;
    state.status = 'recording';
    state.errorMessage = null;

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line && (line.includes('error') || line.includes('Error'))) {
        console.error(`[RecordingService][${cameraId}] FFmpeg: ${line}`);
      }
    });

    ffmpeg.on('error', (error: Error) => {
      console.error(`[RecordingService][${cameraId}] FFmpeg error: ${error.message}`);
      state.status = 'error';
      state.errorMessage = error.message;
      state.ffmpegProcess = null;
    });

    ffmpeg.on('close', (code: number | null) => {
      if (state.status === 'recording') {
        finalizeSegment(cameraId);
        if (code !== 0 && state.mode !== 'off') {
          console.warn(`[RecordingService][${cameraId}] FFmpeg exited (code ${code}), will restart segment.`);
          state.ffmpegProcess = null;
          // Auto-restart segment after brief delay
          setTimeout(() => {
            if (state.mode !== 'off' && state.status !== 'stopped') {
              startSegment(cameraId);
            }
          }, 2000);
        }
      }
    });

    // Schedule segment rotation
    const segmentDurationMs = getSegmentDurationMs();
    state.segmentTimer = setTimeout(() => {
      if (state.status === 'recording' && state.mode !== 'off') {
        console.log(`[RecordingService][${cameraId}] Rotating segment (${segmentDurationMs / 60000} min)`);
        startSegment(cameraId);
      }
    }, segmentDurationMs);

    console.log(
      `[RecordingService][${cameraId}] Recording started: ${filename} (mode: ${state.mode})`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RecordingService][${cameraId}] Failed to start FFmpeg: ${msg}`);
    state.status = 'error';
    state.errorMessage = msg;
  }
}

/**
 * Start recording for a camera.
 */
export function startRecording(cameraId: string, mode?: RecordingMode): void {
  if (!cameraId) {
    throw new Error('cameraId is required.');
  }

  const state = getOrCreateState(cameraId);
  state.mode = mode ?? getRecordingMode();

  if (state.mode === 'off') {
    console.log(`[RecordingService][${cameraId}] Recording mode is 'off', not starting.`);
    return;
  }

  if (state.status === 'recording') {
    console.log(`[RecordingService][${cameraId}] Already recording.`);
    return;
  }

  startSegment(cameraId);
}

/**
 * Stop recording for a camera.
 */
export function stopRecording(cameraId: string): void {
  const state = cameraStates.get(cameraId);
  if (!state) return;

  if (state.segmentTimer) {
    clearTimeout(state.segmentTimer);
    state.segmentTimer = null;
  }

  killFfmpeg(state);
  finalizeSegment(cameraId);

  state.status = 'stopped';
  state.mode = 'off';
  console.log(`[RecordingService][${cameraId}] Recording stopped.`);
}

/**
 * Get recording status for a camera.
 */
export function getRecordingStatus(cameraId: string): {
  status: RecordingStatus;
  mode: RecordingMode;
  currentSegmentId: string | null;
  segmentStartTime: string | null;
  error: string | null;
} {
  const state = cameraStates.get(cameraId);
  if (!state) {
    return {
      status: 'stopped',
      mode: 'off',
      currentSegmentId: null,
      segmentStartTime: null,
      error: null,
    };
  }
  return {
    status: state.status,
    mode: state.mode,
    currentSegmentId: state.currentSegmentId,
    segmentStartTime: state.segmentStartTime?.toISOString() ?? null,
    error: state.errorMessage,
  };
}

/**
 * Get all recording statuses.
 */
export function getAllRecordingStatuses(): Record<
  string,
  { status: RecordingStatus; mode: RecordingMode }
> {
  const result: Record<string, { status: RecordingStatus; mode: RecordingMode }> = {};
  for (const [cameraId, state] of cameraStates) {
    result[cameraId] = { status: state.status, mode: state.mode };
  }
  return result;
}

/**
 * List recording segments for a camera within a time range.
 */
export function listSegments(
  cameraId: string,
  from: string,
  to: string
): unknown[] {
  return getRecordingSegments(cameraId, from, to);
}

/**
 * Get the file path for a recording segment (for playback).
 * Returns null if segment file doesn't exist.
 */
export function getSegmentFilePath(segmentId: string): string | null {
  // We need to look up the segment in DB — import getDb for this query
  try {
    const { getDb } = require('./DatabaseService');
    const row = getDb()
      .prepare('SELECT file_path FROM recording_segments WHERE id = ?')
      .get(segmentId) as { file_path: string } | undefined;

    if (!row) return null;

    if (fs.existsSync(row.file_path)) {
      return row.file_path;
    }
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RecordingService] Failed to look up segment ${segmentId}: ${msg}`);
    return null;
  }
}

/**
 * Get disk usage for recordings storage.
 */
export function getDiskUsage(): {
  totalBytes: number;
  perCamera: Record<string, number>;
} {
  const base = getStoragePath();
  const perCamera: Record<string, number> = {};
  let totalBytes = 0;

  if (!fs.existsSync(base)) {
    return { totalBytes: 0, perCamera };
  }

  try {
    const cameraDirs = fs.readdirSync(base);
    for (const dir of cameraDirs) {
      const camPath = path.join(base, dir);
      const stat = fs.statSync(camPath);
      if (!stat.isDirectory()) continue;

      let camBytes = 0;
      const files = fs.readdirSync(camPath);
      for (const file of files) {
        try {
          const fileStat = fs.statSync(path.join(camPath, file));
          if (fileStat.isFile()) {
            camBytes += fileStat.size;
          }
        } catch {
          /* ignore */
        }
      }

      perCamera[dir] = camBytes;
      totalBytes += camBytes;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RecordingService] Error calculating disk usage: ${msg}`);
  }

  return { totalBytes, perCamera };
}

/**
 * Run retention cleanup — delete segments and files older than retention days.
 */
export function runRetentionCleanup(): { deletedSegments: number; freedBytes: number } {
  const retentionDays = getRetentionDays();
  if (retentionDays <= 0) {
    return { deletedSegments: 0, freedBytes: 0 };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffStr = cutoffDate.toISOString();

  let deletedSegments = 0;
  let freedBytes = 0;

  try {
    const { getDb } = require('./DatabaseService');
    const oldSegments = getDb()
      .prepare('SELECT id, file_path, file_size_bytes FROM recording_segments WHERE end_time < ?')
      .all(cutoffStr) as Array<{ id: string; file_path: string; file_size_bytes: number | null }>;

    for (const seg of oldSegments) {
      // Delete file
      try {
        if (fs.existsSync(seg.file_path)) {
          const stat = fs.statSync(seg.file_path);
          fs.unlinkSync(seg.file_path);
          freedBytes += stat.size;
        }
      } catch {
        /* ignore file deletion errors */
      }

      // Delete DB record
      try {
        getDb().prepare('DELETE FROM recording_segments WHERE id = ?').run(seg.id);
        deletedSegments++;
      } catch {
        /* ignore */
      }
    }

    if (deletedSegments > 0) {
      console.log(
        `[RecordingService] Retention cleanup: ${deletedSegments} segments deleted, ${(freedBytes / 1024 / 1024).toFixed(1)} MB freed`
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RecordingService] Retention cleanup error: ${msg}`);
  }

  return { deletedSegments, freedBytes };
}

/**
 * Start retention cleanup interval (runs every hour).
 */
export function startRetentionCleanup(): void {
  if (retentionInterval) return;
  const HOUR_MS = 60 * 60 * 1000;
  retentionInterval = setInterval(() => {
    runRetentionCleanup();
  }, HOUR_MS);
  console.log('[RecordingService] Retention cleanup scheduled (hourly).');
}

/**
 * Stop retention cleanup interval.
 */
export function stopRetentionCleanup(): void {
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }
}

/**
 * Stop all recordings (used during app shutdown).
 */
export function stopAllRecordings(): void {
  for (const [cameraId] of cameraStates) {
    stopRecording(cameraId);
  }
  stopRetentionCleanup();
  console.log('[RecordingService] All recordings stopped.');
}
