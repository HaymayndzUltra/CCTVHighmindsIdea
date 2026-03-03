/**
 * EventProcessor — Transforms raw face detections into meaningful entry/exit events.
 *
 * Responsibilities:
 * - Track bounding box centroids across consecutive detection frames per camera
 * - Determine entry/exit direction via line-crossing or heuristic fallback
 * - Capture face snapshots from frames
 * - Create event records in SQLite
 * - Emit event:new IPC to renderer
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import sharp from 'sharp';
import { createEvent, getDb, updateEventTelegram, getCamerasByGroup } from './DatabaseService';
import { emitNewEvent } from '../ipc/eventHandlers';
import { telegramService } from './TelegramService';
import type { TelegramAlertEvent } from './TelegramService';
import type { ZoneEvent } from './ZoneService';
import { journeyService } from './JourneyService';
import { presenceService } from './PresenceService';
import { topologyService } from './TopologyService';

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const CHANNELS = 3; // RGB24
const SNAPSHOT_PADDING = 40; // pixels padding around face crop

// --- Types ---

interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PipelineFaceResult {
  bbox: number[];
  label: string;
  confidence: number;
  isKnown: boolean;
  personId: string | null;
  embedding: number[];
}

interface DetectionResultPayload {
  cameraId: string;
  faces: PipelineFaceResult[];
  zoneEvents?: ZoneEvent[];
  timestamp: number;
  frameBuffer?: Buffer;
}

interface LineCrossingConfig {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  enterDirection: 'enter_from_left' | 'enter_from_right';
}

interface CentroidEntry {
  x: number;
  y: number;
  timestamp: number;
}

interface TrackedFace {
  personId: string | null;
  label: string;
  centroids: CentroidEntry[];
  lastSeen: number;
}

// --- Constants ---

const CENTROID_HISTORY_LENGTH = 5;
const TRACK_EXPIRY_MS = 5_000;
const CENTROID_MATCH_THRESHOLD = 15; // max % distance to consider same face

// --- Helpers ---

function bboxToCentroid(bbox: number[]): { x: number; y: number } {
  const x1 = bbox[0] ?? 0;
  const y1 = bbox[1] ?? 0;
  const x2 = bbox[2] ?? 0;
  const y2 = bbox[3] ?? 0;
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
}

function euclideanDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Determine if a trajectory crossed a line segment, and from which side.
 * Uses vector cross-product for side determination.
 *
 * Returns 'ENTER' | 'EXIT' | null
 */
function checkLineCrossing(
  trajectory: CentroidEntry[],
  line: LineCrossingConfig
): 'ENTER' | 'EXIT' | null {
  if (trajectory.length < 2) {
    return null;
  }

  const prev = trajectory[trajectory.length - 2]!;
  const curr = trajectory[trajectory.length - 1]!;

  // Line segment: A(x1,y1) → B(x2,y2)
  // Trajectory segment: P(prev) → Q(curr)
  const ax = line.x1;
  const ay = line.y1;
  const bx = line.x2;
  const by = line.y2;
  const px = prev.x;
  const py = prev.y;
  const qx = curr.x;
  const qy = curr.y;

  // Cross products to check if segments intersect
  const d1 = crossProduct(ax, ay, bx, by, px, py);
  const d2 = crossProduct(ax, ay, bx, by, qx, qy);
  const d3 = crossProduct(px, py, qx, qy, ax, ay);
  const d4 = crossProduct(px, py, qx, qy, bx, by);

  // Segments intersect if d1 and d2 have different signs, and d3 and d4 have different signs
  const isIntersecting = d1 * d2 < 0 && d3 * d4 < 0;

  if (!isIntersecting) {
    return null;
  }

  // Determine direction based on which side the centroid moved to
  // d2 is the cross product of the line with the current position
  // Positive = left side, Negative = right side
  if (line.enterDirection === 'enter_from_left') {
    // Moving from left (positive cross) to right (negative cross) = ENTER
    return d1 > 0 && d2 < 0 ? 'ENTER' : 'EXIT';
  } else {
    // enter_from_right: Moving from right (negative) to left (positive) = ENTER
    return d1 < 0 && d2 > 0 ? 'ENTER' : 'EXIT';
  }
}

