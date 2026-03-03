/**
 * TopologyService — Camera spatial topology for cross-camera intelligence.
 *
 * Responsibilities:
 * - Load topology edges from DB (cached with TTL)
 * - Provide getExpectedNextCameras(currentCameraId) → list of reachable cameras
 * - Provide isTransitTimeValid(fromCamera, toCamera, elapsedSec) → boolean
 * - Camera group membership queries
 * - Blind spot max timeout from settings
 */

import { EventEmitter } from 'events';
import {
  getTopologyEdges,
  getCamerasByGroup,
  getSetting,
  getDb,
} from './DatabaseService';

// --- Types ---

export interface TopologyEdge {
  id: string;
  fromCameraId: string;
  toCameraId: string;
  transitMinSec: number;
  transitMaxSec: number;
  direction: 'inbound' | 'outbound' | 'bidirectional' | null;
  enabled: boolean;
}

export interface NextCameraExpectation {
  cameraId: string;
  transitMinSec: number;
  transitMaxSec: number;
  direction: string | null;
}

export interface CameraGroupInfo {
  groupId: string;
  memberIds: string[];
}

export type TopologyAnomalyType = 'skip_detected' | 'transit_violation' | 'disappearance';

export interface TopologyAnomaly {
  type: TopologyAnomalyType;
  globalPersonId: string;
  personId: string | null;
  fromCameraId: string;
  toCameraId: string | null;
  elapsedSec: number;
  expectedMinSec: number | null;
  expectedMaxSec: number | null;
  skippedCameraId: string | null;
  timestamp: number;
  description: string;
}

interface PersonLastSeen {
  globalPersonId: string;
  personId: string | null;
  cameraId: string;
  timestamp: number;
  entryTimestamp: number; // when first seen on property
}

// --- Constants ---

const EDGE_CACHE_TTL_MS = 30_000;
const GROUP_CACHE_TTL_MS = 60_000;
const DEFAULT_BLIND_SPOT_MAX_SEC = 60;
const DISAPPEARANCE_CHECK_INTERVAL_MS = 30_000;

// --- TopologyService Class ---

class TopologyService extends EventEmitter {
  private edgeCache: { edges: TopologyEdge[]; loadedAt: number } | null = null;
  private groupCache: Map<string, { members: string[]; loadedAt: number }> = new Map();
  private blindSpotMaxSec: number | null = null;
  private blindSpotLoadedAt = 0;

