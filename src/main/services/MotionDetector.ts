import { EventEmitter } from 'events';
import { getDb } from './DatabaseService';

// --- Types ---

interface CameraMotionState {
  cameraId: string;
  previousFrame: Buffer | null;
  sensitivity: number;
  lastMotionTime: number;
  isProcessing: boolean;
}

interface CameraMotionConfig {
  motion_sensitivity: number;
}

// --- Constants ---

// Sub-stream dimensions (v2.0 dual-stream: 720p AI pipeline, down from 1080p)
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const BYTES_PER_PIXEL = 3; // RGB24
const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT * BYTES_PER_PIXEL;

const DEFAULT_SENSITIVITY = 50;
const MIN_SENSITIVITY = 0;
const MAX_SENSITIVITY = 100;

const COOLDOWN_MS = 500;

// Sensitivity mapping: 0 = never trigger, 100 = always trigger.
// Maps the 0-100 user scale to a pixel-diff threshold percentage (0.0–1.0).
// At sensitivity 50, ~5% of pixels must change to trigger.
// At sensitivity 100, threshold approaches 0 (always triggers).
// At sensitivity 0, threshold is 1.0 (never triggers).
function sensitivityToThreshold(sensitivity: number): number {
  if (sensitivity <= MIN_SENSITIVITY) {
    return 1.0; // Never trigger
  }
  if (sensitivity >= MAX_SENSITIVITY) {
    return 0.0; // Always trigger
  }
  // Inverse linear mapping: higher sensitivity = lower threshold
  // sensitivity 50 → threshold ~0.05 (5% pixel change)
  // sensitivity 80 → threshold ~0.02 (2% pixel change)
  // sensitivity 20 → threshold ~0.10 (10% pixel change)
  const maxThreshold = 0.12;
  const minThreshold = 0.005;
  const t = sensitivity / MAX_SENSITIVITY;
  return maxThreshold - t * (maxThreshold - minThreshold);
}

// Per-pixel intensity difference threshold (0-255) to consider a pixel "changed"
const PIXEL_DIFF_THRESHOLD = 30;

// Downscale factor for performance: compare every Nth pixel
const SAMPLE_STEP = 4;

// --- MotionDetector ---

class MotionDetector extends EventEmitter {
  private cameras: Map<string, CameraMotionState> = new Map();

  /**
   * Process a frame for motion detection.
   * Compares consecutive frames per camera using pixel difference percentage.
   * Emits 'motionDetected' event with (cameraId, frame) when threshold exceeded.
   */
  processFrame(cameraId: string, frameBuffer: Buffer): void {
    if (!frameBuffer || frameBuffer.length === 0) {
      return;
    }

    let state = this.cameras.get(cameraId);
    if (!state) {
      state = this.initCameraState(cameraId);
      this.cameras.set(cameraId, state);
    }

    // Sensitivity 0 = disabled for this camera
    if (state.sensitivity <= MIN_SENSITIVITY) {
      state.previousFrame = frameBuffer;
      return;
    }

    // Skip if already processing (prevent re-entrant calls)
    if (state.isProcessing) {
      return;
    }

    // Cooldown check
    const now = Date.now();
    if (now - state.lastMotionTime < COOLDOWN_MS) {
      state.previousFrame = frameBuffer;
      return;
    }

    // No previous frame yet — store and return
    if (!state.previousFrame) {
      state.previousFrame = frameBuffer;
      return;
    }

    state.isProcessing = true;

    try {
      const diffPercentage = this.computeFrameDiff(state.previousFrame, frameBuffer);
      const threshold = sensitivityToThreshold(state.sensitivity);

      if (diffPercentage > threshold) {
        state.lastMotionTime = now;
        this.emit('motionDetected', cameraId, frameBuffer);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MotionDetector][${cameraId}] Error computing frame diff: ${errorMessage}`);
    } finally {
      state.previousFrame = frameBuffer;
      state.isProcessing = false;
    }
  }

  /**
   * Update sensitivity for a specific camera at runtime.
   */
  setSensitivity(cameraId: string, sensitivity: number): void {
    const clamped = Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, sensitivity));

    const state = this.cameras.get(cameraId);
    if (state) {
      state.sensitivity = clamped;
    }

    console.log(`[MotionDetector][${cameraId}] Sensitivity set to ${clamped}`);
  }

  /**
   * Get current sensitivity for a camera.
   */
  getSensitivity(cameraId: string): number {
    const state = this.cameras.get(cameraId);
    return state ? state.sensitivity : DEFAULT_SENSITIVITY;
  }

  /**
   * Reset motion state for a camera (e.g., when stream restarts).
   */
  resetCamera(cameraId: string): void {
    this.cameras.delete(cameraId);
    console.log(`[MotionDetector][${cameraId}] State reset.`);
  }

  /**
   * Clean up all camera states.
   */
  resetAll(): void {
    this.cameras.clear();
    this.removeAllListeners();
    console.log('[MotionDetector] All states reset.');
  }

  // --- Private ---

  private initCameraState(cameraId: string): CameraMotionState {
    const sensitivity = this.loadSensitivityFromDb(cameraId);
    return {
      cameraId,
      previousFrame: null,
      sensitivity,
      lastMotionTime: 0,
      isProcessing: false,
    };
  }

  private loadSensitivityFromDb(cameraId: string): number {
    try {
      const row = getDb()
        .prepare('SELECT motion_sensitivity FROM cameras WHERE id = ?')
        .get(cameraId) as CameraMotionConfig | undefined;

      if (row && typeof row.motion_sensitivity === 'number') {
        return Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, row.motion_sensitivity));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[MotionDetector][${cameraId}] Failed to load sensitivity from DB: ${errorMessage}`);
    }

    return DEFAULT_SENSITIVITY;
  }

  /**
   * Compute the percentage of pixels that differ between two frames.
   * Uses sampling (every SAMPLE_STEP-th pixel) for performance on 1280×720 frames.
   * Returns a value between 0.0 and 1.0.
   */
  private computeFrameDiff(prev: Buffer, curr: Buffer): number {
    const pixelCount = Math.min(prev.length, curr.length) / BYTES_PER_PIXEL;
    if (pixelCount === 0) {
      return 0;
    }

    let changedPixels = 0;
    let sampledPixels = 0;

    for (let i = 0; i < pixelCount; i += SAMPLE_STEP) {
      const offset = i * BYTES_PER_PIXEL;

      // Compute absolute difference for each channel
      const dr = Math.abs(prev[offset] - curr[offset]);
      const dg = Math.abs(prev[offset + 1] - curr[offset + 1]);
      const db = Math.abs(prev[offset + 2] - curr[offset + 2]);

      // Average channel difference
      const avgDiff = (dr + dg + db) / 3;

      if (avgDiff > PIXEL_DIFF_THRESHOLD) {
        changedPixels++;
      }

      sampledPixels++;
    }

    if (sampledPixels === 0) {
      return 0;
    }

    return changedPixels / sampledPixels;
  }
}

// Singleton export
export const motionDetector = new MotionDetector();
