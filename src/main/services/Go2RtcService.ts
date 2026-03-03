/**
 * Go2RtcService — manages the go2rtc RTSP proxy child process.
 *
 * Responsibilities:
 * - Launch go2rtc as a child process before camera streams start
 * - Health check polling (GET /api/streams on :1984)
 * - Auto-restart with backoff on failures
 * - Graceful shutdown on Electron app quit
 * - Provide WebRTC stream URLs and sub-stream RTSP URLs for 4-camera dual-stream setup
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getDb } from './DatabaseService';

export type Go2RtcStatus = 'starting' | 'healthy' | 'unhealthy' | 'stopped';

const GO2RTC_API_PORT = 1984;
const GO2RTC_RTSP_PORT = 8554;
const HEALTH_CHECK_INTERVAL_MS = 5_000;
const STARTUP_TIMEOUT_MS = 10_000;
const MAX_RESTART_ATTEMPTS = 3;
const BACKOFF_SCHEDULE_MS = [3_000, 6_000, 15_000];
const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Derives a go2rtc stream name prefix from a camera ID.
 * e.g. 'CAM-1' → 'cam1', 'CAM-2A' → 'cam2a'
 */
function deriveStreamPrefix(cameraId: string): string {
  return cameraId.toLowerCase().replace(/-/g, '');
}

interface CameraStreamRow {
  id: string;
  ip_address: string;
  model: string | null;
  stream_protocol: string | null;
  stream_username: string | null;
  stream_password: string | null;
  enabled: number;
}

interface Go2RtcState {
  process: ChildProcess | null;
  status: Go2RtcStatus;
  healthCheckInterval: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
  restartAttempts: number;
  isShuttingDown: boolean;
}

const state: Go2RtcState = {
  process: null,
  status: 'stopped',
  healthCheckInterval: null,
  consecutiveFailures: 0,
  restartAttempts: 0,
  isShuttingDown: false,
};

function getGo2RtcDir(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(process.cwd(), 'go2rtc');
  }
  return path.join(process.resourcesPath, 'go2rtc');
}

