/**
 * PTZService — Intelligent PTZ control with auto-tracking, patrol, and coordinated handoff.
 *
 * Provides:
 * - Abstract PTZ controller interface (Tapo + ONVIF fallback)
 * - Zoom-on-demand: zoom to a specific bounding box
 * - Auto-tracking: PID-controlled smooth following of a person track
 * - Preset patrol: cycle through presets with dwell time
 * - Coordinated multi-camera handoff: pre-position next camera
 */

import { EventEmitter } from 'events';
import { tapoAPIService } from './TapoAPIService';
import { topologyService } from './TopologyService';
import { getDb, getSetting } from './DatabaseService';

// --- Types ---

export interface PTZCapabilities {
  canPan: boolean;
  canTilt: boolean;
  canZoom: boolean;
  hasPresets: boolean;
  ptzType: 'tapo' | 'onvif' | 'none';
}

export interface PTZPreset {
  id: string;
  cameraId: string;
  name: string;
  sortOrder: number;
}

interface AutoTrackState {
  cameraId: string;
  trackId: number;
  isActive: boolean;
  lastBboxCenter: { x: number; y: number } | null;
  pidIntegralX: number;
  pidIntegralY: number;
  pidLastErrorX: number;
  pidLastErrorY: number;
  lastUpdateMs: number;
}

interface PatrolState {
  cameraId: string;
  isActive: boolean;
  presets: PTZPreset[];
  currentIndex: number;
  dwellTimeMs: number;
  dwellTimer: ReturnType<typeof setTimeout> | null;
  interruptedByTrack: boolean;
}

// --- PID Constants ---

const PID_KP = 0.4;    // Proportional gain
const PID_KI = 0.02;   // Integral gain
const PID_KD = 0.15;   // Derivative gain
const PID_DEAD_ZONE = 0.10; // 10% of frame center — no movement within this
const PID_MAX_SPEED = 80;
const PID_UPDATE_INTERVAL_MS = 200;

const DEFAULT_DWELL_TIME_MS = 10_000;
const DEFAULT_PATROL_ENABLED = false;

// --- PTZService ---

class PTZService extends EventEmitter {
  private autoTrackStates: Map<string, AutoTrackState> = new Map();
  private patrolStates: Map<string, PatrolState> = new Map();
  private autoTrackTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private cameraIpCache: Map<string, string> = new Map();

  // --- Camera IP Resolution ---

  private getCameraIp(cameraId: string): string | null {
    const cached = this.cameraIpCache.get(cameraId);
    if (cached) return cached;

    try {
      const row = getDb()
        .prepare('SELECT ip_address FROM cameras WHERE id = ?')
        .get(cameraId) as { ip_address: string } | undefined;
      if (row?.ip_address) {
        this.cameraIpCache.set(cameraId, row.ip_address);
        return row.ip_address;
      }
    } catch {
      // DB not ready
    }
    return null;
  }

  private getCameraCapabilities(cameraId: string): PTZCapabilities {
    try {
      const row = getDb()
        .prepare('SELECT has_ptz, ptz_type FROM cameras WHERE id = ?')
        .get(cameraId) as { has_ptz: number; ptz_type: string | null } | undefined;

      if (!row || !row.has_ptz) {
        return { canPan: false, canTilt: false, canZoom: false, hasPresets: false, ptzType: 'none' };
      }

      const ptzType = (row.ptz_type as 'tapo' | 'onvif') ?? 'tapo';
      return {
        canPan: true,
        canTilt: true,
        canZoom: ptzType === 'tapo',
        hasPresets: true,
        ptzType,
      };
    } catch {
      return { canPan: false, canTilt: false, canZoom: false, hasPresets: false, ptzType: 'none' };
    }
  }

  // --- Basic PTZ Commands ---

  async move(cameraId: string, direction: 'up' | 'down' | 'left' | 'right', speed: number = 50): Promise<void> {
    const ip = this.getCameraIp(cameraId);
    if (!ip) throw new Error(`No IP for camera ${cameraId}`);
    await tapoAPIService.move(cameraId, ip, direction, speed);
  }

  async stop(cameraId: string): Promise<void> {
    const ip = this.getCameraIp(cameraId);
    if (!ip) throw new Error(`No IP for camera ${cameraId}`);
    await tapoAPIService.stop(cameraId, ip);
  }

