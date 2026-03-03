import { ChildProcess, spawn } from 'child_process';
import { getDb } from './DatabaseService';
import { motionDetector } from './MotionDetector';

// --- Types ---

export type StreamStatus = 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'error';

interface StreamInstance {
  cameraId: string;
  process: ChildProcess | null;
  status: StreamStatus;
  fps: number;
  frameCount: number;
  lastFrameTime: number;
  restartCount: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  frameBuffer: Buffer;
  frameOffset: number;
  analysisFrameCount: number;
}

interface CameraRow {
  id: string;
  label: string;
  ip_address: string;
  rtsp_sub_url: string | null;
  rtsp_url: string;
  enabled: number;
}

// --- Constants ---

// Sub-stream dimensions: 720p for AI pipeline (reduced from 1080p main stream)
// go2rtc re-streams the camera's sub-stream at rtsp://127.0.0.1:8554/<name>_sub
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const BYTES_PER_PIXEL = 3; // RGB24
const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT * BYTES_PER_PIXEL;

// AI pipeline FPS: configurable 10-15fps. Lower = less CPU/GPU pressure.
// Display is handled by WebRTC (go2rtc) — no FFmpeg display stream needed.
const AI_PIPELINE_FPS = 12;

const MAX_RESTART_COUNT = 10;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;

const FPS_SAMPLE_INTERVAL_MS = 2000;

// Route every Nth frame to AI/MotionDetector at ~10fps from AI_PIPELINE_FPS source
// e.g. AI_PIPELINE_FPS=12, ANALYSIS_INTERVAL=1 → 12fps to AI (full rate)
const ANALYSIS_FRAME_INTERVAL = 1;

// --- StreamManager ---

class StreamManager {
  private streams: Map<string, StreamInstance> = new Map();
  private fpsInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start AI sub-stream decoding for a camera by ID.
   * Reads rtsp_sub_url from DB (go2rtc re-stream), spawns FFmpeg at 720p,
   * and routes frames to the AI pipeline. Display is handled by WebRTC.
   */
  startStream(cameraId: string): void {
    if (this.streams.has(cameraId)) {
      const existing = this.streams.get(cameraId)!;
      if (existing.status === 'connected' || existing.status === 'starting') {
        console.log(`[StreamManager] Stream for ${cameraId} already active.`);
        return;
      }
      // If in error/reconnecting state, clean up before restart
      this.cleanupStreamProcess(cameraId);
    }

    const rtspUrl = this.buildSubStreamRtspUrl(cameraId);
    if (!rtspUrl) {
      console.error(`[StreamManager] Cannot start AI stream for ${cameraId}: no sub-stream URL found.`);
      return;
    }

    const instance: StreamInstance = {
      cameraId,
      process: null,
      status: 'starting',
      fps: 0,
      frameCount: 0,
      lastFrameTime: Date.now(),
      restartCount: 0,
      restartTimer: null,
      frameBuffer: Buffer.alloc(FRAME_SIZE),
      frameOffset: 0,
      analysisFrameCount: 0,
    };

    this.streams.set(cameraId, instance);
    this.spawnFfmpeg(instance, rtspUrl);
    this.ensureFpsMonitor();

    console.log(`[StreamManager] Starting AI sub-stream for ${cameraId} → ${rtspUrl} at ${AI_PIPELINE_FPS}fps`);
  }

  /**
   * Stop a single camera stream gracefully.
   */
  stopStream(cameraId: string): void {
    const instance = this.streams.get(cameraId);
    if (!instance) {
      console.log(`[StreamManager] No active stream for ${cameraId}.`);
      return;
    }

    this.cleanupStreamProcess(cameraId);
    this.streams.delete(cameraId);
    console.log(`[StreamManager] Stopped stream for ${cameraId}.`);
  }

  /**
   * Stop all active camera streams.
   */
  stopAll(): void {
    for (const cameraId of this.streams.keys()) {
      this.cleanupStreamProcess(cameraId);
    }
    this.streams.clear();

    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }

    console.log('[StreamManager] All streams stopped.');
  }

  /**
   * Get the current status of all streams.
   */
  getStatuses(): Array<{ cameraId: string; status: StreamStatus; fps: number }> {
    const statuses: Array<{ cameraId: string; status: StreamStatus; fps: number }> = [];
    for (const [cameraId, instance] of this.streams) {
      statuses.push({ cameraId, status: instance.status, fps: instance.fps });
    }
    return statuses;
  }

  /**
   * Get status for a specific camera.
   */
  getStatus(cameraId: string): { status: StreamStatus; fps: number } {
    const instance = this.streams.get(cameraId);
    if (!instance) {
      return { status: 'stopped', fps: 0 };
    }
    return { status: instance.status, fps: instance.fps };
  }

  // --- Private: FFmpeg Process Management ---

  private spawnFfmpeg(instance: StreamInstance, rtspUrl: string): void {
    const args = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${FRAME_WIDTH}x${FRAME_HEIGHT}`,
      '-r', String(AI_PIPELINE_FPS),
      '-an',
      '-loglevel', 'error',
      'pipe:1',
    ];

    try {
      const ffmpegProcess = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      instance.process = ffmpegProcess;

      ffmpegProcess.stdout!.on('data', (chunk: Buffer) => {
        this.handleFrameData(instance, chunk);
      });

      ffmpegProcess.stderr!.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message.length > 0) {
          console.error(`[StreamManager][${instance.cameraId}] FFmpeg stderr: ${message}`);
        }
      });

      ffmpegProcess.on('error', (error: Error) => {
        console.error(`[StreamManager][${instance.cameraId}] FFmpeg process error: ${error.message}`);
        instance.status = 'error';
        this.scheduleRestart(instance, rtspUrl);
      });

      ffmpegProcess.on('close', (code: number | null) => {
        if (instance.status === 'stopped') {
          return; // Intentional stop, no restart
        }

        console.warn(`[StreamManager][${instance.cameraId}] FFmpeg exited with code ${code}.`);
        instance.status = 'reconnecting';
        instance.process = null;
        this.scheduleRestart(instance, rtspUrl);
      });

      // Mark as connected once we receive the first frame
      instance.status = 'starting';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[StreamManager][${instance.cameraId}] Failed to spawn FFmpeg: ${errorMessage}`);
      instance.status = 'error';
    }
  }

  private handleFrameData(instance: StreamInstance, chunk: Buffer): void {
    let offset = 0;

    while (offset < chunk.length) {
      const remaining = FRAME_SIZE - instance.frameOffset;
      const available = chunk.length - offset;
      const toCopy = Math.min(remaining, available);

      chunk.copy(instance.frameBuffer, instance.frameOffset, offset, offset + toCopy);
      instance.frameOffset += toCopy;
      offset += toCopy;

      if (instance.frameOffset === FRAME_SIZE) {
        // Complete frame received
        if (instance.status === 'starting' || instance.status === 'reconnecting') {
          instance.status = 'connected';
          instance.restartCount = 0;
          console.log(`[StreamManager][${instance.cameraId}] Sub-stream connected (${FRAME_WIDTH}x${FRAME_HEIGHT} @ ${AI_PIPELINE_FPS}fps).`);
        }

        instance.frameCount++;
        instance.lastFrameTime = Date.now();

        // Route frames to AI pipeline (MotionDetector until Task 4.0 replaces with YOLO)
        // Display is handled by WebRTC — no stream:frame IPC needed here
        instance.analysisFrameCount++;
        if (instance.analysisFrameCount >= ANALYSIS_FRAME_INTERVAL) {
          instance.analysisFrameCount = 0;
          motionDetector.processFrame(instance.cameraId, Buffer.from(instance.frameBuffer));
        }

        // Allocate a new buffer for the next frame
        instance.frameBuffer = Buffer.alloc(FRAME_SIZE);
        instance.frameOffset = 0;
      }
    }
  }

  // --- Private: Restart Logic ---

  private scheduleRestart(instance: StreamInstance, rtspUrl: string): void {
    if (instance.restartCount >= MAX_RESTART_COUNT) {
      console.error(`[StreamManager][${instance.cameraId}] Max restart attempts (${MAX_RESTART_COUNT}) reached. Giving up.`);
      instance.status = 'error';
      return;
    }

    const backoffMs = Math.min(
      RESTART_BACKOFF_BASE_MS * Math.pow(2, instance.restartCount),
      RESTART_BACKOFF_MAX_MS
    );

    console.log(`[StreamManager][${instance.cameraId}] Restarting in ${backoffMs}ms (attempt ${instance.restartCount + 1}/${MAX_RESTART_COUNT}).`);

    instance.restartTimer = setTimeout(() => {
      instance.restartCount++;
      instance.frameOffset = 0;
      this.spawnFfmpeg(instance, rtspUrl);
    }, backoffMs);
  }

  // --- Private: Cleanup ---

  private cleanupStreamProcess(cameraId: string): void {
    const instance = this.streams.get(cameraId);
    if (!instance) {
      return;
    }

    instance.status = 'stopped';

    if (instance.restartTimer) {
      clearTimeout(instance.restartTimer);
      instance.restartTimer = null;
    }

    if (instance.process) {
      try {
        instance.process.kill('SIGTERM');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[StreamManager][${cameraId}] Error killing FFmpeg process: ${errorMessage}`);
      }
      instance.process = null;
    }
  }

  // --- Private: RTSP URL Construction ---

  /**
   * Get the sub-stream RTSP URL for a camera (720p AI pipeline feed).
   * Reads rtsp_sub_url from DB — these point to go2rtc's re-streamed RTSP
   * (rtsp://127.0.0.1:8554/<name>_sub) so go2rtc handles camera reconnection.
   * Falls back to rtsp_url if no sub-stream URL is configured.
   */
  private buildSubStreamRtspUrl(cameraId: string): string | null {
    try {
      const row = getDb()
        .prepare('SELECT id, ip_address, rtsp_sub_url, rtsp_url, enabled FROM cameras WHERE id = ?')
        .get(cameraId) as CameraRow | undefined;

      if (!row) {
        console.error(`[StreamManager] Camera ${cameraId} not found in database.`);
        return null;
      }

      if (!row.enabled) {
        console.warn(`[StreamManager] Camera ${cameraId} is disabled.`);
        return null;
      }

      // Prefer the sub-stream URL (720p via go2rtc re-stream)
      if (row.rtsp_sub_url && row.rtsp_sub_url.startsWith('rtsp://')) {
        return row.rtsp_sub_url;
      }

      // Fallback to main stream URL if no sub-stream configured
      if (row.rtsp_url && row.rtsp_url.startsWith('rtsp://')) {
        console.warn(`[StreamManager] No sub-stream URL for ${cameraId}, falling back to main stream.`);
        return row.rtsp_url;
      }

      console.error(`[StreamManager] No usable RTSP URL for ${cameraId}.`);
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[StreamManager] Failed to read camera config for ${cameraId}: ${errorMessage}`);
      return null;
    }
  }

  // --- Private: FPS Monitor ---

  private ensureFpsMonitor(): void {
    if (this.fpsInterval) {
      return;
    }

    this.fpsInterval = setInterval(() => {
      for (const instance of this.streams.values()) {
        // Calculate FPS from frame count over the sample interval
        instance.fps = Math.round((instance.frameCount / FPS_SAMPLE_INTERVAL_MS) * 1000);
        instance.frameCount = 0;
      }
    }, FPS_SAMPLE_INTERVAL_MS);
  }
}

// Singleton export
export const streamManager = new StreamManager();
