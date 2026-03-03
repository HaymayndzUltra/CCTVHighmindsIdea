/**
 * AnalyticsService — periodic aggregation of detection data into analytics rollups.
 *
 * Responsibilities:
 * - Hourly rollup job: aggregate detection counts, person counts, known/unknown split,
 *   zone enter/exit counts, loiter counts, behavior counts, sound event counts
 * - Store in `analytics_rollup` table via DatabaseService
 * - Heatmap data generation: bin detection bbox centers into grid cells per camera
 * - Presence timeline data: per-person home/away segments from presence_history
 */

import crypto from 'crypto';
import {
  getDb,
  upsertAnalyticsRollup,
  getAnalyticsRollup,
} from './DatabaseService';

let rollupInterval: ReturnType<typeof setInterval> | null = null;

const HEATMAP_GRID_SIZE = 20; // 20x20 grid cells

interface HeatmapCell {
  row: number;
  col: number;
  count: number;
}

interface ActivityData {
  date: string;
  hour: number;
  cameraId: string | null;
  detectionCount: number;
  personCount: number;
  knownCount: number;
  unknownCount: number;
}

interface PresenceSegment {
  personId: string;
  personName: string;
  state: string;
  startTime: string;
  endTime: string | null;
}

interface ZoneTrafficData {
  zoneId: string;
  zoneName: string;
  enterCount: number;
  exitCount: number;
  loiterCount: number;
}

/**
 * Run hourly rollup for the previous hour.
 */
export function runHourlyRollup(): void {
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  hourStart.setHours(hourStart.getHours() - 1);

  const hourEnd = new Date(hourStart);
  hourEnd.setHours(hourEnd.getHours() + 1);

  const dateStr = hourStart.toISOString().split('T')[0];
  const hour = hourStart.getHours();
  const fromStr = hourStart.toISOString();
  const toStr = hourEnd.toISOString();

  try {
    const db = getDb();

    // Get all camera IDs
    const cameras = db
      .prepare('SELECT id FROM cameras WHERE enabled = 1')
      .all() as Array<{ id: string }>;

    for (const cam of cameras) {
      const cameraId = cam.id;

      // Count events by type for this camera in this hour
      const counts = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN event_type = 'detection' THEN 1 ELSE 0 END) as detection_count,
            SUM(CASE WHEN person_id IS NOT NULL THEN 1 ELSE 0 END) as person_count,
            SUM(CASE WHEN is_known = 1 THEN 1 ELSE 0 END) as known_count,
            SUM(CASE WHEN is_known = 0 AND event_type = 'detection' THEN 1 ELSE 0 END) as unknown_count,
            SUM(CASE WHEN event_type = 'zone_enter' THEN 1 ELSE 0 END) as zone_enter_count,
            SUM(CASE WHEN event_type = 'zone_exit' THEN 1 ELSE 0 END) as zone_exit_count,
            SUM(CASE WHEN event_type = 'loiter' THEN 1 ELSE 0 END) as loiter_count,
            SUM(CASE WHEN event_type = 'behavior' THEN 1 ELSE 0 END) as behavior_count,
            SUM(CASE WHEN event_type = 'sound' THEN 1 ELSE 0 END) as sound_event_count
          FROM events
          WHERE camera_id = ? AND created_at >= ? AND created_at < ?`
        )
        .get(cameraId, fromStr, toStr) as Record<string, number>;

      const rollupId = `${cameraId}_${dateStr}_${hour}`;

      upsertAnalyticsRollup({
        id: rollupId,
        cameraId,
        rollupDate: dateStr,
        rollupHour: hour,
        detectionCount: counts.detection_count ?? 0,
        personCount: counts.person_count ?? 0,
        knownCount: counts.known_count ?? 0,
        unknownCount: counts.unknown_count ?? 0,
        zoneEnterCount: counts.zone_enter_count ?? 0,
        zoneExitCount: counts.zone_exit_count ?? 0,
        loiterCount: counts.loiter_count ?? 0,
        behaviorCount: counts.behavior_count ?? 0,
        soundEventCount: counts.sound_event_count ?? 0,
      });
    }

    console.log(`[AnalyticsService] Hourly rollup complete for ${dateStr} H${hour}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AnalyticsService] Rollup error: ${msg}`);
  }
}

/**
 * Get activity data (hourly/daily aggregated detection counts).
 */
export function getActivityData(
  cameraId: string | null,
  from: string,
  to: string
): ActivityData[] {
  const rows = getAnalyticsRollup(cameraId, from, to) as Array<{
    camera_id: string | null;
    rollup_date: string;
    rollup_hour: number | null;
    detection_count: number;
    person_count: number;
    known_count: number;
    unknown_count: number;
  }>;

  return rows.map((r) => ({
    date: r.rollup_date,
    hour: r.rollup_hour ?? 0,
    cameraId: r.camera_id,
    detectionCount: r.detection_count,
    personCount: r.person_count,
    knownCount: r.known_count,
    unknownCount: r.unknown_count,
  }));
}

/**
 * Generate heatmap data for a camera within a date range.
 * Bins detection bbox centers into a grid.
 */
export function getHeatmapData(
  cameraId: string,
  from: string,
  to: string,
  frameWidth: number = 1280,
  frameHeight: number = 720
): HeatmapCell[] {
  if (!cameraId || !from || !to) return [];

  try {
    const db = getDb();

    // Get events with bbox data
    const events = db
      .prepare(
        `SELECT bbox FROM events
         WHERE camera_id = ? AND created_at >= ? AND created_at <= ? AND bbox IS NOT NULL`
      )
      .all(cameraId, from, to) as Array<{ bbox: string }>;

    const grid: number[][] = Array.from({ length: HEATMAP_GRID_SIZE }, () =>
      new Array(HEATMAP_GRID_SIZE).fill(0)
    );

    const cellW = frameWidth / HEATMAP_GRID_SIZE;
    const cellH = frameHeight / HEATMAP_GRID_SIZE;

    for (const evt of events) {
      try {
        const bbox = JSON.parse(evt.bbox) as { x1: number; y1: number; x2: number; y2: number };
        const cx = (bbox.x1 + bbox.x2) / 2;
        const cy = (bbox.y1 + bbox.y2) / 2;
        const col = Math.min(HEATMAP_GRID_SIZE - 1, Math.max(0, Math.floor(cx / cellW)));
        const row = Math.min(HEATMAP_GRID_SIZE - 1, Math.max(0, Math.floor(cy / cellH)));
        grid[row][col]++;
      } catch {
        /* ignore parse errors */
      }
    }

    const cells: HeatmapCell[] = [];
    for (let r = 0; r < HEATMAP_GRID_SIZE; r++) {
      for (let c = 0; c < HEATMAP_GRID_SIZE; c++) {
        if (grid[r][c] > 0) {
          cells.push({ row: r, col: c, count: grid[r][c] });
        }
      }
    }

    return cells;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AnalyticsService] Heatmap error: ${msg}`);
    return [];
  }
}

