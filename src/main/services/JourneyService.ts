/**
 * JourneyService — Cross-camera journey tracking.
 *
 * Responsibilities:
 * - Start a journey when a known person is detected at any camera
 * - Update journey when same person appears at next expected camera within transit window
 * - Complete journey when person reaches an interior camera (end of path)
 * - Expire stale journeys after blind_spot_max_sec
 * - Emit journey events via IPC to renderer
 * - Persist journeys to DB
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import {
  createJourney,
  updateJourney as dbUpdateJourney,
  getActiveJourneys,
  getDb,
} from './DatabaseService';
import { topologyService } from './TopologyService';
import { telegramService } from './TelegramService';

// --- Types ---

export interface JourneyStep {
  cameraId: string;
  timestamp: number;
  action: string;
}

export interface ActiveJourney {
  id: string;
  personId: string;
  personName: string;
  globalPersonId: string | null;
  steps: JourneyStep[];
  lastCameraId: string;
  lastTimestamp: number;
  startedAt: number;
}

export interface JourneyUpdateEvent {
  journeyId: string;
  personId: string;
  personName: string;
  status: 'active' | 'completed' | 'expired';
  steps: JourneyStep[];
  totalDurationSec: number | null;
}

// --- Constants ---

const JOURNEY_EXPIRY_CHECK_INTERVAL_MS = 10_000;
const JOURNEY_DEDUP_WINDOW_MS = 3_000; // Ignore same person + same camera within 3s

// --- JourneyService Class ---

class JourneyService extends EventEmitter {
  // Active journeys indexed by personId for fast lookup
  private activeJourneys: Map<string, ActiveJourney> = new Map();
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * Start the journey expiry checker.
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.loadActiveJourneysFromDb();

    this.expiryTimer = setInterval(() => {
      this.expireStaleJourneys();
    }, JOURNEY_EXPIRY_CHECK_INTERVAL_MS);

    console.log('[JourneyService] Started.');
  }

  /**
   * Stop the journey service.
   */
  stop(): void {
    this.isRunning = false;
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    console.log('[JourneyService] Stopped.');
  }

  /**
   * Process a face recognition event. Called by EventProcessor when a known person is detected.
   *
   * Logic:
   * 1. If person has an active journey:
   *    a. If same camera + within dedup window → skip
   *    b. If different camera + topology transit valid → update journey
   *    c. If different camera + no topology edge → complete old, start new
   * 2. If no active journey → start new journey
   */
  processDetection(
    personId: string,
    personName: string,
    cameraId: string,
    timestamp: number,
    globalPersonId?: string | null
  ): void {
    if (!this.isRunning) return;
    if (!personId || !cameraId) return;

    const existing = this.activeJourneys.get(personId);

    if (existing) {
      // Dedup: same camera within window
      if (
        existing.lastCameraId === cameraId &&
        timestamp - existing.lastTimestamp < JOURNEY_DEDUP_WINDOW_MS
      ) {
        return;
      }

      // Same camera, just update timestamp
      if (existing.lastCameraId === cameraId) {
        existing.lastTimestamp = timestamp;
        return;
      }

      // Different camera — check topology
      const elapsedSec = (timestamp - existing.lastTimestamp) / 1000;
      const isValidTransit = topologyService.isTransitTimeValid(
        existing.lastCameraId,
        cameraId,
        elapsedSec
      );
      const hasEdge = topologyService.hasDirectEdge(existing.lastCameraId, cameraId);

      if (hasEdge && isValidTransit) {
        // Valid transit — update journey
        this.addJourneyStep(existing, cameraId, timestamp, 'transit');
      } else if (hasEdge && !isValidTransit) {
        // Edge exists but transit time out of range — still update (might be slow/fast walk)
        this.addJourneyStep(existing, cameraId, timestamp, 'transit_outlier');
      } else {
        // No direct edge — complete old journey, start new
        this.completeJourney(existing, 'completed');
        this.startJourney(personId, personName, cameraId, timestamp, globalPersonId ?? null);
      }
    } else {
      // No active journey — start new
      this.startJourney(personId, personName, cameraId, timestamp, globalPersonId ?? null);
    }
  }

  /**
   * Get all active journeys (for IPC query).
   */
  getActiveJourneysList(): ActiveJourney[] {
    return Array.from(this.activeJourneys.values());
  }

  /**
   * Get active journey for a specific person.
   */
  getJourneyForPerson(personId: string): ActiveJourney | null {
    return this.activeJourneys.get(personId) ?? null;
  }

  // --- Internal ---

  private startJourney(
    personId: string,
    personName: string,
    cameraId: string,
    timestamp: number,
    globalPersonId: string | null
  ): void {
    const journeyId = crypto.randomUUID();
    const step: JourneyStep = {
      cameraId,
      timestamp,
      action: 'detected',
    };

    const journey: ActiveJourney = {
      id: journeyId,
      personId,
      personName,
      globalPersonId,
      steps: [step],
      lastCameraId: cameraId,
      lastTimestamp: timestamp,
      startedAt: timestamp,
    };

    this.activeJourneys.set(personId, journey);

    // Persist to DB
    try {
      createJourney({
        id: journeyId,
        personId,
        personName,
        globalPersonId,
        startedAt: new Date(timestamp).toISOString(),
        path: JSON.stringify([step]),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JourneyService] Failed to persist journey ${journeyId}: ${message}`);
    }

    this.emitJourneyUpdate(journey, 'active');

    console.log(
      `[JourneyService] Journey started: ${journeyId} | ${personName} at ${cameraId}`
    );
  }

  private addJourneyStep(
    journey: ActiveJourney,
    cameraId: string,
    timestamp: number,
    action: string
  ): void {
    const step: JourneyStep = { cameraId, timestamp, action };
    journey.steps.push(step);
    journey.lastCameraId = cameraId;
    journey.lastTimestamp = timestamp;

    // Update DB
    try {
      dbUpdateJourney(journey.id, {
        path: JSON.stringify(journey.steps),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JourneyService] Failed to update journey ${journey.id}: ${message}`);
    }

    this.emitJourneyUpdate(journey, 'active');

    const stepNames = journey.steps.map((s) => s.cameraId).join(' → ');
    console.log(
      `[JourneyService] Journey updated: ${journey.id} | ${journey.personName}: ${stepNames}`
    );
  }

  private completeJourney(journey: ActiveJourney, status: 'completed' | 'expired'): void {
    const totalDurationSec = journey.steps.length > 1
      ? (journey.lastTimestamp - journey.startedAt) / 1000
      : 0;

    // Update DB
    try {
      dbUpdateJourney(journey.id, {
        status,
        completedAt: new Date().toISOString(),
        totalDurationSec,
        path: JSON.stringify(journey.steps),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JourneyService] Failed to complete journey ${journey.id}: ${message}`);
    }

    this.activeJourneys.delete(journey.personId);
    this.emitJourneyUpdate(journey, status);

    const stepNames = journey.steps.map((s) => s.cameraId).join(' → ');
    console.log(
      `[JourneyService] Journey ${status}: ${journey.id} | ${journey.personName}: ${stepNames} (${totalDurationSec.toFixed(0)}s)`
    );

    // Send Telegram journey alert for multi-step completed journeys
    if (status === 'completed' && journey.steps.length >= 2) {
      const summary = this.formatJourneySummary(journey);
      telegramService.sendJourneyAlert({
        journeyId: journey.id,
        personId: journey.personId,
        personName: journey.personName,
        status,
        pathSummary: summary,
        totalDurationSec,
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[JourneyService] Telegram journey alert failed: ${msg}`);
      });
    }
  }

  private expireStaleJourneys(): void {
    const now = Date.now();
    const blindSpotMaxMs = topologyService.getBlindSpotMaxSec() * 1000;

    for (const [, journey] of this.activeJourneys) {
      if (now - journey.lastTimestamp > blindSpotMaxMs) {
        this.completeJourney(journey, 'expired');
      }
    }
  }

  private loadActiveJourneysFromDb(): void {
    try {
      const rows = getActiveJourneys() as Array<Record<string, unknown>>;

      for (const row of rows) {
        let steps: JourneyStep[];
        try {
          steps = JSON.parse(row.path as string) as JourneyStep[];
        } catch {
          steps = [];
        }

        if (steps.length === 0) continue;

        const lastStep = steps[steps.length - 1]!;
        const personId = row.person_id as string;

        if (!personId) continue;

        // Check if journey is already expired (stale in DB)
        const blindSpotMaxMs = topologyService.getBlindSpotMaxSec() * 1000;
        if (Date.now() - lastStep.timestamp > blindSpotMaxMs) {
          // Expire it
          try {
            dbUpdateJourney(row.id as string, {
              status: 'expired',
              completedAt: new Date().toISOString(),
            });
          } catch {
            // Non-critical
          }
          continue;
        }

        const journey: ActiveJourney = {
          id: row.id as string,
          personId,
          personName: (row.person_name as string) ?? 'Unknown',
          globalPersonId: (row.global_person_id as string) ?? null,
          steps,
          lastCameraId: lastStep.cameraId,
          lastTimestamp: lastStep.timestamp,
          startedAt: steps[0]!.timestamp,
        };

        this.activeJourneys.set(personId, journey);
      }

      console.log(`[JourneyService] Loaded ${this.activeJourneys.size} active journey(s) from DB.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JourneyService] Failed to load active journeys: ${message}`);
    }
  }

  private emitJourneyUpdate(journey: ActiveJourney, status: 'active' | 'completed' | 'expired'): void {
    const totalDurationSec = journey.steps.length > 1
      ? (journey.lastTimestamp - journey.startedAt) / 1000
      : null;

    const payload: JourneyUpdateEvent = {
      journeyId: journey.id,
      personId: journey.personId,
      personName: journey.personName,
      status,
      steps: journey.steps,
      totalDurationSec,
    };

    this.emit('journey:update', payload);

    // Push to renderer
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('journey:update', payload);
      }
    }
  }

  /**
   * Build a human-readable journey summary string.
   * Example: "Gate → Garden → House in 45s"
   */
  formatJourneySummary(journey: ActiveJourney): string {
    const cameraLabels = journey.steps.map((s) => this.getCameraLabel(s.cameraId));
    const path = cameraLabels.join(' → ');

    if (journey.steps.length > 1) {
      const durationSec = (journey.lastTimestamp - journey.startedAt) / 1000;
      return `${path} in ${Math.round(durationSec)}s`;
    }

    return path;
  }

  private getCameraLabel(cameraId: string): string {
    try {
      const row = getDb()
        .prepare('SELECT label FROM cameras WHERE id = ?')
        .get(cameraId) as { label: string } | undefined;
      return row?.label ?? cameraId;
    } catch {
      return cameraId;
    }
  }

  /**
   * Clear all active journeys (for testing/reset).
   */
  reset(): void {
    this.activeJourneys.clear();
    console.log('[JourneyService] Reset all active journeys.');
  }
}

// Singleton export
export const journeyService = new JourneyService();
