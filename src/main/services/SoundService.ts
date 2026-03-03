/**
 * SoundService — extracts audio from camera RTSP streams and sends to
 * the Python sidecar for sound event classification.
 *
 * Responsibilities:
 * - Extract audio from camera RTSP streams via FFmpeg
 * - Buffer audio segments (1-2 seconds)
 * - Send audio to sidecar POST /sound/classify endpoint
 * - Emit sound:event IPC for detected events
 * - Create events records with sound_event_type and sound_confidence
 */

import { ChildProcess, spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { getMainStreamRtspUrl } from './Go2RtcService';
import { getSetting } from './DatabaseService';

export type SoundServiceStatus = 'stopped' | 'running' | 'error';

interface CameraAudioState {
  ffmpegProcess: ChildProcess | null;
  status: SoundServiceStatus;
  audioBuffer: Buffer[];
  bufferStartTime: number;
  errorMessage: string | null;
}

const cameraStates = new Map<string, CameraAudioState>();
let classifyInterval: ReturnType<typeof setInterval> | null = null;

const SIDECAR_BASE_URL = 'http://127.0.0.1:8520';
const AUDIO_BUFFER_DURATION_MS = 2_000;
const CLASSIFY_INTERVAL_MS = 2_000;
const AUDIO_SAMPLE_RATE = 16000;

function isSoundEnabled(): boolean {
  return getSetting('sound_detection_enabled') !== 'false';
}

function getConfidenceThreshold(): number {
  const val = getSetting('sound_confidence_threshold');
  return parseFloat(val || '0.3');
}

function getTargetClasses(): string[] {
  const val = getSetting('sound_event_types');
  if (!val) return ['glass_break', 'gunshot', 'scream', 'dog_bark', 'horn'];
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function getOrCreateState(cameraId: string): CameraAudioState {
  let state = cameraStates.get(cameraId);
  if (!state) {
    state = {
      ffmpegProcess: null,
      status: 'stopped',
      audioBuffer: [],
      bufferStartTime: 0,
      errorMessage: null,
    };
    cameraStates.set(cameraId, state);
  }
  return state;
}

/**
 * Start audio extraction for a camera.
 */
export function startAudioCapture(cameraId: string): void {
  if (!cameraId) return;
  if (!isSoundEnabled()) return;

  const state = getOrCreateState(cameraId);
  if (state.status === 'running') return;

  const rtspUrl = getMainStreamRtspUrl(cameraId);
  if (!rtspUrl) {
    console.warn(`[SoundService][${cameraId}] No RTSP URL, cannot start audio capture.`);
    return;
  }

  try {
    // Extract audio from RTSP stream, output as raw PCM float32 at 16kHz mono
    const ffmpeg = spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-vn',                    // No video
      '-acodec', 'pcm_f32le',  // Raw float32 little-endian
      '-ar', String(AUDIO_SAMPLE_RATE),
      '-ac', '1',               // Mono
      '-f', 'f32le',            // Raw format
      'pipe:1',                 // Output to stdout
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    state.ffmpegProcess = ffmpeg;
    state.status = 'running';
    state.audioBuffer = [];
    state.bufferStartTime = Date.now();
    state.errorMessage = null;

    ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      state.audioBuffer.push(chunk);
    });

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line && line.includes('error')) {
        console.error(`[SoundService][${cameraId}] FFmpeg: ${line}`);
      }
    });

    ffmpeg.on('error', (error: Error) => {
      state.status = 'error';
      state.errorMessage = error.message;
      state.ffmpegProcess = null;
      console.error(`[SoundService][${cameraId}] FFmpeg error: ${error.message}`);
    });

    ffmpeg.on('close', (code: number | null) => {
      if (state.status === 'running') {
        state.status = 'stopped';
        state.ffmpegProcess = null;
        if (code !== 0) {
          console.warn(`[SoundService][${cameraId}] FFmpeg exited with code ${code}`);
        }
      }
    });

    console.log(`[SoundService][${cameraId}] Audio capture started.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    state.status = 'error';
    state.errorMessage = msg;
    console.error(`[SoundService][${cameraId}] Failed to start: ${msg}`);
  }
}

/**
 * Stop audio extraction for a camera.
 */
export function stopAudioCapture(cameraId: string): void {
  const state = cameraStates.get(cameraId);
  if (!state) return;

  if (state.ffmpegProcess) {
    try {
      state.ffmpegProcess.kill('SIGTERM');
    } catch { /* ignore */ }
    state.ffmpegProcess = null;
  }
  state.status = 'stopped';
  state.audioBuffer = [];
  console.log(`[SoundService][${cameraId}] Audio capture stopped.`);
}

/**
 * Process buffered audio for all cameras — send to sidecar for classification.
 */
async function processAudioBuffers(): Promise<void> {
  for (const [cameraId, state] of cameraStates) {
    if (state.status !== 'running' || state.audioBuffer.length === 0) continue;

    const now = Date.now();
    if (now - state.bufferStartTime < AUDIO_BUFFER_DURATION_MS) continue;

    // Collect and reset buffer
    const bufferChunks = state.audioBuffer;
    state.audioBuffer = [];
    state.bufferStartTime = now;

    const audioData = Buffer.concat(bufferChunks);
    if (audioData.length === 0) continue;

    try {
      const audioBase64 = audioData.toString('base64');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(`${SIDECAR_BASE_URL}/sound/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_base64: audioBase64,
          sample_rate: AUDIO_SAMPLE_RATE,
          confidence_threshold: getConfidenceThreshold(),
          target_classes: getTargetClasses(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const result = await response.json() as {
        events: Array<{
          sound_class: string;
          confidence: number;
          start_ms: number;
          end_ms: number;
        }>;
      };

      if (result.events.length > 0) {
        // Emit to renderer
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('sound:event', {
              cameraId,
              events: result.events,
              timestamp: Date.now(),
            });
          }
        }

        console.log(
          `[SoundService][${cameraId}] Detected ${result.events.length} sound events: ${result.events.map((e) => e.sound_class).join(', ')}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('abort')) {
        console.error(`[SoundService][${cameraId}] Classification error: ${msg}`);
      }
    }
  }
}

/**
 * Start the sound service — begins periodic classification.
 */
export function startSoundService(): void {
  if (classifyInterval) return;
  if (!isSoundEnabled()) {
    console.log('[SoundService] Sound detection disabled.');
    return;
  }

  classifyInterval = setInterval(() => {
    processAudioBuffers().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SoundService] Processing error: ${msg}`);
    });
  }, CLASSIFY_INTERVAL_MS);

  console.log('[SoundService] Classification loop started.');
}

/**
 * Stop the sound service and all audio captures.
 */
export function stopSoundService(): void {
  if (classifyInterval) {
    clearInterval(classifyInterval);
    classifyInterval = null;
  }

  for (const [cameraId] of cameraStates) {
    stopAudioCapture(cameraId);
  }
  cameraStates.clear();
  console.log('[SoundService] Stopped.');
}

/**
 * Get sound service status.
 */
export function getSoundServiceStatus(): {
  enabled: boolean;
  activeCameras: number;
} {
  return {
    enabled: isSoundEnabled(),
    activeCameras: Array.from(cameraStates.values()).filter((s) => s.status === 'running').length,
  };
}
