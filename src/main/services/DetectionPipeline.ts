/**
 * DetectionPipeline — Orchestrates the motion → face detection → recognition flow.
 *
 * Responsibilities:
 * - Listen to MotionDetector 'motionDetected' events
 * - Forward motion frames to AIBridgeService for face detection
 * - Run face recognition on detected faces
 * - Emit detection results via IPC to renderer
 * - Forward results to EventProcessor for event creation (Task 7.0 stub)
 * - Manage concurrency across multiple cameras
 */

import { BrowserWindow } from 'electron';
import { motionDetector } from './MotionDetector';
import { detectFaces, detectObjects, recognizeFace, extractReID, frameBufferToBase64, cropPersonFromFrame } from './AIBridgeService';
import { eventProcessor } from './EventProcessor';
import { zoneService } from './ZoneService';
import type { ZoneEvent, TrackedObjectInput } from './ZoneService';
import { topologyService } from './TopologyService';
import { ptzService } from './PTZService';
import { getSetting, createGaitProfile } from './DatabaseService';

// --- Types ---

interface PipelineFaceResult {
  bbox: number[];
  label: string;
  confidence: number;
  isKnown: boolean;
  personId: string | null;
  embedding: number[];
}

interface TrackedObjectResult {
  objectClass: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  trackId: number | null;
  globalPersonId: string | null;
  reidMatched: boolean;
  reidSimilarity: number;
}

interface DetectionResultPayload {
  cameraId: string;
  faces: PipelineFaceResult[];
  trackedObjects: TrackedObjectResult[];
  zoneEvents: ZoneEvent[];
  timestamp: number;
}

// --- Constants ---

// Maximum concurrent detection requests across all cameras
const MAX_CONCURRENT_DETECTIONS = 3;

// Performance logging interval
const PERF_LOG_INTERVAL_MS = 30_000;
const LATENCY_TARGET_MS = 2000;

// Per-camera queue: drop frames if a detection is already in-flight for this camera
const DETECTION_IN_FLIGHT_TIMEOUT_MS = 10_000;

// Telephoto burst capture constants
const BURST_FRAME_COUNT = 5;
const BURST_CAPTURE_WINDOW_MS = 3_000;
const BURST_COOLDOWN_MS = 10_000;

// Gait analysis constants
const GAIT_MIN_FRAMES = 30;
const GAIT_MAX_FRAMES = 45;
const GAIT_COOLDOWN_MS = 30_000; // Don't re-analyze same track within 30s

// --- DetectionPipeline ---

class DetectionPipeline {
  private inFlightCameras: Map<string, number> = new Map(); // cameraId → start timestamp
  private activeDetections = 0;
  private isRunning = false;

  // Diagnostic counters (reset every PERF_LOG_INTERVAL_MS)
  private motionEventCount = 0;
  private droppedConcurrencyCount = 0;
  private droppedInFlightCount = 0;

  // Telephoto burst capture state
  private burstInProgress = false;
  private burstCooldowns: Map<string, number> = new Map(); // cameraId → last burst timestamp
  private burstFrames: Array<{ frameBuffer: Buffer; timestamp: number }> = [];
  private burstListener: ((cameraId: string, frameBuffer: Buffer) => void) | null = null;
  private burstTimer: ReturnType<typeof setTimeout> | null = null;

  // Gait walking sequence buffers: `${cameraId}:${trackId}` → frame buffers
  private gaitBuffers: Map<string, Buffer[]> = new Map();
  private gaitCooldowns: Map<string, number> = new Map(); // `${cameraId}:${trackId}` → last analysis timestamp

  // Performance metrics
  private latencySamples: number[] = [];
  private detectionCounts: Map<string, number> = new Map(); // cameraId → count
  private perfLogTimer: ReturnType<typeof setInterval> | null = null;

