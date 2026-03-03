/**
 * ZoneService — Zone detection, enter/exit events, and tripwire crossing.
 *
 * Responsibilities:
 * - CRUD for zones (backed by DatabaseService)
 * - Point-in-polygon check using ray-casting algorithm
 * - Zone event emission: zone_enter, zone_exit (track enters/leaves polygon)
 * - Tripwire crossing detection (directional line with track correlation)
 * - Loitering detection (added in Task 7.2)
 */

import { EventEmitter } from 'events';
import {
  createZone,
  getZonesByCamera,
  getZone,
  updateZone,
  deleteZone,
  getSetting,
  getDb,
} from './DatabaseService';

// --- Types ---

export interface ZonePolygon {
  points: Array<{ x: number; y: number }>;
}

export interface TripwireGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'left_to_right' | 'right_to_left';
}

export interface ZoneDefinition {
  id: string;
  cameraId: string;
  name: string;
  zoneType: 'RESTRICTED' | 'MONITORED' | 'COUNTING' | 'TRIPWIRE';
  geometry: ZonePolygon | TripwireGeometry;
  color: string;
  alertEnabled: boolean;
  loiterThresholdSec: number;
  loiterCooldownSec: number;
  loiterMovementRadius: number;
  enabled: boolean;
}

export interface TrackedObjectInput {
  trackId: number;
  objectClass: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
}

export interface ZoneEvent {
  zoneId: string;
  zoneName: string;
  zoneType: string;
  trackId: number;
  eventType: 'zone_enter' | 'zone_exit' | 'loiter' | 'tripwire_cross';
  direction?: 'IN' | 'OUT' | null;
  cameraId: string;
  timestamp: number;
}

// Per-track zone state
interface TrackZoneState {
  insideZones: Set<string>; // zone IDs the track is currently inside
  lastCentroid: { x: number; y: number };
  previousCentroid: { x: number; y: number } | null;
  // Loitering fields (Task 7.2)
  loiterEntryTime: Map<string, number>; // zoneId → timestamp when entered
  loiterCentroids: Map<string, Array<{ x: number; y: number; t: number }>>;
  loiterCooldowns: Map<string, number>; // zoneId → last loiter alert timestamp
}

// --- Geometry Helpers ---

/**
 * Ray-casting point-in-polygon test.
 * Casts a horizontal ray from the point to the right and counts intersections.
 * Odd count = inside, even = outside.
 */
function isPointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  if (polygon.length < 3) return false;

  let isInside = false;
  const { x, y } = point;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

/**
 * Get bottom-center of bounding box as the "foot point" for zone checks.
 * This is more accurate than centroid for person detection.
 */
function bboxToFootPoint(bbox: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } {
  return {
    x: (bbox.x1 + bbox.x2) / 2,
    y: bbox.y2, // bottom edge — foot position
  };
}

/**
 * Cross product for line-segment intersection test.
 */
