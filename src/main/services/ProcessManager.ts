/**
 * ProcessManager — manages the Python AI sidecar child process.
 *
 * Responsibilities:
 * - Launch python sidecar as a child process
 * - Health check polling (GET /health every 5s)
 * - Auto-restart with exponential backoff on consecutive failures
 * - Graceful shutdown on Electron app quit
 * - Pass GPU config to sidecar via environment variables
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';

export type SidecarStatus = 'starting' | 'healthy' | 'unhealthy' | 'stopped';

interface ProcessManagerState {
  process: ChildProcess | null;
  status: SidecarStatus;
  healthCheckInterval: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
  restartAttempts: number;
  isShuttingDown: boolean;
}

const SIDECAR_PORT = 8520;
const SIDECAR_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 30_000];
const SHUTDOWN_TIMEOUT_MS = 5_000;

const state: ProcessManagerState = {
  process: null,
  status: 'stopped',
  healthCheckInterval: null,
  consecutiveFailures: 0,
  restartAttempts: 0,
  isShuttingDown: false,
};

let statusChangeCallback: ((status: SidecarStatus) => void) | null = null;

function setStatus(newStatus: SidecarStatus): void {
  if (state.status !== newStatus) {
    console.log(`[ProcessManager] Status: ${state.status} → ${newStatus}`);
    state.status = newStatus;
    if (statusChangeCallback) {
      statusChangeCallback(newStatus);
    }
  }
}

function getSidecarCwd(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(process.cwd(), 'python-sidecar');
  }
  return path.join(process.resourcesPath, 'python-sidecar');
}

function buildSidecarEnv(gpuEnabled: boolean): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env['SIDECAR_GPU_ENABLED'] = gpuEnabled ? 'true' : 'false';
  env['SIDECAR_PORT'] = String(SIDECAR_PORT);
  env['SIDECAR_HOST'] = SIDECAR_HOST;
  return env;
}

async function detectGpuFromSystem(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('nvidia-smi', [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
      });

      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout.includes('NVIDIA')) {
          console.log('[ProcessManager] NVIDIA GPU detected via nvidia-smi');
          resolve(true);
        } else {
          resolve(false);
        }
      });

      proc.on('error', () => {
        console.log('[ProcessManager] nvidia-smi not found — assuming no GPU');
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function checkHealth(): Promise<boolean> {
  const url = `http://${SIDECAR_HOST}:${SIDECAR_PORT}/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return data.status === 'healthy' || data.status === 'degraded';
    }
    return false;
  } catch {
    return false;
  }
}

let lastEmbeddingsSyncTime = 0;
const EMBEDDINGS_SYNC_COOLDOWN_MS = 30_000; // Don't re-sync more than once per 30s

async function checkEmbeddingsInSync(): Promise<void> {
  // Cooldown to prevent spam re-syncs when sidecar is hot-reloading
  const now = Date.now();
  if (now - lastEmbeddingsSyncTime < EMBEDDINGS_SYNC_COOLDOWN_MS) return;

  try {
    const url = `http://${SIDECAR_HOST}:${SIDECAR_PORT}/embeddings/count`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return;
    const data = await response.json() as { count: number };

    if (data.count === 0) {
      // Sidecar has no embeddings — check if DB has any
      try {
        const { getAllEmbeddings } = require('./DatabaseService');
        const dbEmbeddings = getAllEmbeddings();
        if (dbEmbeddings.length > 0) {
          console.log(`[ProcessManager] Sidecar has 0 embeddings but DB has ${dbEmbeddings.length} — triggering re-sync`);
          lastEmbeddingsSyncTime = now;
          const { syncEmbeddingsToSidecar } = require('./AIBridgeService');
          await syncEmbeddingsToSidecar();
        }
      } catch { /* DB not ready yet */ }
    }
  } catch { /* Non-critical */ }
}