  // Cached pipeline config (refreshed every 30s to avoid per-frame SQLite reads)
  private configCache: { yoloConfidence: number | undefined; recognitionThreshold: number | undefined; gaitEnabled: boolean; reidEnabled: boolean; lastRefresh: number } = {
    yoloConfidence: undefined,
    recognitionThreshold: undefined,
    gaitEnabled: false,
    reidEnabled: true,
    lastRefresh: 0,
  };
  private static CONFIG_CACHE_TTL_MS = 30_000;

  private refreshConfigCache(): void {
    const now = Date.now();
    if (now - this.configCache.lastRefresh < DetectionPipeline.CONFIG_CACHE_TTL_MS) return;
    try {
      const yoloStr = getSetting('yolo_confidence');
      this.configCache.yoloConfidence = yoloStr ? parseFloat(yoloStr) : undefined;
    } catch { this.configCache.yoloConfidence = undefined; }
    try {
      const recStr = getSetting('recognition_threshold');
      this.configCache.recognitionThreshold = recStr ? parseFloat(recStr) : undefined;
    } catch { this.configCache.recognitionThreshold = undefined; }
    try {
      this.configCache.gaitEnabled = getSetting('gait_enabled') === 'true';
    } catch { this.configCache.gaitEnabled = false; }
    try {
      this.configCache.reidEnabled = getSetting('reid_enabled') !== 'false';
    } catch { this.configCache.reidEnabled = true; }
    this.configCache.lastRefresh = now;
  }

  /**
   * Start the pipeline: subscribe to MotionDetector events.
   */
  start(): void {
    if (this.isRunning) {
      console.log('[DetectionPipeline] Already running.');
      return;
    }

    this.isRunning = true;
    this.configCache.lastRefresh = 0; // force refresh on start
    this.refreshConfigCache();
    motionDetector.on('motionDetected', this.handleMotionDetected);
    this.startPerfLogging();
    console.log('[DetectionPipeline] Pipeline started.');
  }

  /**
   * Check if the pipeline is currently running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Stop the pipeline: unsubscribe from events.
   */
  stop(): void {
    this.isRunning = false;
    motionDetector.removeListener('motionDetected', this.handleMotionDetected);
    this.inFlightCameras.clear();
    this.activeDetections = 0;
    this.stopPerfLogging();
    console.log('[DetectionPipeline] Pipeline stopped.');
  }