/**
 * Get presence timeline data for a date range.
 */
export function getPresenceTimeline(
  from: string,
  to: string,
  personId?: string
): PresenceSegment[] {
  if (!from || !to) return [];

  try {
    const db = getDb();

    let query = `
      SELECT ph.person_id, p.name as person_name, ph.state, ph.created_at,
             LEAD(ph.created_at) OVER (PARTITION BY ph.person_id ORDER BY ph.created_at) as next_time
      FROM presence_history ph
      JOIN persons p ON p.id = ph.person_id
      WHERE ph.created_at >= ? AND ph.created_at <= ?
    `;
    const params: string[] = [from, to];

    if (personId) {
      query += ' AND ph.person_id = ?';
      params.push(personId);
    }

    query += ' ORDER BY ph.person_id, ph.created_at';

    const rows = db.prepare(query).all(...params) as Array<{
      person_id: string;
      person_name: string;
      state: string;
      created_at: string;
      next_time: string | null;
    }>;

    return rows.map((r) => ({
      personId: r.person_id,
      personName: r.person_name,
      state: r.state,
      startTime: r.created_at,
      endTime: r.next_time,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AnalyticsService] Presence timeline error: ${msg}`);
    return [];
  }
}

/**
 * Get zone traffic data for a date range.
 */
export function getZoneTrafficData(
  from: string,
  to: string,
  zoneId?: string
): ZoneTrafficData[] {
  if (!from || !to) return [];

  try {
    const db = getDb();

    let query = `
      SELECT z.id as zone_id, z.name as zone_name,
             SUM(CASE WHEN e.event_type = 'zone_enter' THEN 1 ELSE 0 END) as enter_count,
             SUM(CASE WHEN e.event_type = 'zone_exit' THEN 1 ELSE 0 END) as exit_count,
             SUM(CASE WHEN e.event_type = 'loiter' THEN 1 ELSE 0 END) as loiter_count
      FROM events e
      JOIN zones z ON z.id = e.zone_id
      WHERE e.created_at >= ? AND e.created_at <= ? AND e.zone_id IS NOT NULL
    `;
    const params: string[] = [from, to];

    if (zoneId) {
      query += ' AND e.zone_id = ?';
      params.push(zoneId);
    }

    query += ' GROUP BY z.id, z.name ORDER BY z.name';

    const rows = db.prepare(query).all(...params) as Array<{
      zone_id: string;
      zone_name: string;
      enter_count: number;
      exit_count: number;
      loiter_count: number;
    }>;

    return rows.map((r) => ({
      zoneId: r.zone_id,
      zoneName: r.zone_name,
      enterCount: r.enter_count ?? 0,
      exitCount: r.exit_count ?? 0,
      loiterCount: r.loiter_count ?? 0,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AnalyticsService] Zone traffic error: ${msg}`);
    return [];
  }
}

/**
 * Start the hourly rollup interval.
 */
export function startAnalyticsRollup(): void {
  if (rollupInterval) return;

  // Run initial rollup for the previous hour
  runHourlyRollup();

  // Schedule hourly
  const HOUR_MS = 60 * 60 * 1000;
  rollupInterval = setInterval(() => {
    runHourlyRollup();
  }, HOUR_MS);

  console.log('[AnalyticsService] Hourly rollup scheduled.');
}

/**
 * Stop the rollup interval.
 */
export function stopAnalyticsRollup(): void {
  if (rollupInterval) {
    clearInterval(rollupInterval);
    rollupInterval = null;
  }
}