  async gotoPreset(cameraId: string, presetId: string): Promise<void> {
    const ip = this.getCameraIp(cameraId);
    if (!ip) throw new Error(`No IP for camera ${cameraId}`);
    await tapoAPIService.goToPreset(cameraId, ip, presetId);
  }

  async setPreset(cameraId: string, name: string): Promise<void> {
    const ip = this.getCameraIp(cameraId);
    if (!ip) throw new Error(`No IP for camera ${cameraId}`);
    await tapoAPIService.setPreset(cameraId, ip, name);
  }

  async getPresets(cameraId: string): Promise<PTZPreset[]> {
    const ip = this.getCameraIp(cameraId);
    if (!ip) return [];

    try {
      const tapoPresets = await tapoAPIService.getPresets(cameraId, ip);
      return tapoPresets.map((p, i) => ({
        id: p.id,
        cameraId,
        name: p.name,
        sortOrder: i,
      }));
    } catch {
      return [];
    }
  }

  getCapabilities(cameraId: string): PTZCapabilities {
    return this.getCameraCapabilities(cameraId);
  }

  // --- Zoom-on-Demand ---

  /**
   * Zoom the camera to center on a target bounding box.
   * Calculates pan/tilt offset from frame center to bbox center.
   */
  async zoomToTarget(
    cameraId: string,
    bbox: { x1: number; y1: number; x2: number; y2: number },
    frameWidth: number = 1920,
    frameHeight: number = 1080
  ): Promise<void> {
    const caps = this.getCameraCapabilities(cameraId);
    if (!caps.canPan) {
      console.warn(`[PTZService] Camera ${cameraId} does not support PTZ`);
      return;
    }

    const bboxCenterX = (bbox.x1 + bbox.x2) / 2;
    const bboxCenterY = (bbox.y1 + bbox.y2) / 2;
    const frameCenterX = frameWidth / 2;
    const frameCenterY = frameHeight / 2;

    // Normalized offset (-1 to 1)
    const offsetX = (bboxCenterX - frameCenterX) / frameCenterX;
    const offsetY = (frameCenterY - bboxCenterY) / frameCenterY; // Inverted Y

    // Dead zone check
    if (Math.abs(offsetX) < PID_DEAD_ZONE && Math.abs(offsetY) < PID_DEAD_ZONE) {
      return;
    }

    // Convert to speed (proportional)
    const speedX = Math.round(Math.abs(offsetX) * PID_MAX_SPEED);
    const speedY = Math.round(Math.abs(offsetY) * PID_MAX_SPEED);

    try {
      if (Math.abs(offsetX) > PID_DEAD_ZONE) {
        await this.move(cameraId, offsetX > 0 ? 'right' : 'left', speedX);
      }
      if (Math.abs(offsetY) > PID_DEAD_ZONE) {
        await this.move(cameraId, offsetY > 0 ? 'up' : 'down', speedY);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PTZService] zoomToTarget failed for ${cameraId}: ${msg}`);
    }
  }

  // --- Auto-Tracking (PID Controller) ---

  /**
   * Start auto-tracking a specific person track on a camera.
   * Uses a PID controller for smooth pan/tilt following.
   */
  startAutoTrack(cameraId: string, trackId: number): void {
    const caps = this.getCameraCapabilities(cameraId);
    if (!caps.canPan) {
      console.warn(`[PTZService] Cannot auto-track on ${cameraId} — no PTZ`);
      return;
    }

    // Stop existing auto-track on this camera
    this.stopAutoTrack(cameraId);

    // Interrupt patrol if running
    const patrol = this.patrolStates.get(cameraId);
    if (patrol?.isActive) {
      patrol.interruptedByTrack = true;
      this.pausePatrol(cameraId);
    }

    const state: AutoTrackState = {
      cameraId,
      trackId,
      isActive: true,
      lastBboxCenter: null,
      pidIntegralX: 0,
      pidIntegralY: 0,
      pidLastErrorX: 0,
      pidLastErrorY: 0,
      lastUpdateMs: Date.now(),
    };

    this.autoTrackStates.set(cameraId, state);

    console.log(`[PTZService] Auto-tracking started: camera=${cameraId} track=${trackId}`);
    this.emit('autotrack:start', { cameraId, trackId });
  }

  /**
   * Stop auto-tracking on a camera.
   */
  stopAutoTrack(cameraId: string): void {
    const state = this.autoTrackStates.get(cameraId);
    if (!state) return;

    state.isActive = false;
    this.autoTrackStates.delete(cameraId);

    // Clear PID timer
    const timer = this.autoTrackTimers.get(cameraId);
    if (timer) {
      clearInterval(timer);
      this.autoTrackTimers.delete(cameraId);
    }

    // Resume patrol if it was interrupted
    const patrol = this.patrolStates.get(cameraId);
    if (patrol?.interruptedByTrack) {
      patrol.interruptedByTrack = false;
      this.resumePatrol(cameraId);
    }

    console.log(`[PTZService] Auto-tracking stopped: camera=${cameraId}`);
    this.emit('autotrack:stop', { cameraId });
  }

  /**
   * Update the tracked object position (called by DetectionPipeline).
   * Runs PID controller to generate smooth movement commands.
   */
  updateTrackPosition(
    cameraId: string,
    trackId: number,
    bboxCenter: { x: number; y: number },
    frameWidth: number = 1920,
    frameHeight: number = 1080
  ): void {
    const state = this.autoTrackStates.get(cameraId);
    if (!state || !state.isActive || state.trackId !== trackId) return;

    const now = Date.now();
    const dt = (now - state.lastUpdateMs) / 1000; // seconds
    if (dt < PID_UPDATE_INTERVAL_MS / 1000) return; // Rate limit

    // Normalized error (-1 to 1) from frame center
    const errorX = (bboxCenter.x - frameWidth / 2) / (frameWidth / 2);
    const errorY = (frameHeight / 2 - bboxCenter.y) / (frameHeight / 2);

    // Dead zone
    if (Math.abs(errorX) < PID_DEAD_ZONE && Math.abs(errorY) < PID_DEAD_ZONE) {
      state.lastUpdateMs = now;
      return;
    }

    // PID for X
    state.pidIntegralX += errorX * dt;
    state.pidIntegralX = Math.max(-1, Math.min(1, state.pidIntegralX)); // Anti-windup
    const derivativeX = dt > 0 ? (errorX - state.pidLastErrorX) / dt : 0;
    const outputX = PID_KP * errorX + PID_KI * state.pidIntegralX + PID_KD * derivativeX;

    // PID for Y
    state.pidIntegralY += errorY * dt;
    state.pidIntegralY = Math.max(-1, Math.min(1, state.pidIntegralY));
    const derivativeY = dt > 0 ? (errorY - state.pidLastErrorY) / dt : 0;
    const outputY = PID_KP * errorY + PID_KI * state.pidIntegralY + PID_KD * derivativeY;

    state.pidLastErrorX = errorX;
    state.pidLastErrorY = errorY;
    state.lastUpdateMs = now;
    state.lastBboxCenter = bboxCenter;

    // Convert PID output to move commands (fire-and-forget)
    const speedX = Math.round(Math.min(PID_MAX_SPEED, Math.abs(outputX) * PID_MAX_SPEED));
    const speedY = Math.round(Math.min(PID_MAX_SPEED, Math.abs(outputY) * PID_MAX_SPEED));

    if (speedX > 5) {
      this.move(cameraId, outputX > 0 ? 'right' : 'left', speedX).catch(() => {});
    }
    if (speedY > 5) {
      this.move(cameraId, outputY > 0 ? 'up' : 'down', speedY).catch(() => {});
    }
  }

  isAutoTracking(cameraId: string): boolean {
    return this.autoTrackStates.get(cameraId)?.isActive === true;
  }

  getAutoTrackInfo(cameraId: string): { trackId: number; isActive: boolean } | null {
    const state = this.autoTrackStates.get(cameraId);
    if (!state) return null;
    return { trackId: state.trackId, isActive: state.isActive };
  }

  // --- Preset Patrol ---

  /**
   * Start patrol mode: cycle through presets with dwell time.
   */
  async startPatrol(cameraId: string, dwellTimeMs?: number): Promise<void> {
    const caps = this.getCameraCapabilities(cameraId);
    if (!caps.hasPresets) {
      console.warn(`[PTZService] Cannot patrol on ${cameraId} — no presets`);
      return;
    }

    this.stopPatrol(cameraId);

    const presets = await this.getPresets(cameraId);
    if (presets.length === 0) {
      console.warn(`[PTZService] No presets configured for ${cameraId}`);
      return;
    }

    const dwell = dwellTimeMs ?? DEFAULT_DWELL_TIME_MS;

    const state: PatrolState = {
      cameraId,
      isActive: true,
      presets,
      currentIndex: 0,
      dwellTimeMs: dwell,
      dwellTimer: null,
      interruptedByTrack: false,
    };

    this.patrolStates.set(cameraId, state);
    console.log(`[PTZService] Patrol started: camera=${cameraId} presets=${presets.length} dwell=${dwell}ms`);
    this.emit('patrol:start', { cameraId, presetCount: presets.length });

    // Go to first preset
    await this.advancePatrol(cameraId);
  }

  /**
   * Stop patrol mode.
   */
  stopPatrol(cameraId: string): void {
    const state = this.patrolStates.get(cameraId);
    if (!state) return;

    state.isActive = false;
    if (state.dwellTimer) {
      clearTimeout(state.dwellTimer);
      state.dwellTimer = null;
    }

    this.patrolStates.delete(cameraId);
    console.log(`[PTZService] Patrol stopped: camera=${cameraId}`);
    this.emit('patrol:stop', { cameraId });
  }

  private pausePatrol(cameraId: string): void {
    const state = this.patrolStates.get(cameraId);
    if (!state) return;

    if (state.dwellTimer) {
      clearTimeout(state.dwellTimer);
      state.dwellTimer = null;
    }
    console.log(`[PTZService] Patrol paused: camera=${cameraId} (auto-track interrupt)`);
  }

  private resumePatrol(cameraId: string): void {
    const state = this.patrolStates.get(cameraId);
    if (!state || !state.isActive) return;

    console.log(`[PTZService] Patrol resumed: camera=${cameraId}`);
    this.advancePatrol(cameraId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PTZService] Patrol resume failed: ${msg}`);
    });
  }

  private async advancePatrol(cameraId: string): Promise<void> {
    const state = this.patrolStates.get(cameraId);
    if (!state || !state.isActive) return;

    const preset = state.presets[state.currentIndex];
    if (!preset) return;

    try {
      await this.gotoPreset(cameraId, preset.id);
      console.log(`[PTZService] Patrol: ${cameraId} → preset "${preset.name}" (${state.currentIndex + 1}/${state.presets.length})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PTZService] Patrol goto failed: ${msg}`);
    }

    // Schedule next preset after dwell — guard against stopPatrol() during dwell
    state.dwellTimer = setTimeout(() => {
      const currentState = this.patrolStates.get(cameraId);
      if (!currentState || !currentState.isActive) return;
      currentState.currentIndex = (currentState.currentIndex + 1) % currentState.presets.length;
      this.advancePatrol(cameraId).catch(() => {});
    }, state.dwellTimeMs);
  }

  isPatrolling(cameraId: string): boolean {
    return this.patrolStates.get(cameraId)?.isActive === true;
  }

  // --- Coordinated Multi-Camera Handoff ---

  /**
   * Handle predictive handoff: pre-position the next camera when a person
   * is predicted to arrive there based on topology.
   *
   * Called when a person is detected at one camera — this pre-positions
   * the predicted next camera to the expected entry point.
   */
  async handlePredictiveHandoff(globalPersonId: string, currentCameraId: string): Promise<void> {
    const prediction = topologyService.predictNextCamera(globalPersonId);
    if (!prediction) return;

    const nextCameraId = prediction.cameraId;
    const caps = this.getCameraCapabilities(nextCameraId);
    if (!caps.hasPresets) return;

    // Don't interrupt active auto-tracking
    if (this.isAutoTracking(nextCameraId)) return;

    // Find the best preset for the expected entry direction
    const presets = await this.getPresets(nextCameraId);
    if (presets.length === 0) return;

    // Use first preset as default entry position (could be enhanced with edge metadata)
    const entryPreset = presets[0];
    if (!entryPreset) return;

    try {
      await this.gotoPreset(nextCameraId, entryPreset.id);
      console.log(
        `[PTZService] Predictive handoff: ${currentCameraId} → ${nextCameraId} ` +
        `(pre-positioned to "${entryPreset.name}" for person ${globalPersonId})`
      );
      this.emit('handoff:preposition', {
        globalPersonId,
        fromCameraId: currentCameraId,
        toCameraId: nextCameraId,
        presetName: entryPreset.name,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PTZService] Predictive handoff failed: ${msg}`);
    }
  }

  // --- Cleanup ---

  stopAll(): void {
    for (const cameraId of this.autoTrackStates.keys()) {
      this.stopAutoTrack(cameraId);
    }
    for (const cameraId of this.patrolStates.keys()) {
      this.stopPatrol(cameraId);
    }
    this.cameraIpCache.clear();
  }
}

// Singleton export
export const ptzService = new PTZService();
