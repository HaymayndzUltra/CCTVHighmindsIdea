/**
 * PresenceService — 5-state FSM per person for HOME/AWAY presence tracking.
 *
 * States: UNKNOWN → AT_GATE → ARRIVING → HOME → DEPARTING → AWAY
 *
 * Transitions driven by:
 * - Camera detections + topology position (gate = entry point, interior = home)
 * - Timeout: "not seen for 30 min" → AWAY
 *
 * Responsibilities:
 * - Track per-person presence state in memory
 * - Persist state changes to persons table and presence_history
 * - Emit presence:update events via IPC
 * - Periodic timeout check for stale presence
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import {
  updatePersonPresence,
  createPresenceEntry,
  getDb,
  getSetting,
} from './DatabaseService';
import { topologyService } from './TopologyService';
import { telegramService } from './TelegramService';
import type { PresenceState } from '../../shared/types';

// --- Types ---

interface PersonPresenceState {
  personId: string;
  personName: string;
  state: PresenceState;
  lastCameraId: string | null;
  lastSeenAt: number;
  stateChangedAt: number;
}

export interface PresenceUpdateEvent {
  personId: string;
  personName: string;
  state: PresenceState;
  previousState: PresenceState;
  triggerCameraId: string | null;
  triggerReason: string;
  timestamp: number;
}

// --- Constants ---

const PRESENCE_TIMEOUT_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_AWAY_TIMEOUT_MIN = 30;

// Camera role classification for presence transitions
// Gate cameras trigger AT_GATE; interior cameras trigger HOME
// This is determined by topology: cameras with no inbound edges from other cameras = gate
// Cameras with inbound edges = interior

// --- PresenceService Class ---

class PresenceService extends EventEmitter {
  private personStates: Map<string, PersonPresenceState> = new Map();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  // Cache for camera roles: 'gate' | 'interior' | 'unknown'
  private cameraRoleCache: Map<string, string> = new Map();
  private cameraRoleCacheLoadedAt = 0;
  private readonly ROLE_CACHE_TTL_MS = 60_000;

  /**
   * Start the presence timeout checker.
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.loadPresenceFromDb();

    this.timeoutTimer = setInterval(() => {
      this.checkTimeouts();
    }, PRESENCE_TIMEOUT_CHECK_INTERVAL_MS);

    console.log('[PresenceService] Started.');
  }

  /**
   * Stop the presence service.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    console.log('[PresenceService] Stopped.');
  }

  /**
   * Process a detection event for a known person.
   * Determines state transition based on camera role + current state.
   */
  processDetection(
    personId: string,
    personName: string,
    cameraId: string,
    timestamp: number
  ): void {
    if (!this.isRunning) return;
    if (!personId || !cameraId) return;

    const current = this.personStates.get(personId);
    const currentState: PresenceState = current?.state ?? 'UNKNOWN';
    const cameraRole = this.getCameraRole(cameraId);

    let newState: PresenceState = currentState;
    let reason = '';

    // FSM transition logic
    switch (currentState) {
      case 'UNKNOWN':
        if (cameraRole === 'gate') {
          newState = 'AT_GATE';
          reason = 'First detection at gate camera';
        } else {
          newState = 'HOME';
          reason = 'First detection at interior camera';
        }
        break;

      case 'AWAY':
        if (cameraRole === 'gate') {
          newState = 'AT_GATE';
          reason = 'Detected at gate after being away';
        } else {
          newState = 'ARRIVING';
          reason = 'Detected at interior camera after being away';
        }
        break;

      case 'AT_GATE': {
        if (cameraRole === 'gate') {
          // Still at gate — check if different gate camera (departing direction?)
          const isMovingInbound = this.isInboundTransit(current?.lastCameraId ?? '', cameraId);
          if (isMovingInbound) {
            newState = 'ARRIVING';
            reason = 'Moving inbound from gate';
          }
          // else stay AT_GATE
        } else {
          newState = 'ARRIVING';
          reason = 'Moved from gate to interior camera';
        }
        break;
      }

      case 'ARRIVING':
        if (cameraRole === 'interior') {
          newState = 'HOME';
          reason = 'Reached interior camera';
        } else if (cameraRole === 'gate') {
          // Back at gate while arriving — might be leaving
          newState = 'DEPARTING';
          reason = 'Returned to gate while arriving';
        }
        // else stay ARRIVING
        break;

      case 'HOME':
        if (cameraRole === 'gate') {
          newState = 'DEPARTING';
          reason = 'Detected at gate while home';
        }
        // Interior camera while HOME → just update lastSeen, no state change
        break;

      case 'DEPARTING':
        if (cameraRole === 'interior') {
          newState = 'HOME';
          reason = 'Returned to interior while departing';
        } else if (cameraRole === 'gate') {
          // Still at gate — might leave (timeout will transition to AWAY)
          // Stay DEPARTING
        }
        break;
    }

    // Update tracking
    const previousState = currentState;

    if (!current) {
      this.personStates.set(personId, {
        personId,
        personName,
        state: newState,
        lastCameraId: cameraId,
        lastSeenAt: timestamp,
        stateChangedAt: timestamp,
      });
    } else {
      current.lastCameraId = cameraId;
      current.lastSeenAt = timestamp;
      current.personName = personName;
      if (newState !== currentState) {
        current.state = newState;
        current.stateChangedAt = timestamp;
      }
    }

    // Only emit + persist if state actually changed
    if (newState !== previousState) {
      this.persistStateChange(personId, newState, cameraId);
      this.recordPresenceHistory(personId, newState, previousState, cameraId, reason);

      const presenceEvent = {
        personId,
        personName,
        state: newState,
        previousState,
        triggerCameraId: cameraId,
        triggerReason: reason,
        timestamp,
      };

      this.emitPresenceUpdate(presenceEvent);

      // Send Telegram presence alert for notable transitions
      telegramService.sendPresenceAlert(presenceEvent).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PresenceService] Telegram presence alert failed: ${msg}`);
      });

      console.log(
        `[PresenceService] ${personName}: ${previousState} → ${newState} (${reason})`
      );
    }
  }

  /**
   * Get current presence state for all tracked persons.
   */
  getAllPresenceStates(): PersonPresenceState[] {
    return Array.from(this.personStates.values());
  }

  /**
   * Get presence state for a specific person.
   */
  getPersonState(personId: string): PersonPresenceState | null {
    return this.personStates.get(personId) ?? null;
  }

  // --- Camera Role Classification ---

  /**
   * Determine if a camera is a 'gate' camera or 'interior' camera.
   *
   * Gate cameras: cameras that are entry/exit points (e.g., CAM-2A, CAM-2B).
   * - Identified by: having camera_group_id containing 'GATE', or
   *   being the first camera in topology (no inbound edges from other cameras outside its group)
   *
   * Interior cameras: all others (e.g., CAM-1, CAM-3).
   */
  private getCameraRole(cameraId: string): 'gate' | 'interior' | 'unknown' {
    if (Date.now() - this.cameraRoleCacheLoadedAt > this.ROLE_CACHE_TTL_MS) {
      this.cameraRoleCache.clear();
      this.cameraRoleCacheLoadedAt = Date.now();
    }

    const cached = this.cameraRoleCache.get(cameraId);
    if (cached) return cached as 'gate' | 'interior' | 'unknown';

    let role: 'gate' | 'interior' | 'unknown' = 'unknown';

    // Check camera_group_id for GATE
    const groupId = topologyService.getCameraGroupId(cameraId);
    if (groupId && groupId.toUpperCase().includes('GATE')) {
      role = 'gate';
    } else {
      // Check topology: if camera has inbound edges, it's interior
      const edges = topologyService.getEdges();
      const hasInbound = edges.some((e) => e.toCameraId === cameraId);
      const hasOutbound = edges.some((e) => e.fromCameraId === cameraId);

      if (hasInbound && hasOutbound) {
        // Middle camera — treat as interior for presence purposes
        role = 'interior';
      } else if (!hasInbound && hasOutbound) {
        // Entry point — gate
        role = 'gate';
      } else if (hasInbound && !hasOutbound) {
        // End point — interior
        role = 'interior';
      } else {
        // Isolated — default to interior
        role = 'interior';
      }
    }

    this.cameraRoleCache.set(cameraId, role);
    return role;
  }

  /**
   * Check if transit from fromCamera to toCamera is inbound direction.
   */
  private isInboundTransit(fromCameraId: string, toCameraId: string): boolean {
    if (!fromCameraId || !toCameraId) return false;

    const edges = topologyService.getEdges();
    for (const edge of edges) {
      if (edge.fromCameraId === fromCameraId && edge.toCameraId === toCameraId) {
        return edge.direction === 'inbound';
      }
    }
    return false;
  }

  // --- Timeout Management ---

  private checkTimeouts(): void {
    const now = Date.now();
    const awayTimeoutMs = this.getAwayTimeoutMs();

    for (const [, state] of this.personStates) {
      if (state.state === 'AWAY' || state.state === 'UNKNOWN') continue;

      if (now - state.lastSeenAt > awayTimeoutMs) {
        const previousState = state.state;
        state.state = 'AWAY';
        state.stateChangedAt = now;

        this.persistStateChange(state.personId, 'AWAY', null);
        this.recordPresenceHistory(
          state.personId,
          'AWAY',
          previousState,
          null,
          `Not seen for ${Math.round(awayTimeoutMs / 60_000)} minutes`
        );
        this.emitPresenceUpdate({
          personId: state.personId,
          personName: state.personName,
          state: 'AWAY',
          previousState,
          triggerCameraId: null,
          triggerReason: 'Timeout — not seen',
          timestamp: now,
        });

        console.log(
          `[PresenceService] ${state.personName}: ${previousState} → AWAY (timeout)`
        );
      }
    }
  }

  private getAwayTimeoutMs(): number {
    try {
      const val = getSetting('presence_away_timeout_min');
      const minutes = val ? parseInt(val, 10) : DEFAULT_AWAY_TIMEOUT_MIN;
      return minutes * 60 * 1000;
    } catch {
      return DEFAULT_AWAY_TIMEOUT_MIN * 60 * 1000;
    }
  }

  // --- Persistence ---

  private persistStateChange(personId: string, state: PresenceState, cameraId: string | null): void {
    try {
      updatePersonPresence(personId, state, cameraId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PresenceService] Failed to persist state for ${personId}: ${message}`);
    }
  }

  private recordPresenceHistory(
    personId: string,
    state: PresenceState,
    previousState: PresenceState,
    cameraId: string | null,
    reason: string
  ): void {
    try {
      createPresenceEntry({
        id: crypto.randomUUID(),
        personId,
        state,
        previousState,
        triggerCameraId: cameraId,
        triggerReason: reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PresenceService] Failed to record presence history for ${personId}: ${message}`);
    }
  }

  // --- IPC Emission ---

  private emitPresenceUpdate(event: PresenceUpdateEvent): void {
    this.emit('presence:update', event);

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('presence:update', event);
      }
    }
  }

  // --- DB Load ---

  private loadPresenceFromDb(): void {
    try {
      const rows = getDb()
        .prepare(
          `SELECT id, name, presence_state, last_seen_camera_id, last_seen_at, presence_updated_at
           FROM persons WHERE enabled = 1`
        )
        .all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const personId = row.id as string;
        const state = (row.presence_state as PresenceState) || 'UNKNOWN';
        const lastSeenAt = row.last_seen_at
          ? new Date(row.last_seen_at as string).getTime()
          : 0;

        this.personStates.set(personId, {
          personId,
          personName: (row.name as string) ?? 'Unknown',
          state,
          lastCameraId: (row.last_seen_camera_id as string) ?? null,
          lastSeenAt,
          stateChangedAt: row.presence_updated_at
            ? new Date(row.presence_updated_at as string).getTime()
            : lastSeenAt,
        });
      }

      console.log(`[PresenceService] Loaded presence for ${this.personStates.size} person(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PresenceService] Failed to load presence from DB: ${message}`);
    }
  }

  /**
   * Clear all state (for testing/reset).
   */
  reset(): void {
    this.personStates.clear();
    this.cameraRoleCache.clear();
    console.log('[PresenceService] Reset all presence state.');
  }
}

// Singleton export
export const presenceService = new PresenceService();