function crossProduct(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function getSnapshotDir(cameraId: string): string {
  const userDataPath = app.getPath('userData');
  const dateStr = new Date().toISOString().slice(0, 10);
  return path.join(userDataPath, 'snapshots', dateStr, cameraId);
}

// --- EventProcessor Class ---

class EventProcessor {
  // Per-camera tracked faces: Map<cameraId, TrackedFace[]>
  private trackedFaces: Map<string, TrackedFace[]> = new Map();

  // Cache for line-crossing configs: Map<cameraId, LineCrossingConfig | null>
  private lineConfigCache: Map<string, { config: LineCrossingConfig | null; loadedAt: number }> = new Map();
  private readonly LINE_CONFIG_CACHE_TTL_MS = 30_000;

  // Cache for heuristic directions: Map<cameraId, string | null>
  private heuristicCache: Map<string, { direction: string | null; loadedAt: number }> = new Map();

  // Camera group dedup buffer: Map<dedupKey(personId+groupId), DedupEntry>
  private groupDedupBuffer: Map<string, {
    eventId: string;
    cameraId: string;
    personId: string | null;
    personName: string;
    confidence: number;
    snapshotPath: string | null;
    timestamp: number;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private readonly GROUP_DEDUP_WINDOW_MS = 5_000;

  constructor() {
    telegramService.onSendResult((eventId: string, success: boolean) => {
      try {
        updateEventTelegram(eventId, success);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EventProcessor] Failed to update telegram_sent for event ${eventId}: ${msg}`);
      }
    });
  }

  /**
   * Process a detection result from the DetectionPipeline.
   * For each detected face: track centroid → determine direction → save snapshot → create event → emit IPC.
   */
  async processDetection(payload: DetectionResultPayload): Promise<void> {
    const { cameraId, faces, zoneEvents, timestamp, frameBuffer } = payload;

    // Process zone events independently of face detections
    if (zoneEvents && zoneEvents.length > 0) {
      this.processZoneEvents(cameraId, zoneEvents, timestamp);
    }

    if (!faces || faces.length === 0) {
      return;
    }

    // Clean expired tracks for this camera
    this.cleanExpiredTracks(cameraId, timestamp);

    const lineConfig = this.getLineCrossingConfig(cameraId);

    for (const face of faces) {
      try {
        await this.processSingleFace(cameraId, face, timestamp, frameBuffer ?? null, lineConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[EventProcessor][${cameraId}] Failed to process face: ${message}`);
      }
    }
  }

  private async processSingleFace(
    cameraId: string,
    face: PipelineFaceResult,
    timestamp: number,
    frameBuffer: Buffer | null,
    lineConfig: LineCrossingConfig | null
  ): Promise<void> {
    const centroid = bboxToCentroid(face.bbox);
    const centroidEntry: CentroidEntry = { x: centroid.x, y: centroid.y, timestamp };

    // Update centroid tracking
    const tracked = this.updateTracking(cameraId, face, centroidEntry);

    // Determine direction
    let direction: 'ENTER' | 'EXIT' | 'INSIDE' | null = null;
    let detectionMethod: 'line_crossing' | 'heuristic' | null = null;

    if (lineConfig) {
      const crossResult = checkLineCrossing(tracked.centroids, lineConfig);
      if (crossResult) {
        direction = crossResult;
        detectionMethod = 'line_crossing';
      }
    }

    // Heuristic fallback if no line crossing detected
    if (!direction) {
      const heuristic = this.getHeuristicDirection(cameraId);
      if (heuristic) {
        direction = heuristic as 'ENTER' | 'EXIT' | 'INSIDE';
        detectionMethod = 'heuristic';
      }
    }

    // Only create event if we have a direction (line crossing detected or heuristic available)
    // For line_crossing, only create on actual crossing; for heuristic, create on first detection
    if (detectionMethod === 'line_crossing' && direction) {
      // Line crossing detected — always create event
    } else if (detectionMethod === 'heuristic' && tracked.centroids.length <= 1) {
      // Heuristic: create event on first appearance only
    } else {
      // No direction or already tracked — skip event creation
      return;
    }

    // Capture snapshot
    let snapshotPath: string | null = null;
    if (frameBuffer) {
      snapshotPath = await this.captureSnapshot(cameraId, face, frameBuffer, timestamp);
    }

    // Build bbox object
    const bbox: BoundingBox = {
      x1: face.bbox[0] ?? 0,
      y1: face.bbox[1] ?? 0,
      x2: face.bbox[2] ?? 0,
      y2: face.bbox[3] ?? 0,
    };

    // Create event record
    const eventId = crypto.randomUUID();
    const eventData = {
      id: eventId,
      cameraId,
      personId: face.personId,
      personName: face.label || 'Unknown',
      isKnown: face.isKnown,
      direction,
      detectionMethod,
      confidence: face.confidence,
      bbox,
      snapshotPath,
      clipPath: null,
    };

    try {
      createEvent(eventData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EventProcessor][${cameraId}] Failed to create event: ${message}`);
      return;
    }

    // Emit to renderer
    const ipcPayload = {
      id: eventId,
      cameraId,
      personId: face.personId,
      personName: face.label || 'Unknown',
      isKnown: face.isKnown,
      direction,
      detectionMethod,
      confidence: face.confidence,
      bbox,
      snapshotPath,
      clipPath: null,
      telegramSent: false,
      telegramSentAt: null,
      createdAt: new Date().toISOString(),
    };

    emitNewEvent(ipcPayload);

    console.log(
      `[EventProcessor][${cameraId}] Event created: ${eventId} | ` +
      `${face.label} | ${direction} (${detectionMethod}) | confidence=${face.confidence.toFixed(2)}`
    );

    // Camera group dedup: if camera is in a group, buffer and pick best snapshot
    const groupId = topologyService.getCameraGroupId(cameraId);
    if (groupId && face.personId) {
      this.handleGroupDedup(groupId, eventId, cameraId, face, snapshotPath, timestamp);
    } else {
      // Trigger Telegram notification if enabled and person is unknown (MVP rule)
      this.triggerTelegramAlert(eventId, cameraId, face, direction, snapshotPath);
    }

    // Journey + Presence integration for known persons
    if (face.isKnown && face.personId) {
      try {
        journeyService.processDetection(
          face.personId,
          face.label || 'Unknown',
          cameraId,
          timestamp
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EventProcessor] JourneyService error: ${msg}`);
      }

      try {
        presenceService.processDetection(
          face.personId,
          face.label || 'Unknown',
          cameraId,
          timestamp
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EventProcessor] PresenceService error: ${msg}`);
      }
    }
  }

  // --- Camera Group Deduplication ---

  /**
   * Buffer events within a camera group window (5s).
   * When window expires, emit the event with the best-quality snapshot.
   * If a better snapshot arrives from another camera in the group, replace.
   */
  private handleGroupDedup(
    groupId: string,
    eventId: string,
    cameraId: string,
    face: PipelineFaceResult,
    snapshotPath: string | null,
    timestamp: number
  ): void {
    const personKey = face.personId ?? '__unknown__';
    const dedupKey = `${personKey}:${groupId}`;
    const existing = this.groupDedupBuffer.get(dedupKey);

    if (existing) {
      // Compare quality — higher confidence wins
      if (face.confidence > existing.confidence) {
        existing.eventId = eventId;
        existing.cameraId = cameraId;
        existing.confidence = face.confidence;
        existing.snapshotPath = snapshotPath;
        existing.personName = face.label || 'Unknown';
      }
      // Let the existing timer handle emission
      console.log(
        `[EventProcessor] Group dedup: suppressed ${cameraId} event for ${face.label} (better from ${existing.cameraId})`
      );
      return;
    }

    // First event in window — start timer
    const timer = setTimeout(() => {
      this.flushGroupDedupEntry(dedupKey, face);
    }, this.GROUP_DEDUP_WINDOW_MS);

    this.groupDedupBuffer.set(dedupKey, {
      eventId,
      cameraId,
      personId: face.personId,
      personName: face.label || 'Unknown',
      confidence: face.confidence,
      snapshotPath,
      timestamp,
      timer,
    });
  }

  private flushGroupDedupEntry(dedupKey: string, face: PipelineFaceResult): void {
    const entry = this.groupDedupBuffer.get(dedupKey);
    this.groupDedupBuffer.delete(dedupKey);

    if (!entry) return;

    // Trigger Telegram with the best snapshot from the group
    this.triggerTelegramAlert(
      entry.eventId,
      entry.cameraId,
      { ...face, confidence: entry.confidence, label: entry.personName },
      null,
      entry.snapshotPath
    );

    console.log(
      `[EventProcessor] Group dedup flushed: ${entry.eventId} | ${entry.personName} | best from ${entry.cameraId}`
    );
  }

  // --- Centroid Tracking ---

  private updateTracking(
    cameraId: string,
    face: PipelineFaceResult,
    centroidEntry: CentroidEntry
  ): TrackedFace {
    if (!this.trackedFaces.has(cameraId)) {
      this.trackedFaces.set(cameraId, []);
    }

    const tracks = this.trackedFaces.get(cameraId)!;

    // Find closest existing track by centroid distance
    let bestMatch: TrackedFace | null = null;
    let bestDistance = Infinity;

    for (const track of tracks) {
      if (track.centroids.length === 0) continue;

      const lastCentroid = track.centroids[track.centroids.length - 1]!;
      const dist = euclideanDistance(centroidEntry, lastCentroid);

      // Also match by personId if available
      const isPersonMatch = face.personId && track.personId === face.personId;

      if (isPersonMatch || dist < CENTROID_MATCH_THRESHOLD) {
        if (dist < bestDistance) {
          bestDistance = dist;
          bestMatch = track;
        }
      }
    }

    if (bestMatch) {
      bestMatch.centroids.push(centroidEntry);
      if (bestMatch.centroids.length > CENTROID_HISTORY_LENGTH) {
        bestMatch.centroids.shift();
      }
      bestMatch.lastSeen = centroidEntry.timestamp;
      bestMatch.label = face.label;
      bestMatch.personId = face.personId;
      return bestMatch;
    }

    // New track
    const newTrack: TrackedFace = {
      personId: face.personId,
      label: face.label,
      centroids: [centroidEntry],
      lastSeen: centroidEntry.timestamp,
    };
    tracks.push(newTrack);
    return newTrack;
  }

  private cleanExpiredTracks(cameraId: string, now: number): void {
    const tracks = this.trackedFaces.get(cameraId);
    if (!tracks) return;

    const active = tracks.filter((t) => now - t.lastSeen < TRACK_EXPIRY_MS);
    this.trackedFaces.set(cameraId, active);
  }

  // --- Telegram Integration ---

  private triggerTelegramAlert(
    eventId: string,
    cameraId: string,
    face: PipelineFaceResult,
    direction: 'ENTER' | 'EXIT' | 'INSIDE' | null,
    snapshotPath: string | null
  ): void {
    if (!telegramService.isConfigured()) {
      return;
    }

    const cameraLabel = this.getCameraLabel(cameraId);

    const alertEvent: TelegramAlertEvent = {
      id: eventId,
      cameraId,
      cameraLabel,
      personId: face.personId,
      personName: face.label || 'Unknown',
      isKnown: face.isKnown,
      direction,
      confidence: face.confidence,
      snapshotPath,
      createdAt: new Date().toISOString(),
    };

    telegramService
      .sendAlert(alertEvent)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[EventProcessor] Telegram alert failed for event ${eventId}: ${message}`);
      });
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

  // --- Line Crossing Config ---

  private getLineCrossingConfig(cameraId: string): LineCrossingConfig | null {
    const cached = this.lineConfigCache.get(cameraId);
    if (cached && Date.now() - cached.loadedAt < this.LINE_CONFIG_CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const row = getDb()
        .prepare('SELECT line_crossing_config FROM cameras WHERE id = ?')
        .get(cameraId) as { line_crossing_config: string | null } | undefined;

      if (!row || !row.line_crossing_config) {
        this.lineConfigCache.set(cameraId, { config: null, loadedAt: Date.now() });
        return null;
      }

      const config = JSON.parse(row.line_crossing_config) as LineCrossingConfig;
      this.lineConfigCache.set(cameraId, { config, loadedAt: Date.now() });
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EventProcessor] Failed to load line config for ${cameraId}: ${message}`);
      this.lineConfigCache.set(cameraId, { config: null, loadedAt: Date.now() });
      return null;
    }
  }

  // --- Heuristic Fallback ---

  private getHeuristicDirection(cameraId: string): string | null {
    const cached = this.heuristicCache.get(cameraId);
    if (cached && Date.now() - cached.loadedAt < this.LINE_CONFIG_CACHE_TTL_MS) {
      return cached.direction;
    }

    try {
      const row = getDb()
        .prepare('SELECT heuristic_direction FROM cameras WHERE id = ?')
        .get(cameraId) as { heuristic_direction: string | null } | undefined;

      const direction = row?.heuristic_direction ?? null;
      this.heuristicCache.set(cameraId, { direction, loadedAt: Date.now() });
      return direction;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EventProcessor] Failed to load heuristic for ${cameraId}: ${message}`);
      this.heuristicCache.set(cameraId, { direction: null, loadedAt: Date.now() });
      return null;
    }
  }

  // --- Composite Alert Image (FaceTracker-style) ---

  // Layout constants
  private readonly COMP_LEFT_W = 540;
  private readonly COMP_LEFT_H = 360;
  private readonly COMP_RIGHT_W = 300;
  private readonly COMP_HEADER_H = 36;
  private readonly COMP_INFO_H = 32;

  private async captureSnapshot(
    cameraId: string,
    face: PipelineFaceResult,
    frameBuffer: Buffer,
    timestamp: number
  ): Promise<string | null> {
    try {
      const snapshotDir = getSnapshotDir(cameraId);
      if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
      }

      const safeName = (face.label || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${timestamp}_${safeName}.jpg`;
      const filePath = path.join(snapshotDir, filename);

      // Determine source frame dimensions
      const isJpeg =
        frameBuffer.length >= 3 &&
        frameBuffer[0] === 0xff &&
        frameBuffer[1] === 0xd8 &&
        frameBuffer[2] === 0xff;

      // Convert raw RGB24 to JPEG first if needed
      let frameJpeg: Buffer;
      if (isJpeg) {
        frameJpeg = frameBuffer;
      } else {
        const expectedSize = FRAME_WIDTH * FRAME_HEIGHT * CHANNELS;
        const rawW = frameBuffer.length === expectedSize ? FRAME_WIDTH : Math.round(Math.sqrt(frameBuffer.length / CHANNELS * (16 / 9)));
        const rawH = frameBuffer.length === expectedSize ? FRAME_HEIGHT : Math.round(rawW * 9 / 16);
        frameJpeg = await sharp(frameBuffer, {
          raw: { width: rawW, height: rawH, channels: CHANNELS },
        }).jpeg({ quality: 90 }).toBuffer();
      }

      // Build the composite alert image
      const compositeBuffer = await this.buildCompositeAlert(
        frameJpeg, face, cameraId, timestamp
      );

      fs.writeFileSync(filePath, compositeBuffer);
      return filePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EventProcessor] Snapshot capture failed for ${cameraId}: ${message}`);
      return null;
    }
  }

  /**
   * Build a FaceTracker-style composite alert image:
   *   ┌─────────── 840px ───────────┐
   *   │  Header: Camera | Timestamp │  36px
   *   ├──────────┬──────────────────┤
   *   │  Frame   │   Face Crop     │
   *   │  540x360 │   300x360       │  360px
   *   │ (+ bbox) │   (upscaled)    │
   *   ├──────────┴──────────────────┤
   *   │  Info: Name | Conf | Dir   │  32px
   *   └────────────────────────────┘
   */
  private async buildCompositeAlert(
    frameJpeg: Buffer,
    face: PipelineFaceResult,
    cameraId: string,
    timestamp: number
  ): Promise<Buffer> {
    const leftW = this.COMP_LEFT_W;
    const leftH = this.COMP_LEFT_H;
    const rightW = this.COMP_RIGHT_W;
    const headerH = this.COMP_HEADER_H;
    const infoH = this.COMP_INFO_H;
    const totalW = leftW + rightW; // 840
    const totalH = headerH + leftH + infoH; // 428

    // --- Left panel: resized frame ---
    const frameMeta = await sharp(frameJpeg).metadata();
    const origW = frameMeta.width ?? FRAME_WIDTH;
    const origH = frameMeta.height ?? FRAME_HEIGHT;

    const leftPanel = await sharp(frameJpeg)
      .resize(leftW, leftH, { fit: 'fill' })
      .toBuffer();

    // --- SVG overlay for bbox on left panel ---
    const sx = leftW / origW;
    const sy = leftH / origH;
    const bx1 = Math.round((face.bbox[0] ?? 0) * sx);
    const by1 = Math.round((face.bbox[1] ?? 0) * sy);
    const bx2 = Math.round((face.bbox[2] ?? 0) * sx);
    const by2 = Math.round((face.bbox[3] ?? 0) * sy);
    const bboxW = bx2 - bx1;
    const bboxH = by2 - by1;
    const boxColor = face.isKnown ? '#00c800' : '#dc0000';

    const bboxSvg = Buffer.from(
      `<svg width="${leftW}" height="${leftH}">
        <rect x="${bx1}" y="${by1}" width="${bboxW}" height="${bboxH}"
              fill="none" stroke="${boxColor}" stroke-width="2" rx="2"/>
      </svg>`
    );

    const leftWithBbox = await sharp(leftPanel)
      .composite([{ input: bboxSvg, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    // --- Right panel: face crop (upscaled to fill 300x360) ---
    let rightPanel: Buffer;
    const fbx1 = Math.max(0, Math.round(face.bbox[0] ?? 0) - SNAPSHOT_PADDING);
    const fby1 = Math.max(0, Math.round(face.bbox[1] ?? 0) - SNAPSHOT_PADDING);
    const fbx2 = Math.min(origW, Math.round(face.bbox[2] ?? origW) + SNAPSHOT_PADDING);
    const fby2 = Math.min(origH, Math.round(face.bbox[3] ?? origH) + SNAPSHOT_PADDING);
    const cropW = fbx2 - fbx1;
    const cropH = fby2 - fby1;

    if (cropW > 10 && cropH > 10) {
      try {
        rightPanel = await sharp(frameJpeg)
          .extract({ left: fbx1, top: fby1, width: cropW, height: cropH })
          .resize(rightW, leftH, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
          .jpeg({ quality: 90 })
          .toBuffer();
      } catch {
        // Fallback: dark placeholder
        rightPanel = await sharp({
          create: { width: rightW, height: leftH, channels: 3, background: { r: 20, g: 20, b: 20 } },
        }).jpeg({ quality: 90 }).toBuffer();
      }
    } else {
      rightPanel = await sharp({
        create: { width: rightW, height: leftH, channels: 3, background: { r: 20, g: 20, b: 20 } },
      }).jpeg({ quality: 90 }).toBuffer();
    }

    // --- Header bar ---
    const cameraLabel = this.getCameraLabel(cameraId);
    const tsStr = new Date(timestamp).toLocaleString();
    const escCam = this.escSvgText(cameraLabel);
    const escTs = this.escSvgText(tsStr);

    const headerSvg = Buffer.from(
      `<svg width="${totalW}" height="${headerH}">
        <rect width="${totalW}" height="${headerH}" fill="#1e1a14"/>
        <text x="10" y="${headerH - 10}" font-family="sans-serif" font-size="14" fill="#00ffff">${escCam}</text>
        <text x="${totalW - 10}" y="${headerH - 10}" font-family="sans-serif" font-size="12" fill="#cccccc" text-anchor="end">${escTs}</text>
      </svg>`
    );

    // --- Info strip ---
    const displayName = face.label || 'Unknown';
    const confStr = `${(face.confidence * 100).toFixed(0)}%`;
    const statusIcon = face.isKnown ? 'KNOWN' : 'UNKNOWN';
    const infoText = `Name: ${displayName}  |  Conf: ${confStr}  |  ${statusIcon}`;
    const escInfo = this.escSvgText(infoText);

    const infoSvg = Buffer.from(
      `<svg width="${totalW}" height="${infoH}">
        <rect width="${totalW}" height="${infoH}" fill="#1e190f"/>
        <text x="10" y="${infoH - 8}" font-family="sans-serif" font-size="12" fill="#dcdcdc">${escInfo}</text>
      </svg>`
    );

    // --- Compose all panels ---
    const headerPng = await sharp(headerSvg).png().toBuffer();
    const infoPng = await sharp(infoSvg).png().toBuffer();

    const composite = await sharp({
      create: {
        width: totalW,
        height: totalH,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        { input: headerPng, top: 0, left: 0 },
        { input: leftWithBbox, top: headerH, left: 0 },
        { input: rightPanel, top: headerH, left: leftW },
        { input: infoPng, top: headerH + leftH, left: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    return composite;
  }

  private escSvgText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Zone Event Processing ---

  private processZoneEvents(
    cameraId: string,
    zoneEvents: ZoneEvent[],
    timestamp: number
  ): void {
    for (const ze of zoneEvents) {
      try {
        const eventId = crypto.randomUUID();
        const eventType = ze.eventType as 'zone_enter' | 'zone_exit' | 'loiter' | 'tripwire_cross';

        // Map zone event type to DB event_type column
        let dbEventType: string;
        let detectionMethod: string;
        if (eventType === 'tripwire_cross') {
          dbEventType = ze.direction === 'IN' ? 'zone_enter' : 'zone_exit';
          detectionMethod = 'tripwire';
        } else {
          dbEventType = eventType;
          detectionMethod = 'zone';
        }

        // Determine direction from zone event
        let direction: 'ENTER' | 'EXIT' | 'INSIDE' | null = null;
        if (ze.direction === 'IN' || eventType === 'zone_enter') {
          direction = 'ENTER';
        } else if (ze.direction === 'OUT' || eventType === 'zone_exit') {
          direction = 'EXIT';
        }

        // Create event record
        const eventData = {
          id: eventId,
          cameraId,
          personId: null,
          personName: `Track #${ze.trackId}`,
          isKnown: false,
          direction,
          detectionMethod: detectionMethod as 'zone' | 'tripwire',
          confidence: 1.0,
          bbox: null,
          snapshotPath: null,
          clipPath: null,
        };

        createEvent(eventData);

        // Update event with zone-specific fields via direct SQL
        try {
          getDb()
            .prepare(
              `UPDATE events SET event_type = ?, zone_id = ?, track_id = ?, behavior_type = ? WHERE id = ?`
            )
            .run(
              dbEventType,
              ze.zoneId,
              ze.trackId,
              eventType === 'loiter' ? 'loiter' : null,
              eventId
            );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[EventProcessor] Failed to update zone fields for event ${eventId}: ${msg}`);
        }

        // Emit to renderer
        const ipcPayload = {
          id: eventId,
          cameraId,
          personId: null,
          personName: `Track #${ze.trackId}`,
          isKnown: false,
          eventType: dbEventType,
          direction,
          detectionMethod,
          confidence: 1.0,
          trackId: ze.trackId,
          zoneId: ze.zoneId,
          zoneName: ze.zoneName,
          zoneType: ze.zoneType,
          behaviorType: eventType === 'loiter' ? 'loiter' : null,
          bbox: null,
          snapshotPath: null,
          clipPath: null,
          telegramSent: false,
          telegramSentAt: null,
          createdAt: new Date().toISOString(),
        };

        emitNewEvent(ipcPayload);

        console.log(
          `[EventProcessor][${cameraId}] Zone event: ${eventId} | ` +
          `${dbEventType} | zone=${ze.zoneName} | track=${ze.trackId}`
        );

        // Trigger Telegram for RESTRICTED zone entries and loitering
        if (
          (ze.zoneType === 'RESTRICTED' && (eventType === 'zone_enter' || eventType === 'tripwire_cross')) ||
          eventType === 'loiter'
        ) {
          this.triggerZoneTelegramAlert(
            eventId, cameraId, ze, direction
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[EventProcessor][${cameraId}] Failed to process zone event: ${message}`);
      }
    }
  }

  private triggerZoneTelegramAlert(
    eventId: string,
    cameraId: string,
    ze: ZoneEvent,
    direction: 'ENTER' | 'EXIT' | 'INSIDE' | null
  ): void {
    if (!telegramService.isConfigured()) return;

    const cameraLabel = this.getCameraLabel(cameraId);
    const alertEvent: TelegramAlertEvent = {
      id: eventId,
      cameraId,
      cameraLabel,
      personId: null,
      personName: ze.eventType === 'loiter'
        ? `⚠️ LOITERING in ${ze.zoneName} (Track #${ze.trackId})`
        : `🚨 ${ze.zoneType} ZONE: ${ze.zoneName} (Track #${ze.trackId})`,
      isKnown: false,
      direction,
      confidence: 1.0,
      snapshotPath: null,
      createdAt: new Date().toISOString(),
    };

    telegramService.sendAlert(alertEvent).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[EventProcessor] Telegram zone alert failed for ${eventId}: ${message}`);
    });
  }

  /**
   * Invalidate cached line configs (call when user saves new config).
   */
  invalidateLineConfig(cameraId: string): void {
    this.lineConfigCache.delete(cameraId);
  }

  /**
   * Clear all tracking state.
   */
  reset(): void {
    this.trackedFaces.clear();
    this.lineConfigCache.clear();
    this.heuristicCache.clear();
    console.log('[EventProcessor] Reset all tracking state.');
  }
}

// Singleton export
export const eventProcessor = new EventProcessor();