function startHealthChecking(): void {
  stopHealthChecking();
  state.healthCheckInterval = setInterval(async () => {
    if (state.isShuttingDown) {
      return;
    }

    const isHealthy = await checkHealth();

    if (isHealthy) {
      state.consecutiveFailures = 0;
      state.restartAttempts = 0;
      setStatus('healthy');

      // Periodically verify embeddings are in sync (handles sidecar hot-reload)
      await checkEmbeddingsInSync();
    } else {
      state.consecutiveFailures++;
      console.warn(
        `[ProcessManager] Health check failed (${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
      );

      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        setStatus('unhealthy');
        console.error('[ProcessManager] Max consecutive failures reached — restarting sidecar');
        await restartSidecar();
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthChecking(): void {
  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
    state.healthCheckInterval = null;
  }
}

function killProcess(): Promise<void> {
  return new Promise((resolve) => {
    if (!state.process) {
      resolve();
      return;
    }

    const proc = state.process;
    const killTimeout = setTimeout(() => {
      console.warn('[ProcessManager] SIGTERM timeout — sending SIGKILL');
      try {
        proc.kill('SIGKILL');
      } catch {
        // Process already dead
      }
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    proc.once('exit', () => {
      clearTimeout(killTimeout);
      resolve();
    });

    try {
      // On Windows, use taskkill for tree kill since SIGTERM isn't reliable
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      clearTimeout(killTimeout);
      resolve();
    }
  });
}

async function restartSidecar(): Promise<void> {
  if (state.isShuttingDown) {
    return;
  }

  stopHealthChecking();
  await killProcess();

  const backoffIndex = Math.min(state.restartAttempts, BACKOFF_SCHEDULE_MS.length - 1);
  const backoffMs = BACKOFF_SCHEDULE_MS[backoffIndex];
  state.restartAttempts++;

  console.log(
    `[ProcessManager] Restart attempt ${state.restartAttempts} — waiting ${backoffMs}ms`
  );

  await new Promise((resolve) => setTimeout(resolve, backoffMs));

  if (state.isShuttingDown) {
    return;
  }

  const gpuAvailable = await detectGpuFromSystem();
  await launchSidecar(gpuAvailable);
}

async function launchSidecar(gpuEnabled: boolean): Promise<void> {
  const cwd = getSidecarCwd();
  const env = buildSidecarEnv(gpuEnabled);

  console.log(`[ProcessManager] Launching sidecar from: ${cwd}`);

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const args = ['-m', 'uvicorn', 'main:app', '--host', SIDECAR_HOST, '--port', String(SIDECAR_PORT)];

  try {
    const proc = spawn(pythonCmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    state.process = proc;
    state.consecutiveFailures = 0;
    setStatus('starting');

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().trim().split('\n');
      for (const line of lines) {
        console.log(`[Sidecar stdout] ${line}`);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().trim().split('\n');
      for (const line of lines) {
        console.error(`[Sidecar stderr] ${line}`);
      }
    });

    proc.on('exit', (code, signal) => {
      console.log(`[ProcessManager] Sidecar exited: code=${code} signal=${signal}`);
      state.process = null;
      if (!state.isShuttingDown) {
        setStatus('stopped');
      }
    });

    proc.on('error', (err) => {
      console.error(`[ProcessManager] Failed to spawn sidecar: ${err.message}`);
      state.process = null;
      setStatus('stopped');
    });

    startHealthChecking();
  } catch (err) {
    console.error(`[ProcessManager] Spawn error: ${err}`);
    setStatus('stopped');
  }
}

// --- Public API ---

export async function startSidecar(): Promise<void> {
  if (state.process) {
    console.log('[ProcessManager] Sidecar already running');
    return;
  }
  state.isShuttingDown = false;
  state.restartAttempts = 0;

  // Check if an external sidecar is already running (e.g. from npm run start:python)
  const externalHealthy = await checkHealth();
  if (externalHealthy) {
    console.log('[ProcessManager] External sidecar already running on port ' + SIDECAR_PORT + ' — skipping spawn');
    setStatus('healthy');
    startHealthChecking();
    return;
  }

  const gpuAvailable = await detectGpuFromSystem();
  await launchSidecar(gpuAvailable);
}

export async function stopSidecar(): Promise<void> {
  state.isShuttingDown = true;
  stopHealthChecking();
  await killProcess();
  state.process = null;
  setStatus('stopped');
  console.log('[ProcessManager] Sidecar stopped');
}

export function getSidecarStatus(): SidecarStatus {
  return state.status;
}

export function onStatusChange(callback: (status: SidecarStatus) => void): void {
  statusChangeCallback = callback;
}

export function getSidecarBaseUrl(): string {
  return `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;
}

const EXPIRY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REID_CLEANUP_INTERVAL_MS = 60_000; // 1 minute — Re-ID gallery entries expire after 5 min
let expiryCleanupTimer: ReturnType<typeof setInterval> | null = null;
let reidCleanupTimer: ReturnType<typeof setInterval> | null = null;

function runReIDGalleryCleanup(): void {
  try {
    const { purgeExpiredReIDEntries } = require('./DatabaseService');
    const removed = purgeExpiredReIDEntries();
    if (removed > 0) {
      console.log(`[ProcessManager] Re-ID gallery cleanup: removed ${removed} expired entries`);
    }
  } catch {
    // Non-critical — DB may not be initialized yet
  }
}

async function runAutoEnrollExpiryCleanup(): Promise<void> {
  if (state.status !== 'healthy') {
    return;
  }
  try {
    const url = `http://${SIDECAR_HOST}:${SIDECAR_PORT}/auto_enroll/purge_expired`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(url, { method: 'POST', signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json() as { deleted: number };
      if (data.deleted > 0) {
        console.log(`[ProcessManager] Auto-enroll expiry cleanup: removed ${data.deleted} expired embedding(s)`);
      }
    }
  } catch {
    // Non-critical — sidecar may not have the endpoint yet
  }
}

export function startExpiryCleanup(): void {
  if (expiryCleanupTimer) return;
  expiryCleanupTimer = setInterval(runAutoEnrollExpiryCleanup, EXPIRY_CLEANUP_INTERVAL_MS);
  // Run once after 60s on startup to catch any previously expired entries
  setTimeout(runAutoEnrollExpiryCleanup, 60_000);

  // Re-ID gallery cleanup — runs every minute to purge entries older than 5 min
  if (!reidCleanupTimer) {
    reidCleanupTimer = setInterval(runReIDGalleryCleanup, REID_CLEANUP_INTERVAL_MS);
  }

  // R1-M1: Gait buffer cleanup — purge stale gait frame buffers from DetectionPipeline
  setInterval(() => {
    try {
      const { detectionPipeline } = require('./DetectionPipeline');
      if (detectionPipeline?.purgeStaleGaitBuffers) {
        detectionPipeline.purgeStaleGaitBuffers();
      }
    } catch { /* non-critical */ }
  }, 60_000);
}

export function stopExpiryCleanup(): void {
  if (expiryCleanupTimer) {
    clearInterval(expiryCleanupTimer);
    expiryCleanupTimer = null;
  }
  if (reidCleanupTimer) {
    clearInterval(reidCleanupTimer);
    reidCleanupTimer = null;
  }
}