  // Anomaly detection state
  private personLastSeen: Map<string, PersonLastSeen> = new Map(); // globalPersonId → last seen info
  private disappearanceTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Load all enabled topology edges (cached).
   */
  getEdges(): TopologyEdge[] {
    if (this.edgeCache && Date.now() - this.edgeCache.loadedAt < EDGE_CACHE_TTL_MS) {
      return this.edgeCache.edges;
    }

    try {
      const rows = getTopologyEdges() as Array<Record<string, unknown>>;
      const edges: TopologyEdge[] = rows.map((row) => ({
        id: row.id as string,
        fromCameraId: row.from_camera_id as string,
        toCameraId: row.to_camera_id as string,
        transitMinSec: row.transit_min_sec as number,
        transitMaxSec: row.transit_max_sec as number,
        direction: (row.direction as TopologyEdge['direction']) ?? null,
        enabled: row.enabled !== 0,
      }));

      this.edgeCache = { edges, loadedAt: Date.now() };
      return edges;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TopologyService] Failed to load edges: ${message}`);
      return this.edgeCache?.edges ?? [];
    }
  }

  /**
   * Get expected next cameras reachable from the given camera.
   * Returns edges where fromCameraId matches (outgoing connections).
   */
  getExpectedNextCameras(currentCameraId: string): NextCameraExpectation[] {
    if (!currentCameraId) return [];

    const edges = this.getEdges();
    const results: NextCameraExpectation[] = [];

    for (const edge of edges) {
      if (edge.fromCameraId === currentCameraId) {
        results.push({
          cameraId: edge.toCameraId,
          transitMinSec: edge.transitMinSec,
          transitMaxSec: edge.transitMaxSec,
          direction: edge.direction,
        });
      }
    }

    return results;
  }

  /**
   * Check if the elapsed time between two cameras is within the topology transit window.
   * Returns true if:
   *  - An edge exists from fromCamera to toCamera
   *  - elapsedSec is within [transitMinSec, transitMaxSec]
   *
   * If no edge exists, returns false.
   */
  isTransitTimeValid(fromCameraId: string, toCameraId: string, elapsedSec: number): boolean {
    if (!fromCameraId || !toCameraId) return false;

    const edges = this.getEdges();

    for (const edge of edges) {
      if (edge.fromCameraId === fromCameraId && edge.toCameraId === toCameraId) {
        return elapsedSec >= edge.transitMinSec && elapsedSec <= edge.transitMaxSec;
      }
    }

    return false;
  }

  /**
   * Get the transit time window between two cameras.
   * Returns null if no edge exists.
   */
  getTransitWindow(fromCameraId: string, toCameraId: string): { minSec: number; maxSec: number } | null {
    if (!fromCameraId || !toCameraId) return null;

    const edges = this.getEdges();

    for (const edge of edges) {
      if (edge.fromCameraId === fromCameraId && edge.toCameraId === toCameraId) {
        return { minSec: edge.transitMinSec, maxSec: edge.transitMaxSec };
      }
    }

    return null;
  }

  /**
   * Check if two cameras are in the same camera group.
   */
  areInSameGroup(cameraIdA: string, cameraIdB: string): boolean {
    if (!cameraIdA || !cameraIdB) return false;
    if (cameraIdA === cameraIdB) return true;

    try {
      const groupA = this.getCameraGroupId(cameraIdA);
      const groupB = this.getCameraGroupId(cameraIdB);

      if (!groupA || !groupB) return false;
      return groupA === groupB;
    } catch {
      return false;
    }
  }

  /**
   * Get the camera_group_id for a given camera.
   */
  getCameraGroupId(cameraId: string): string | null {
    if (!cameraId) return null;

    try {
      const row = getDb()
        .prepare('SELECT camera_group_id FROM cameras WHERE id = ?')
        .get(cameraId) as { camera_group_id: string | null } | undefined;
      return row?.camera_group_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get all camera IDs in the same group as the given camera.
   * Returns empty array if camera has no group.
   */
  getGroupMembers(cameraId: string): string[] {
    const groupId = this.getCameraGroupId(cameraId);
    if (!groupId) return [];

    const cached = this.groupCache.get(groupId);
    if (cached && Date.now() - cached.loadedAt < GROUP_CACHE_TTL_MS) {
      return cached.members;
    }

    try {
      const rows = getCamerasByGroup(groupId);
      const members = rows.map((r) => r.id);
      this.groupCache.set(groupId, { members, loadedAt: Date.now() });
      return members;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TopologyService] Failed to get group members for ${groupId}: ${message}`);
      return cached?.members ?? [];
    }
  }

  /**
   * Get the blind spot max timeout in seconds.
   * After this duration without detection, a journey is considered expired.
   */
  getBlindSpotMaxSec(): number {
    if (this.blindSpotMaxSec !== null && Date.now() - this.blindSpotLoadedAt < EDGE_CACHE_TTL_MS) {
      return this.blindSpotMaxSec;
    }

    try {
      const val = getSetting('topology_blind_spot_max_sec');
      this.blindSpotMaxSec = val ? parseInt(val, 10) : DEFAULT_BLIND_SPOT_MAX_SEC;
      this.blindSpotLoadedAt = Date.now();
      return this.blindSpotMaxSec;
    } catch {
      return DEFAULT_BLIND_SPOT_MAX_SEC;
    }
  }

  /**
   * Check if there is a direct edge from one camera to another (regardless of transit time).
   */
  hasDirectEdge(fromCameraId: string, toCameraId: string): boolean {
    if (!fromCameraId || !toCameraId) return false;

    const edges = this.getEdges();
    return edges.some(
      (edge) => edge.fromCameraId === fromCameraId && edge.toCameraId === toCameraId
    );
  }

  /**
   * Invalidate all caches (call after topology edge changes).
   */
  invalidateCache(): void {
    this.edgeCache = null;
    this.groupCache.clear();
    this.blindSpotMaxSec = null;
    console.log('[TopologyService] Cache invalidated.');
  }

  // --- Anomaly Detection ---

  /**
   * Start the disappearance check timer.
   */
  startAnomalyDetection(): void {
    if (this.disappearanceTimer) return;

    this.disappearanceTimer = setInterval(() => {
      this.checkDisappearances();
    }, DISAPPEARANCE_CHECK_INTERVAL_MS);

    console.log('[TopologyService] Anomaly detection started.');
  }

  /**
   * Stop the disappearance check timer.
   */
  stopAnomalyDetection(): void {
    if (this.disappearanceTimer) {
      clearInterval(this.disappearanceTimer);
      this.disappearanceTimer = null;
    }
    console.log('[TopologyService] Anomaly detection stopped.');
  }

  /**
   * Record a person detection for anomaly tracking.
   * Call this whenever a person is detected at a camera (from DetectionPipeline/EventProcessor).
   *
   * Returns any anomalies detected by this transition.
   */
  recordDetection(
    globalPersonId: string,
    personId: string | null,
    cameraId: string,
    timestamp: number
  ): TopologyAnomaly[] {
    if (!globalPersonId || !cameraId) return [];

    const anomalies: TopologyAnomaly[] = [];
    const previous = this.personLastSeen.get(globalPersonId);

    if (previous && previous.cameraId !== cameraId) {
      const elapsedSec = (timestamp - previous.timestamp) / 1000;

      // Check for skip detection: is the transition expected?
      const expectedNext = this.getExpectedNextCameras(previous.cameraId);
      const directEdge = expectedNext.find((e) => e.cameraId === cameraId);

      if (!directEdge && expectedNext.length > 0) {
        // Person appeared at an unexpected camera — check if they skipped one
        const skippedCameras = expectedNext
          .filter((e) => e.cameraId !== cameraId)
          .map((e) => e.cameraId);

        // Check if the actual destination is reachable via a skipped camera
        for (const skippedId of skippedCameras) {
          if (this.hasDirectEdge(skippedId, cameraId)) {
            const anomaly: TopologyAnomaly = {
              type: 'skip_detected',
              globalPersonId,
              personId: personId ?? previous.personId,
              fromCameraId: previous.cameraId,
              toCameraId: cameraId,
              elapsedSec: Math.round(elapsedSec),
              expectedMinSec: null,
              expectedMaxSec: null,
              skippedCameraId: skippedId,
              timestamp,
              description: `Person ${personId ?? globalPersonId} skipped camera ${skippedId} (${previous.cameraId} → ${cameraId})`,
            };
            anomalies.push(anomaly);
            this.emit('topology:anomaly', anomaly);
            console.warn(`[TopologyService] ANOMALY: Skip detected — ${anomaly.description}`);
          }
        }
      }

      // Check for transit time violation
      if (directEdge) {
        const isValid = elapsedSec >= directEdge.transitMinSec && elapsedSec <= directEdge.transitMaxSec;
        if (!isValid) {
          const anomaly: TopologyAnomaly = {
            type: 'transit_violation',
            globalPersonId,
            personId: personId ?? previous.personId,
            fromCameraId: previous.cameraId,
            toCameraId: cameraId,
            elapsedSec: Math.round(elapsedSec),
            expectedMinSec: directEdge.transitMinSec,
            expectedMaxSec: directEdge.transitMaxSec,
            skippedCameraId: null,
            timestamp,
            description: `Person ${personId ?? globalPersonId} transit ${previous.cameraId} → ${cameraId} took ${Math.round(elapsedSec)}s (expected ${directEdge.transitMinSec}-${directEdge.transitMaxSec}s)`,
          };
          anomalies.push(anomaly);
          this.emit('topology:anomaly', anomaly);
          console.warn(`[TopologyService] ANOMALY: Transit violation — ${anomaly.description}`);
        }
      }
    }

    // Update last seen
    this.personLastSeen.set(globalPersonId, {
      globalPersonId,
      personId: personId ?? previous?.personId ?? null,
      cameraId,
      timestamp,
      entryTimestamp: previous?.entryTimestamp ?? timestamp,
    });

    return anomalies;
  }

  /**
   * Check for persons who have disappeared (not seen for > blind_spot_max_sec).
   * Emits 'topology:anomaly' events for each disappearance.
   */
  private checkDisappearances(): void {
    const now = Date.now();
    const maxSec = this.getBlindSpotMaxSec();
    const maxMs = maxSec * 1000;

    for (const [gid, info] of this.personLastSeen.entries()) {
      const elapsed = now - info.timestamp;
      if (elapsed > maxMs) {
        const anomaly: TopologyAnomaly = {
          type: 'disappearance',
          globalPersonId: gid,
          personId: info.personId,
          fromCameraId: info.cameraId,
          toCameraId: null,
          elapsedSec: Math.round(elapsed / 1000),
          expectedMinSec: null,
          expectedMaxSec: maxSec,
          skippedCameraId: null,
          timestamp: now,
          description: `Person ${info.personId ?? gid} last seen at ${info.cameraId} ${Math.round(elapsed / 1000)}s ago (threshold: ${maxSec}s)`,
        };

        this.emit('topology:anomaly', anomaly);
        console.warn(`[TopologyService] ANOMALY: Disappearance — ${anomaly.description}`);

        // Remove from tracking to avoid repeated alerts
        this.personLastSeen.delete(gid);
      }
    }
  }

  /**
   * Predict which camera a person will appear at next based on topology.
   * Returns the most likely next camera and expected transit window.
   */
  predictNextCamera(globalPersonId: string): NextCameraExpectation | null {
    const lastSeen = this.personLastSeen.get(globalPersonId);
    if (!lastSeen) return null;

    const expectations = this.getExpectedNextCameras(lastSeen.cameraId);
    if (expectations.length === 0) return null;

    // Return the first expected camera (could be enhanced with historical data)
    // For now, prioritize by shortest transit time
    return expectations.sort((a, b) => a.transitMinSec - b.transitMinSec)[0] ?? null;
  }

  /**
   * Get all currently tracked persons with their last-seen info.
   */
  getTrackedPersons(): PersonLastSeen[] {
    return Array.from(this.personLastSeen.values());
  }

  /**
   * Clear a specific person from tracking (e.g., when they leave the property).
   */
  clearPersonTracking(globalPersonId: string): void {
    this.personLastSeen.delete(globalPersonId);
  }

  /**
   * Clear all person tracking state.
   */
  clearAllTracking(): void {
    this.personLastSeen.clear();
  }

  // --- Floor Plan Position Estimation ---

  /**
   * Estimate a person's current position on the floor plan.
   *
   * Uses the last-seen camera's floor coordinates as a base,
   * and if a next camera is predicted, interpolates between them
   * based on elapsed time vs expected transit time.
   *
   * @param globalPersonId - The global person ID to estimate position for.
   * @param cameraPositions - Map of cameraId → {x, y} floor coordinates.
   * @returns Estimated {x, y} position or null if unknown.
   */
  estimateFloorPosition(
    globalPersonId: string,
    cameraPositions: Map<string, { x: number; y: number }>
  ): { x: number; y: number; cameraId: string; confidence: number } | null {
    const lastSeen = this.personLastSeen.get(globalPersonId);
    if (!lastSeen) return null;

    const fromPos = cameraPositions.get(lastSeen.cameraId);
    if (!fromPos) return null;

    const elapsedMs = Date.now() - lastSeen.timestamp;
    const elapsedSec = elapsedMs / 1000;

    // If recently seen (< 3s), return camera position with high confidence
    if (elapsedSec < 3) {
      return { x: fromPos.x, y: fromPos.y, cameraId: lastSeen.cameraId, confidence: 1.0 };
    }

    // Try to interpolate toward predicted next camera
    const predicted = this.predictNextCamera(globalPersonId);
    if (!predicted) {
      // No prediction — stay at last camera with decaying confidence
      const decay = Math.max(0.1, 1.0 - (elapsedSec / 60));
      return { x: fromPos.x, y: fromPos.y, cameraId: lastSeen.cameraId, confidence: decay };
    }

    const toPos = cameraPositions.get(predicted.cameraId);
    if (!toPos) {
      const decay = Math.max(0.1, 1.0 - (elapsedSec / 60));
      return { x: fromPos.x, y: fromPos.y, cameraId: lastSeen.cameraId, confidence: decay };
    }

    // Interpolate: progress = elapsed / expected_mid_transit
    const midTransit = (predicted.transitMinSec + predicted.transitMaxSec) / 2;
    const progress = Math.min(1.0, elapsedSec / midTransit);

    const x = fromPos.x + (toPos.x - fromPos.x) * progress;
    const y = fromPos.y + (toPos.y - fromPos.y) * progress;
    const confidence = Math.max(0.2, 1.0 - progress * 0.5);

    return { x, y, cameraId: lastSeen.cameraId, confidence };
  }

  /**
   * Get estimated positions for all tracked persons.
   *
   * @param cameraPositions - Map of cameraId → {x, y} floor coordinates.
   * @returns Array of position estimates.
   */
  getAllFloorPositions(
    cameraPositions: Map<string, { x: number; y: number }>
  ): Array<{
    globalPersonId: string;
    personId: string | null;
    x: number;
    y: number;
    cameraId: string;
    confidence: number;
  }> {
    const positions: Array<{
      globalPersonId: string;
      personId: string | null;
      x: number;
      y: number;
      cameraId: string;
      confidence: number;
    }> = [];

    for (const [gid, info] of this.personLastSeen.entries()) {
      const pos = this.estimateFloorPosition(gid, cameraPositions);
      if (pos) {
        positions.push({
          globalPersonId: gid,
          personId: info.personId,
          ...pos,
        });
      }
    }

    return positions;
  }
}

// Singleton export
export const topologyService = new TopologyService();