function getGo2RtcBinary(): string {
  return path.join(getGo2RtcDir(), process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');
}

function getGo2RtcConfig(): string {
  return path.join(getGo2RtcDir(), 'go2rtc.yaml');
}

/**
 * Dynamic config generation is DISABLED.
 * The static go2rtc.yaml (matched to FaceTracker's working config) is used directly.
 * This avoids file-permission and race-condition issues on Windows that were
 * causing the C246D camera to get EOF errors on RTSP connect.
 */
function generateGo2RtcConfig(): void {
  const configPath = getGo2RtcConfig();
  if (fs.existsSync(configPath)) {
    console.log(`[Go2RtcService] Using existing go2rtc.yaml (dynamic generation disabled)`);
    return;
  }
  console.warn('[Go2RtcService] go2rtc.yaml not found — cannot start');
}

function setStatus(newStatus: Go2RtcStatus): void {
  if (state.status !== newStatus) {
    console.log(`[Go2RtcService] Status: ${state.status} → ${newStatus}`);
    state.status = newStatus;
  }
}

async function healthCheck(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const resp = await fetch(`http://127.0.0.1:${GO2RTC_API_PORT}/api/streams`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

function startHealthChecks(): void {
  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
  }

  state.healthCheckInterval = setInterval(async () => {
    const ok = await healthCheck();
    if (ok) {
      state.consecutiveFailures = 0;
      if (state.status !== 'healthy') {
        setStatus('healthy');
      }
    } else {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= 3 && !state.isShuttingDown) {
        console.warn(`[Go2RtcService] ${state.consecutiveFailures} consecutive health check failures. Restarting...`);
        setStatus('unhealthy');
        restartGo2Rtc();
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function restartGo2Rtc(): void {
  if (state.isShuttingDown) return;
  if (state.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.error(`[Go2RtcService] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Giving up.`);
    setStatus('unhealthy');
    return;
  }

  const backoffMs = BACKOFF_SCHEDULE_MS[Math.min(state.restartAttempts, BACKOFF_SCHEDULE_MS.length - 1)];
  state.restartAttempts++;

  console.log(`[Go2RtcService] Restart attempt ${state.restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${backoffMs}ms`);

  killProcess();

  setTimeout(() => {
    if (!state.isShuttingDown) {
      launchProcess();
    }
  }, backoffMs);
}

function killProcess(): void {
  if (state.process) {
    try {
      state.process.kill('SIGTERM');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[Go2RtcService] Error killing process: ${msg}`);
    }
    state.process = null;
  }
}

function launchProcess(): void {
  const binary = getGo2RtcBinary();
  const config = getGo2RtcConfig();

  console.log(`[Go2RtcService] Launching: ${binary} -config ${config}`);

  try {
    const child = spawn(binary, ['-config', config], {
      cwd: getGo2RtcDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    state.process = child;
    setStatus('starting');

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[go2rtc] ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.error(`[go2rtc] ${line}`);
      }
    });

    child.on('error', (error: Error) => {
      console.error(`[Go2RtcService] Process error: ${error.message}`);
      setStatus('unhealthy');
    });

    child.on('close', (code: number | null) => {
      console.log(`[Go2RtcService] Process exited with code ${code}`);
      state.process = null;
      if (!state.isShuttingDown) {
        setStatus('unhealthy');
        restartGo2Rtc();
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Go2RtcService] Failed to spawn: ${msg}`);
    setStatus('unhealthy');
  }
}

/**
 * Start go2rtc and wait until it's healthy or timeout.
 * Returns true if go2rtc is healthy, false otherwise.
 */
export async function startGo2Rtc(): Promise<boolean> {
  if (state.status === 'healthy') {
    console.log('[Go2RtcService] Already running and healthy.');
    return true;
  }

  state.isShuttingDown = false;
  state.restartAttempts = 0;
  state.consecutiveFailures = 0;

  // R2-C8/C9: Generate config from DB before launching
  generateGo2RtcConfig();

  launchProcess();
  startHealthChecks();

  // Wait for healthy status with timeout
  const startTime = Date.now();
  while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
    const ok = await healthCheck();
    if (ok) {
      setStatus('healthy');
      console.log(`[Go2RtcService] Ready. RTSP proxy on :${GO2RTC_RTSP_PORT}, API on :${GO2RTC_API_PORT}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn(`[Go2RtcService] Startup timed out after ${STARTUP_TIMEOUT_MS}ms. Will keep retrying in background.`);
  return false;
}

/**
 * Gracefully stop go2rtc.
 */
export async function stopGo2Rtc(): Promise<void> {
  state.isShuttingDown = true;

  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
    state.healthCheckInterval = null;
  }

  if (!state.process) {
    setStatus('stopped');
    return;
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[Go2RtcService] Shutdown timed out, force killing.');
      try {
        state.process?.kill('SIGKILL');
      } catch { /* ignore */ }
      state.process = null;
      setStatus('stopped');
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    state.process!.once('close', () => {
      clearTimeout(timeout);
      state.process = null;
      setStatus('stopped');
      console.log('[Go2RtcService] Stopped gracefully.');
      resolve();
    });

    killProcess();
  });
}

/**
 * Get current go2rtc status.
 */
export function getGo2RtcStatus(): Go2RtcStatus {
  return state.status;
}

/**
 * Get the go2rtc stream name prefix for a logical camera ID.
 * Returns null if the camera is not in the stream map.
 */
export function getStreamPrefix(cameraId: string): string {
  return deriveStreamPrefix(cameraId);
}

/**
 * Get the WebRTC signaling URL for a camera's display stream.
 * Renderer uses this URL to initiate WebRTC negotiation with go2rtc.
 *
 * C246D dual-lens cameras use sub-streams for display (720p) to stay within
 * the camera's 2 concurrent RTSP session limit (sub-stream shared with AI pipeline).
 * Other cameras use main-streams (1080p) for display.
 *
 * Format: http://127.0.0.1:1984/api/webrtc?src=<streamName>
 */
export function getWebRtcSignalingUrl(cameraId: string): string {
  const prefix = deriveStreamPrefix(cameraId);
  // C246D dual-lens: CAM-2A uses sub (stream2), CAM-2B uses main (stream6)
  // This keeps total RTSP sessions to the camera at 2 (within its limit)
  const suffix = cameraId === 'CAM-2A' ? '_sub' : '_main';
  return `http://127.0.0.1:${GO2RTC_API_PORT}/api/webrtc?src=${prefix}${suffix}`;
}

/**
 * Get the RTSP sub-stream URL for a camera's AI pipeline feed (720p).
 * FFmpeg reads from this URL via go2rtc's re-streaming RTSP server.
 *
 * Format: rtsp://127.0.0.1:8554/<streamName>_sub
 */
export function getSubStreamRtspUrl(cameraId: string): string {
  const prefix = deriveStreamPrefix(cameraId);
  return `rtsp://127.0.0.1:${GO2RTC_RTSP_PORT}/${prefix}_sub`;
}

/**
 * Get the RTSP main stream URL for a camera (1080p, used as fallback).
 */
export function getMainStreamRtspUrl(cameraId: string): string {
  const prefix = deriveStreamPrefix(cameraId);
  return `rtsp://127.0.0.1:${GO2RTC_RTSP_PORT}/${prefix}_main`;
}

/**
 * Check if a specific go2rtc stream is active.
 * Returns true if the stream appears in the /api/streams response.
 */
export async function isStreamActive(streamName: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const resp = await fetch(`http://127.0.0.1:${GO2RTC_API_PORT}/api/streams`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const streams = await resp.json() as Record<string, unknown>;
    return streamName in streams;
  } catch {
    return false;
  }
}

/**
 * Get health status of all 4 camera streams.
 * Returns a map of streamName → boolean (active).
 */
export async function getAllStreamStatuses(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  let cameraPrefixes: string[];
  try {
    const rows = getDb()
      .prepare('SELECT id FROM cameras WHERE enabled = 1 ORDER BY id')
      .all() as Array<{ id: string }>;
    cameraPrefixes = rows.map((r) => deriveStreamPrefix(r.id));
  } catch {
    cameraPrefixes = [];
  }
  const allStreams = cameraPrefixes.flatMap((prefix) => [
    `${prefix}_main`,
    `${prefix}_sub`,
  ]);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const resp = await fetch(`http://127.0.0.1:${GO2RTC_API_PORT}/api/streams`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const activeStreams = await resp.json() as Record<string, unknown>;
      for (const name of allStreams) {
        result[name] = name in activeStreams;
      }
    } else {
      for (const name of allStreams) result[name] = false;
    }
  } catch {
    for (const name of allStreams) result[name] = false;
  }

  return result;
}