  /**
   * Handle a motion event from MotionDetector.
   * Uses arrow function to preserve `this` context when used as event listener.
   */
  private handleMotionDetected = (cameraId: string, frameBuffer: Buffer): void => {
    // Guard: pipeline must be running
    if (!this.isRunning) {
      return;
    }

    this.motionEventCount++;

    // Guard: global concurrency limit
    if (this.activeDetections >= MAX_CONCURRENT_DETECTIONS) {
      this.droppedConcurrencyCount++;
      return;
    }

    // Guard: per-camera in-flight check (drop frame if detection already running for this camera)
    const inFlightStart = this.inFlightCameras.get(cameraId);
    if (inFlightStart !== undefined) {
      // Check for stuck detections (timeout safety)
      if (Date.now() - inFlightStart < DETECTION_IN_FLIGHT_TIMEOUT_MS) {
        // Not timed out — drop this frame
        this.droppedInFlightCount++;
        return;
      }
      // Timed out — clear and allow new detection
      console.warn(`[DetectionPipeline][${cameraId}] Previous detection timed out, allowing new one.`);
      this.inFlightCameras.delete(cameraId);
      this.activeDetections = Math.max(0, this.activeDetections - 1);
    }

    // Mark in-flight
    this.inFlightCameras.set(cameraId, Date.now());
    this.activeDetections++;

    // Run detection asynchronously
    this.runDetection(cameraId, frameBuffer).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DetectionPipeline][${cameraId}] Detection pipeline error: ${errorMessage}`);
    }).finally(() => {
      this.inFlightCameras.delete(cameraId);
      this.activeDetections = Math.max(0, this.activeDetections - 1);
    });
  };

  /**
   * Run the full detection pipeline: YOLO → ByteTrack → person crops → face detection/recognition.
   */
  private async runDetection(cameraId: string, frameBuffer: Buffer): Promise<void> {
    const pipelineStartMs = Date.now();
    const timestamp = Date.now();

    // Refresh cached config periodically (avoids per-frame SQLite reads)
    this.refreshConfigCache();

    // Step 1: YOLO object detection + ByteTrack via AI sidecar
    const objectResult = await detectObjects(cameraId, frameBuffer, timestamp / 1000, this.configCache.yoloConfidence);
    const rawObjects = objectResult.objects ?? [];

    const trackedObjects: TrackedObjectResult[] = rawObjects.map((obj) => ({
      objectClass: obj.object_class,
      bbox: {
        x1: obj.bbox[0] ?? 0,
        y1: obj.bbox[1] ?? 0,
        x2: obj.bbox[2] ?? 0,
        y2: obj.bbox[3] ?? 0,
      },
      confidence: obj.confidence,
      trackId: obj.track_id,
      globalPersonId: null,
      reidMatched: false,
      reidSimilarity: 0,
    }));

    // Step 2: Re-ID extraction for person tracks (body appearance matching)
    const personObjects = rawObjects.filter((obj) => obj.object_class === 'person');

    if (this.configCache.reidEnabled && personObjects.length > 0) {
      const reidPromises = personObjects
        .filter((obj) => obj.track_id != null)
        .map(async (obj) => {
          try {
            const personBbox = {
              x1: obj.bbox[0] ?? 0,
              y1: obj.bbox[1] ?? 0,
              x2: obj.bbox[2] ?? 0,
              y2: obj.bbox[3] ?? 0,
            };
            const cropBase64 = await cropPersonFromFrame(frameBuffer, personBbox);
            const reidResult = await extractReID(
              cameraId,
              obj.track_id!,
              cropBase64,
              timestamp / 1000
            );

            // Update the tracked object with Re-ID result
            const tracked = trackedObjects.find((t) => t.trackId === obj.track_id);
            if (tracked && reidResult.match) {
              tracked.globalPersonId = reidResult.match.global_person_id;
              tracked.reidMatched = reidResult.match.matched;
              tracked.reidSimilarity = reidResult.match.similarity;
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[DetectionPipeline][${cameraId}] Re-ID failed for track ${obj.track_id}: ${msg}`);
          }
        });

      await Promise.all(reidPromises);
    }

    // Step 2b: Gait buffer accumulation for person tracks
    if (this.configCache.gaitEnabled && personObjects.length > 0) {
      for (const obj of personObjects) {
        if (obj.track_id == null) continue;
        const gaitKey = `${cameraId}:${obj.track_id}`;

        // Check cooldown
        const lastGait = this.gaitCooldowns.get(gaitKey) ?? 0;
        if (timestamp - lastGait < GAIT_COOLDOWN_MS) continue;

        // Accumulate person crop (not full frame) to reduce memory usage
        const buffer = this.gaitBuffers.get(gaitKey) ?? [];
        // Store a compact frame copy — the sidecar handles person crop extraction server-side
        buffer.push(Buffer.from(frameBuffer));
        if (buffer.length > GAIT_MAX_FRAMES) {
          buffer.splice(0, buffer.length - GAIT_MAX_FRAMES);
        }
        this.gaitBuffers.set(gaitKey, buffer);

        // Trigger gait analysis when buffer is full
        if (buffer.length >= GAIT_MIN_FRAMES) {
          this.gaitCooldowns.set(gaitKey, timestamp);
          const framesToSend = buffer.splice(0, GAIT_MIN_FRAMES);
          this.gaitBuffers.set(gaitKey, []);

          // Fire-and-forget gait analysis (non-blocking)
          this.runGaitAnalysis(cameraId, obj.track_id, framesToSend).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[DetectionPipeline][${cameraId}] Gait analysis failed for track ${obj.track_id}: ${msg}`);
          });
        }
      }
    }

    // Step 3: Only run face detection on person-class objects

    let pipelineFaces: PipelineFaceResult[] = [];

    if (personObjects.length > 0) {
      // Use full frame for face detection — sidecar handles crop internally
      const detectionResult = await detectFaces(cameraId, frameBuffer, timestamp / 1000);

      if (detectionResult.faces && detectionResult.faces.length > 0) {
        const recognitionPromises = detectionResult.faces.map(async (face) => {
          try {
            const recognition = await recognizeFace(face.embedding, this.configCache.recognitionThreshold);

            return {
              bbox: face.bbox,
              label: recognition.matched ? (recognition.person_name ?? 'Unknown') : 'Unknown',
              confidence: recognition.matched ? recognition.confidence : face.confidence,
              isKnown: recognition.matched,
              personId: recognition.person_id,
              embedding: face.embedding,
            } as PipelineFaceResult;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[DetectionPipeline][${cameraId}] Recognition failed for face: ${errorMessage}`);

            return {
              bbox: face.bbox,
              label: 'Unknown',
              confidence: face.confidence,
              isKnown: false,
              personId: null,
              embedding: face.embedding,
            } as PipelineFaceResult;
          }
        });

        pipelineFaces = await Promise.all(recognitionPromises);
      }
    }

    // Step 4: Zone detection — check tracked objects against zones
    const zoneInputObjects: TrackedObjectInput[] = trackedObjects
      .filter((obj) => obj.trackId != null)
      .map((obj) => ({
        trackId: obj.trackId!,
        objectClass: obj.objectClass,
        bbox: obj.bbox,
        confidence: obj.confidence,
      }));

    let zoneEvents: ZoneEvent[] = [];
    if (zoneInputObjects.length > 0) {
      try {
        zoneEvents = zoneService.checkZones(cameraId, zoneInputObjects, timestamp);
        const loiterEvents = zoneService.checkLoitering(cameraId, zoneInputObjects, timestamp);
        zoneEvents.push(...loiterEvents);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[DetectionPipeline][${cameraId}] Zone check error: ${msg}`);
      }
    }

    // Step 5: Skip emit if nothing detected at all
    if (trackedObjects.length === 0 && pipelineFaces.length === 0 && zoneEvents.length === 0) {
      return;
    }

    // Step 6: Build detection result payload
    const payload: DetectionResultPayload = {
      cameraId,
      faces: pipelineFaces,
      trackedObjects,
      zoneEvents,
      timestamp,
    };

    // Step 7: Emit to renderer via IPC
    this.emitDetectionResult(payload);

    // Step 8: Record latency metrics
    const latencyMs = Date.now() - pipelineStartMs;
    this.recordLatency(cameraId, latencyMs);

    // Step 9: Forward to EventProcessor (faces + zone events + frame for snapshots)
    this.forwardToEventProcessor(payload, frameBuffer);

    // Step 10: PTZ auto-track position update
    // Feed person bbox centers to PTZService for PID-based auto-tracking
    if (ptzService.isAutoTracking(cameraId)) {
      for (const obj of trackedObjects) {
        if (obj.objectClass === 'person' && obj.trackId != null) {
          const cx = (obj.bbox.x1 + obj.bbox.x2) / 2;
          const cy = (obj.bbox.y1 + obj.bbox.y2) / 2;
          ptzService.updateTrackPosition(cameraId, obj.trackId, { x: cx, y: cy }, 1280, 720);
          break; // Only feed the first matching person track
        }
      }
    }

    // Step 11: Telephoto burst capture trigger
    // When CAM-2A (wide) detects a person, trigger CAM-2B (tele) burst
    if (personObjects.length > 0) {
      this.triggerTeleBurst(cameraId, timestamp);
    }
  }

  /**
   * Send detection results to all renderer windows via IPC.
   * Emits 'ai:detection' for face results and 'ai:objects' for tracked objects.
   */
  private emitDetectionResult(payload: DetectionResultPayload): void {
    const windows = BrowserWindow.getAllWindows();

    // Strip embeddings before sending to renderer (large data, not needed for display)
    const facePayload = {
      cameraId: payload.cameraId,
      faces: payload.faces.map((f) => ({
        bbox: {
          x1: f.bbox[0] ?? 0,
          y1: f.bbox[1] ?? 0,
          x2: f.bbox[2] ?? 0,
          y2: f.bbox[3] ?? 0,
        },
        label: f.label,
        confidence: f.confidence,
        isKnown: f.isKnown,
        personId: f.personId,
      })),
      timestamp: payload.timestamp,
    };

    const objectsPayload = {
      cameraId: payload.cameraId,
      objects: payload.trackedObjects,
      timestamp: payload.timestamp,
    };

    const zonePayload = payload.zoneEvents.length > 0 ? {
      cameraId: payload.cameraId,
      events: payload.zoneEvents,
      timestamp: payload.timestamp,
    } : null;

    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('ai:detection', facePayload);
        if (payload.trackedObjects.length > 0) {
          win.webContents.send('ai:objects', objectsPayload);
        }
        if (zonePayload) {
          win.webContents.send('zone:event', zonePayload);
        }
      }
    }
  }

  // --- Performance Instrumentation ---

  private recordLatency(cameraId: string, latencyMs: number): void {
    this.latencySamples.push(latencyMs);

    // Keep only last 100 samples to avoid unbounded growth
    if (this.latencySamples.length > 100) {
      this.latencySamples.shift();
    }

    // Per-camera detection count
    const count = this.detectionCounts.get(cameraId) ?? 0;
    this.detectionCounts.set(cameraId, count + 1);

    // Warn if latency exceeds target
    if (latencyMs > LATENCY_TARGET_MS) {
      console.warn(
        `[DetectionPipeline][${cameraId}] Latency ${latencyMs}ms exceeds target ${LATENCY_TARGET_MS}ms`
      );
    }
  }

  /**
   * Run gait analysis on accumulated walking frames for a person track.
   * Sends frames to the Python sidecar's /gait/analyze endpoint.
   */
  private async runGaitAnalysis(cameraId: string, trackId: number, frames: Buffer[]): Promise<void> {
    try {
      const framesBase64: string[] = [];
      for (const frame of frames) {
        const b64 = await frameBufferToBase64(frame);
        framesBase64.push(b64);
      }

      const { getSidecarBaseUrl } = await import('./ProcessManager');
      const baseUrl = getSidecarBaseUrl();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(`${baseUrl}/gait/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames_base64: framesBase64,
          camera_id: cameraId,
          track_id: trackId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const result = await response.json() as { gait_embedding: number[]; confidence: number; method: string; person_id?: string };
        if (result.confidence > 0.3 && result.gait_embedding?.length > 0) {
          console.log(
            `[DetectionPipeline][${cameraId}] Gait analysis: track=${trackId} ` +
            `confidence=${result.confidence.toFixed(3)} method=${result.method} ` +
            `frames=${frames.length}`
          );
          // R1-H5: Persist gait embedding to DB if we have a person ID
          if (result.person_id) {
            try {
              createGaitProfile({
                personId: result.person_id,
                gaitEmbedding: result.gait_embedding,
                sourceCameraId: cameraId,
                qualityScore: result.confidence,
              });
            } catch (dbErr) {
              const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
              console.warn(`[DetectionPipeline][${cameraId}] Failed to persist gait profile: ${dbMsg}`);
            }
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[DetectionPipeline][${cameraId}] Gait analysis request failed: ${msg}`);
    }
  }

  purgeStaleGaitBuffers(): void {
    const now = Date.now();
    const STALE_MS = 60_000; // Purge buffers older than 60s
    let purged = 0;
    for (const [key, lastTs] of this.gaitCooldowns.entries()) {
      if (now - lastTs > STALE_MS) {
        this.gaitBuffers.delete(key);
        this.gaitCooldowns.delete(key);
        purged++;
      }
    }
    if (purged > 0) {
      console.log(`[DetectionPipeline] Purged ${purged} stale gait buffers`);
    }
  }

  private startPerfLogging(): void {
    if (this.perfLogTimer) {
      return;
    }

    this.perfLogTimer = setInterval(() => {
      if (this.latencySamples.length === 0 && this.motionEventCount === 0) {
        return;
      }

      if (this.latencySamples.length === 0) {
        // Motion events received but no detections completed — diagnostic info
        console.log(
          `[DetectionPipeline][DIAG] No detections completed | ` +
          `Motion events: ${this.motionEventCount} | Dropped(concurrency): ${this.droppedConcurrencyCount} | Dropped(inflight): ${this.droppedInFlightCount} | ` +
          `Active in-flight: ${this.activeDetections}`
        );
        this.motionEventCount = 0;
        this.droppedConcurrencyCount = 0;
        this.droppedInFlightCount = 0;
        return;
      }

      const avg = Math.round(
        this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
      );
      const max = Math.max(...this.latencySamples);
      const min = Math.min(...this.latencySamples);
      const camerasActive = this.detectionCounts.size;

      const perCamera = Array.from(this.detectionCounts.entries())
        .map(([cam, cnt]) => `${cam}=${cnt}`)
        .join(', ');

      console.log(
        `[DetectionPipeline][PERF] Latency avg=${avg}ms min=${min}ms max=${max}ms | ` +
        `Active cameras: ${camerasActive} | Detections: ${perCamera} | ` +
        `Motion events: ${this.motionEventCount} | Dropped(concurrency): ${this.droppedConcurrencyCount} | Dropped(inflight): ${this.droppedInFlightCount}`
      );

      // Reset counters for next interval
      this.latencySamples = [];
      this.detectionCounts.clear();
      this.motionEventCount = 0;
      this.droppedConcurrencyCount = 0;
      this.droppedInFlightCount = 0;
    }, PERF_LOG_INTERVAL_MS);
  }

  private stopPerfLogging(): void {
    if (this.perfLogTimer) {
      clearInterval(this.perfLogTimer);
      this.perfLogTimer = null;
    }
    this.latencySamples = [];
    this.detectionCounts.clear();
  }

  private forwardToEventProcessor(payload: DetectionResultPayload, frameBuffer?: Buffer): void {
    const eventPayload = frameBuffer ? { ...payload, frameBuffer } : payload;
    eventProcessor.processDetection(eventPayload).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DetectionPipeline][${payload.cameraId}] EventProcessor error: ${errorMessage}`);
    });
  }

  // --- Telephoto Burst Capture ---

  /**
   * Trigger a burst capture on the telephoto camera when the wide-angle camera
   * in the same group detects a person.
   *
   * Requires: burst_capture_enabled setting = 'true'
   * Logic:
   *  - Find the paired telephoto camera in the same camera group
   *  - Collect BURST_FRAME_COUNT frames from the tele camera within BURST_CAPTURE_WINDOW_MS
   *  - Run face detection on each frame
   *  - Select the frame with the highest face confidence score
   *  - Forward the best frame to EventProcessor as a supplemental snapshot
   */
  private triggerTeleBurst(wideCameraId: string, timestamp: number): void {
    // Check if burst capture is enabled
    try {
      const enabled = getSetting('burst_capture_enabled');
      if (enabled !== 'true') return;
    } catch {
      return;
    }

    // Only trigger for cameras that have a group (e.g., GATE_GROUP)
    const groupId = topologyService.getCameraGroupId(wideCameraId);
    if (!groupId) return;

    // Find the telephoto camera in the same group (different from the wide camera)
    const groupMembers = topologyService.getGroupMembers(wideCameraId);
    const teleCameraId = groupMembers.find((id) => id !== wideCameraId);
    if (!teleCameraId) return;

    // Check cooldown
    const lastBurst = this.burstCooldowns.get(teleCameraId) ?? 0;
    if (timestamp - lastBurst < BURST_COOLDOWN_MS) return;

    // Check if burst already in progress
    if (this.burstInProgress) return;

    this.burstInProgress = true;
    this.burstCooldowns.set(teleCameraId, timestamp);
    this.burstFrames = [];

    console.log(
      `[DetectionPipeline] Burst capture triggered: ${wideCameraId} → ${teleCameraId} (${BURST_FRAME_COUNT} frames)`
    );

    // Listen for frames from the telephoto camera
    this.burstListener = (cameraId: string, frameBuffer: Buffer) => {
      if (cameraId !== teleCameraId) return;
      if (this.burstFrames.length >= BURST_FRAME_COUNT) return;

      this.burstFrames.push({ frameBuffer: Buffer.from(frameBuffer), timestamp: Date.now() });

      if (this.burstFrames.length >= BURST_FRAME_COUNT) {
        this.completeBurstCapture(teleCameraId);
      }
    };

    motionDetector.on('motionDetected', this.burstListener);

    // Timeout: if we don't get enough frames, process what we have
    this.burstTimer = setTimeout(() => {
      if (this.burstInProgress) {
        this.completeBurstCapture(teleCameraId);
      }
    }, BURST_CAPTURE_WINDOW_MS);
  }

  /**
   * Complete burst capture: run face detection on collected frames,
   * select the best quality frame, and forward to EventProcessor.
   */
  private async completeBurstCapture(teleCameraId: string): Promise<void> {
    // Cleanup listeners
    if (this.burstListener) {
      motionDetector.removeListener('motionDetected', this.burstListener);
      this.burstListener = null;
    }
    if (this.burstTimer) {
      clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }

    const frames = [...this.burstFrames];
    this.burstFrames = [];
    this.burstInProgress = false;

    if (frames.length === 0) {
      console.log(`[DetectionPipeline] Burst capture: no frames collected from ${teleCameraId}`);
      return;
    }

    console.log(
      `[DetectionPipeline] Burst capture: processing ${frames.length} frames from ${teleCameraId}`
    );

    // Run face detection on each frame, find the one with highest confidence
    let bestFrame: Buffer | null = null;
    let bestConfidence = 0;
    let bestTimestamp = 0;

    for (const frame of frames) {
      try {
        const result = await detectFaces(teleCameraId, frame.frameBuffer, frame.timestamp / 1000);
        if (result.faces && result.faces.length > 0) {
          const maxConf = Math.max(...result.faces.map((f) => f.confidence));
          if (maxConf > bestConfidence) {
            bestConfidence = maxConf;
            bestFrame = frame.frameBuffer;
            bestTimestamp = frame.timestamp;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[DetectionPipeline] Burst frame detection failed: ${msg}`);
      }
    }

    if (bestFrame) {
      console.log(
        `[DetectionPipeline] Burst capture: best frame from ${teleCameraId} ` +
        `(confidence=${bestConfidence.toFixed(3)}, ${frames.length} frames evaluated)`
      );

      // Run full detection pipeline on the best frame
      // This will create events through the normal flow including EventProcessor
      this.runDetection(teleCameraId, bestFrame).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[DetectionPipeline] Burst best-frame detection failed: ${msg}`);
      });
    } else {
      console.log(
        `[DetectionPipeline] Burst capture: no faces found in ${frames.length} frames from ${teleCameraId}`
      );
    }
  }
}

// Singleton export
export const detectionPipeline = new DetectionPipeline();