function crossProduct(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Check if a movement segment (prev→curr) crosses a tripwire line.
 * Returns 'IN' | 'OUT' | null based on the tripwire direction.
 */
function checkTripwireCrossing(
  prev: { x: number; y: number },
  curr: { x: number; y: number },
  tripwire: TripwireGeometry
): 'IN' | 'OUT' | null {
  const { x1, y1, x2, y2 } = tripwire;

  const d1 = crossProduct(x1, y1, x2, y2, prev.x, prev.y);
  const d2 = crossProduct(x1, y1, x2, y2, curr.x, curr.y);
  const d3 = crossProduct(prev.x, prev.y, curr.x, curr.y, x1, y1);
  const d4 = crossProduct(prev.x, prev.y, curr.x, curr.y, x2, y2);

  const isIntersecting = d1 * d2 < 0 && d3 * d4 < 0;
  if (!isIntersecting) return null;

  // Determine direction based on cross product sign change
  if (tripwire.direction === 'left_to_right') {
    return d1 > 0 && d2 < 0 ? 'IN' : 'OUT';
  } else {
    return d1 < 0 && d2 > 0 ? 'IN' : 'OUT';
  }
}

// --- ZoneService Class ---

class ZoneService extends EventEmitter {
  // Per-camera, per-track zone state: Map<cameraId, Map<trackId, TrackZoneState>>
  private trackStates: Map<string, Map<number, TrackZoneState>> = new Map();

  // Zone cache per camera: Map<cameraId, { zones: ZoneDefinition[]; loadedAt: number }>
  private zoneCache: Map<string, { zones: ZoneDefinition[]; loadedAt: number }> = new Map();
  private readonly ZONE_CACHE_TTL_MS = 10_000;

  // Track expiry: remove tracks not seen for this duration
  private readonly TRACK_EXPIRY_MS = 10_000;

  // --- CRUD (delegates to DatabaseService) ---

  saveZone(data: {
    id: string;
    cameraId: string;
    name: string;
    zoneType: string;
    geometry: ZonePolygon | TripwireGeometry;
    color?: string;
    alertEnabled?: boolean;
    loiterThresholdSec?: number;
    loiterCooldownSec?: number;
    loiterMovementRadius?: number;
  }): string {
    if (!data.id || !data.cameraId || !data.name || !data.zoneType) {
      throw new Error('Zone id, cameraId, name, and zoneType are required.');
    }

    const geometryJson = JSON.stringify(data.geometry);
    const result = createZone({
      id: data.id,
      cameraId: data.cameraId,
      name: data.name,
      zoneType: data.zoneType,
      geometry: geometryJson,
      color: data.color,
      alertEnabled: data.alertEnabled,
      loiterThresholdSec: data.loiterThresholdSec,
      loiterCooldownSec: data.loiterCooldownSec,
      loiterMovementRadius: data.loiterMovementRadius,
    });

    // Invalidate cache for this camera
    this.zoneCache.delete(data.cameraId);
    console.log(`[ZoneService] Zone saved: ${data.id} (${data.name}) for camera ${data.cameraId}`);
    return result;
  }

  getZonesForCamera(cameraId: string): ZoneDefinition[] {
    if (!cameraId) return [];

    const cached = this.zoneCache.get(cameraId);
    if (cached && Date.now() - cached.loadedAt < this.ZONE_CACHE_TTL_MS) {
      return cached.zones;
    }

    try {
      const rows = getZonesByCamera(cameraId) as Array<Record<string, unknown>>;
      const zones: ZoneDefinition[] = rows.map((row) => this.rowToZoneDefinition(row));
      this.zoneCache.set(cameraId, { zones, loadedAt: Date.now() });
      return zones;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ZoneService] Failed to load zones for ${cameraId}: ${message}`);
      return [];
    }
  }

  getZoneById(id: string): ZoneDefinition | null {
    if (!id) return null;
    try {
      const row = getZone(id) as Record<string, unknown> | null;
      if (!row) return null;
      return this.rowToZoneDefinition(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ZoneService] Failed to get zone ${id}: ${message}`);
      return null;
    }
  }

  modifyZone(id: string, data: Record<string, unknown>): void {
    if (!id) throw new Error('Zone ID is required.');
    updateZone(id, data);
    // Invalidate all caches (zone could be for any camera)
    this.zoneCache.clear();
  }

  removeZone(id: string): void {
    if (!id) throw new Error('Zone ID is required.');
    deleteZone(id);
    this.zoneCache.clear();
  }

  // --- Zone Event Detection ---

  /**
   * Check tracked objects against zones for a given camera.
   * Returns zone events (enter, exit, tripwire cross).
   * Call this every frame after ByteTrack tracking.
   */
  checkZones(cameraId: string, objects: TrackedObjectInput[], timestamp: number): ZoneEvent[] {
    if (!cameraId || !objects || objects.length === 0) return [];

    const zones = this.getZonesForCamera(cameraId);
    if (zones.length === 0) return [];

    if (!this.trackStates.has(cameraId)) {
      this.trackStates.set(cameraId, new Map());
    }
    const cameraTrackStates = this.trackStates.get(cameraId)!;

    const events: ZoneEvent[] = [];
    const seenTrackIds = new Set<number>();

    for (const obj of objects) {
      if (obj.trackId == null) continue;
      seenTrackIds.add(obj.trackId);

      const footPoint = bboxToFootPoint(obj.bbox);
      let trackState = cameraTrackStates.get(obj.trackId);

      if (!trackState) {
        trackState = {
          insideZones: new Set(),
          lastCentroid: footPoint,
          previousCentroid: null,
          loiterEntryTime: new Map(),
          loiterCentroids: new Map(),
          loiterCooldowns: new Map(),
        };
        cameraTrackStates.set(obj.trackId, trackState);
      }

      const previousCentroid = trackState.lastCentroid;

      for (const zone of zones) {
        if (!zone.enabled) continue;

        if (zone.zoneType === 'TRIPWIRE') {
          // Tripwire crossing detection
          const tripwireEvents = this.checkTripwireZone(
            zone, obj.trackId, previousCentroid, footPoint, cameraId, timestamp
          );
          events.push(...tripwireEvents);
        } else {
          // Polygon zone: enter/exit detection
          const polygonEvents = this.checkPolygonZone(
            zone, obj.trackId, footPoint, trackState, cameraId, timestamp
          );
          events.push(...polygonEvents);
        }
      }

      // Update track state
      trackState.previousCentroid = previousCentroid;
      trackState.lastCentroid = footPoint;
    }

    // Generate exit events for tracks no longer seen
    this.cleanExpiredTracks(cameraId, seenTrackIds, zones, timestamp, events);

    return events;
  }

  private checkPolygonZone(
    zone: ZoneDefinition,
    trackId: number,
    footPoint: { x: number; y: number },
    trackState: TrackZoneState,
    cameraId: string,
    timestamp: number
  ): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    const geometry = zone.geometry as ZonePolygon;

    if (!geometry.points || geometry.points.length < 3) return events;

    const isInside = isPointInPolygon(footPoint, geometry.points);
    const wasInside = trackState.insideZones.has(zone.id);

    if (isInside && !wasInside) {
      // Track entered the zone
      trackState.insideZones.add(zone.id);
      events.push({
        zoneId: zone.id,
        zoneName: zone.name,
        zoneType: zone.zoneType,
        trackId,
        eventType: 'zone_enter',
        direction: 'IN',
        cameraId,
        timestamp,
      });

      // Update DB enter count
      this.incrementZoneCount(zone.id, 'enter');
    } else if (!isInside && wasInside) {
      // Track exited the zone
      trackState.insideZones.delete(zone.id);
      events.push({
        zoneId: zone.id,
        zoneName: zone.name,
        zoneType: zone.zoneType,
        trackId,
        eventType: 'zone_exit',
        direction: 'OUT',
        cameraId,
        timestamp,
      });

      // Update DB exit count
      this.incrementZoneCount(zone.id, 'exit');

      // Clear loiter state for this zone
      trackState.loiterEntryTime.delete(zone.id);
      trackState.loiterCentroids.delete(zone.id);
    }

    return events;
  }

  private checkTripwireZone(
    zone: ZoneDefinition,
    trackId: number,
    prev: { x: number; y: number },
    curr: { x: number; y: number },
    cameraId: string,
    timestamp: number
  ): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    const geometry = zone.geometry as TripwireGeometry;

    if (geometry.x1 === undefined || geometry.y1 === undefined) return events;

    const crossDirection = checkTripwireCrossing(prev, curr, geometry);
    if (crossDirection) {
      events.push({
        zoneId: zone.id,
        zoneName: zone.name,
        zoneType: zone.zoneType,
        trackId,
        eventType: 'tripwire_cross',
        direction: crossDirection,
        cameraId,
        timestamp,
      });

      // Update DB count based on direction
      if (crossDirection === 'IN') {
        this.incrementZoneCount(zone.id, 'enter');
      } else {
        this.incrementZoneCount(zone.id, 'exit');
      }
    }

    return events;
  }

  /**
   * Check loitering for all tracks currently inside zones.
   * Called each frame. Emits 'loiter' events when conditions are met.
   */
  checkLoitering(cameraId: string, objects: TrackedObjectInput[], timestamp: number): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    const cameraTrackStates = this.trackStates.get(cameraId);
    if (!cameraTrackStates) return events;

    const zones = this.getZonesForCamera(cameraId);
    if (zones.length === 0) return events;

    for (const obj of objects) {
      if (obj.trackId == null) continue;
      const trackState = cameraTrackStates.get(obj.trackId);
      if (!trackState) continue;

      const footPoint = bboxToFootPoint(obj.bbox);

      for (const zone of zones) {
        if (!zone.enabled || zone.zoneType === 'TRIPWIRE') continue;
        if (!trackState.insideZones.has(zone.id)) continue;

        // Initialize loiter tracking if not set
        if (!trackState.loiterEntryTime.has(zone.id)) {
          trackState.loiterEntryTime.set(zone.id, timestamp);
          trackState.loiterCentroids.set(zone.id, [{ x: footPoint.x, y: footPoint.y, t: timestamp }]);
          continue;
        }

        // Add current position to loiter centroids
        const centroids = trackState.loiterCentroids.get(zone.id)!;
        centroids.push({ x: footPoint.x, y: footPoint.y, t: timestamp });

        // Keep only recent centroids (last 30 seconds worth)
        const cutoff = timestamp - 30_000;
        while (centroids.length > 0 && centroids[0]!.t < cutoff) {
          centroids.shift();
        }

        // Check duration inside zone
        const entryTime = trackState.loiterEntryTime.get(zone.id)!;
        const durationSec = (timestamp - entryTime) / 1000;
        const thresholdSec = zone.loiterThresholdSec || this.getDefaultLoiterThreshold();

        if (durationSec < thresholdSec) continue;

        // Check movement radius — must be relatively stationary
        const movementRadius = this.calculateMovementRadius(centroids);
        const maxRadius = zone.loiterMovementRadius || 80;

        if (movementRadius > maxRadius) {
          // Moving too much — reset entry time to now
          trackState.loiterEntryTime.set(zone.id, timestamp);
          continue;
        }

        // Check cooldown
        const lastAlert = trackState.loiterCooldowns.get(zone.id) ?? 0;
        const cooldownSec = zone.loiterCooldownSec || this.getDefaultLoiterCooldown();

        if ((timestamp - lastAlert) / 1000 < cooldownSec) continue;

        // Emit loiter event
        trackState.loiterCooldowns.set(zone.id, timestamp);
        events.push({
          zoneId: zone.id,
          zoneName: zone.name,
          zoneType: zone.zoneType,
          trackId: obj.trackId,
          eventType: 'loiter',
          direction: null,
          cameraId,
          timestamp,
        });
      }
    }

    return events;
  }

  /**
   * Calculate the maximum distance from centroid mean — movement radius in pixels.
   */
  private calculateMovementRadius(centroids: Array<{ x: number; y: number; t: number }>): number {
    if (centroids.length < 2) return 0;

    const meanX = centroids.reduce((sum, c) => sum + c.x, 0) / centroids.length;
    const meanY = centroids.reduce((sum, c) => sum + c.y, 0) / centroids.length;

    let maxDist = 0;
    for (const c of centroids) {
      const dx = c.x - meanX;
      const dy = c.y - meanY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }

    return maxDist;
  }

  private getDefaultLoiterThreshold(): number {
    try {
      const val = getSetting('zone_default_loiter_sec');
      return val ? parseInt(val, 10) : 15;
    } catch {
      return 15;
    }
  }

  private getDefaultLoiterCooldown(): number {
    try {
      const val = getSetting('zone_default_cooldown_sec');
      return val ? parseInt(val, 10) : 180;
    } catch {
      return 180;
    }
  }

  // --- Track Cleanup ---

  private cleanExpiredTracks(
    cameraId: string,
    seenTrackIds: Set<number>,
    zones: ZoneDefinition[],
    timestamp: number,
    events: ZoneEvent[]
  ): void {
    const cameraTrackStates = this.trackStates.get(cameraId);
    if (!cameraTrackStates) return;

    for (const [trackId, state] of cameraTrackStates.entries()) {
      if (seenTrackIds.has(trackId)) continue;

      // Track disappeared — emit exit events for all zones it was inside
      for (const zoneId of state.insideZones) {
        const zone = zones.find((z) => z.id === zoneId);
        if (zone) {
          events.push({
            zoneId: zone.id,
            zoneName: zone.name,
            zoneType: zone.zoneType,
            trackId,
            eventType: 'zone_exit',
            direction: 'OUT',
            cameraId,
            timestamp,
          });
          this.incrementZoneCount(zone.id, 'exit');
        }
      }

      cameraTrackStates.delete(trackId);
    }
  }

  private incrementZoneCount(zoneId: string, type: 'enter' | 'exit'): void {
    try {
      const col = type === 'enter' ? 'enter_count' : 'exit_count';
      getDb().prepare(`UPDATE zones SET ${col} = ${col} + 1 WHERE id = ?`).run(zoneId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ZoneService] Failed to increment ${type} count for zone ${zoneId}: ${message}`);
    }
  }

  // --- DB Row Conversion ---

  private rowToZoneDefinition(row: Record<string, unknown>): ZoneDefinition {
    let geometry: ZonePolygon | TripwireGeometry;
    try {
      geometry = JSON.parse(row.geometry as string);
    } catch {
      geometry = { points: [] };
    }

    return {
      id: row.id as string,
      cameraId: row.camera_id as string,
      name: row.name as string,
      zoneType: row.zone_type as ZoneDefinition['zoneType'],
      geometry,
      color: (row.color as string) || '#FF0000',
      alertEnabled: row.alert_enabled === 1,
      loiterThresholdSec: (row.loiter_threshold_sec as number) || 15,
      loiterCooldownSec: (row.loiter_cooldown_sec as number) || 180,
      loiterMovementRadius: (row.loiter_movement_radius as number) || 80,
      enabled: row.enabled !== 0,
    };
  }

  /**
   * Invalidate zone cache (call when user saves/deletes zones).
   */
  invalidateCache(cameraId?: string): void {
    if (cameraId) {
      this.zoneCache.delete(cameraId);
    } else {
      this.zoneCache.clear();
    }
  }

  /**
   * Clear all tracking state for a camera or all cameras.
   */
  reset(cameraId?: string): void {
    if (cameraId) {
      this.trackStates.delete(cameraId);
    } else {
      this.trackStates.clear();
    }
    this.invalidateCache(cameraId);
    console.log(`[ZoneService] Reset tracking state${cameraId ? ` for ${cameraId}` : ' (all cameras)'}.`);
  }
}

// Singleton export
export const zoneService = new ZoneService();
