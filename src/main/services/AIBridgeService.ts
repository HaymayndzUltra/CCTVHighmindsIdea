/**
 * AIBridgeService — HTTP client bridging Electron main process to the Python AI sidecar.
 *
 * Responsibilities:
 * - Wrap all HTTP calls to http://localhost:8520
 * - Convert raw frame buffers to base64 JPEG for API transmission
 * - Handle timeouts (5s), retry (1 retry), and sidecar-unavailable fallback
 */

import sharp from 'sharp';
import { getSidecarBaseUrl, getSidecarStatus } from './ProcessManager';

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const CHANNELS = 3; // RGB24

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 1;

interface DetectedFaceResult {
  bbox: number[];
  confidence: number;
  embedding: number[];
}

interface DetectFacesResponse {
  faces: DetectedFaceResult[];
}

interface RecognizeFaceResponse {
  matched: boolean;
  person_id: string | null;
  person_name: string | null;
  confidence: number;
}

interface HealthCheckResponse {
  status: string;
  gpu_available: boolean;
  gpu_name: string;
  model_loaded: boolean;
  model_name: string;
}

interface ConfigUpdateResponse {
  success: boolean;
  active_config: Record<string, unknown>;
}

interface DetectedObjectResult {
  object_class: string;
  bbox: number[];
  confidence: number;
  track_id: number | null;
}

interface DetectObjectsResponse {
  objects: DetectedObjectResult[];
}

interface AutoEnrollResponse {
  success: boolean;
  auto_enrolled_count: number;
}

interface NegativeAddResponse {
  success: boolean;
  id: string;
}

interface NegativeEntry {
  id: string;
  person_id: string;
  created_at: string;
}

interface NegativeListResponse {
  entries: NegativeEntry[];
}

interface ZoneCheckObject {
  object_class: string;
  bbox: number[];
  confidence: number;
  track_id: number | null;
}

interface ZoneCheckZone {
  zone_id: string;
  zone_type: string;
  geometry: string;
}

interface ZoneCheckEvent {
  zone_id: string;
  track_id: number;
  event_type: string;
}

interface ZoneCheckResponse {
  events: ZoneCheckEvent[];
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.ok) {
        return response;
      }

      const errorText = await response.text().catch(() => 'unknown');
      lastError = new Error(
        `HTTP ${response.status}: ${errorText}`
      );

      if (response.status >= 400 && response.status < 500) {
        throw lastError;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (err instanceof Error && err.name === 'AbortError') {
        console.warn(`[AIBridge] Request timeout (attempt ${attempt + 1}/${retries + 1}): ${url}`);
      } else if (attempt < retries) {
        console.warn(`[AIBridge] Retry ${attempt + 1}/${retries}: ${lastError.message}`);
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}

/**
 * Encode a raw frame buffer to base64 JPEG string.
 *
 * Accepts either a raw RGB/BGR buffer or an already-encoded JPEG buffer.
 * For raw RGB24 buffers, uses sharp to convert to JPEG before base64 encoding.
 * The Python sidecar's cv2.imdecode expects encoded image data (JPEG/PNG).
 */
export async function frameBufferToBase64(frameBuffer: Buffer): Promise<string> {
  if (!frameBuffer || frameBuffer.length === 0) {
    throw new Error('Empty frame buffer — cannot encode');
  }

  // Check JPEG magic bytes (FFD8FF)
  const isJpeg =
    frameBuffer[0] === 0xff &&
    frameBuffer[1] === 0xd8 &&
    frameBuffer[2] === 0xff;

  if (isJpeg) {
    return frameBuffer.toString('base64');
  }

  // Raw RGB24 buffer — convert to JPEG via sharp
  const expectedSize = FRAME_WIDTH * FRAME_HEIGHT * CHANNELS;
  const width = frameBuffer.length === expectedSize ? FRAME_WIDTH : Math.round(Math.sqrt(frameBuffer.length / CHANNELS * (16 / 9)));
  const height = frameBuffer.length === expectedSize ? FRAME_HEIGHT : Math.round(width * 9 / 16);

  try {
    const jpegBuffer = await sharp(frameBuffer, {
      raw: { width, height, channels: CHANNELS },
    })
      .jpeg({ quality: 85 })
      .toBuffer();

    return jpegBuffer.toString('base64');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AIBridge] sharp RGB→JPEG conversion failed: ${msg}`);
    throw new Error(`Frame encoding failed: ${msg}`);
  }
}

/**
 * Crop a person bounding box from a frame buffer and return as base64 JPEG.
 * bbox coordinates are absolute pixel values (x1, y1, x2, y2).
 * Falls back to full frame if crop fails.
 */
export async function cropPersonFromFrame(
  frameBuffer: Buffer,
  bbox: { x1: number; y1: number; x2: number; y2: number },
  frameWidth: number = FRAME_WIDTH,
  frameHeight: number = FRAME_HEIGHT
): Promise<string> {
  // Clamp bbox to frame bounds
  const left = Math.max(0, Math.round(bbox.x1));
  const top = Math.max(0, Math.round(bbox.y1));
  const right = Math.min(frameWidth, Math.round(bbox.x2));
  const bottom = Math.min(frameHeight, Math.round(bbox.y2));
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return frameBufferToBase64(frameBuffer);
  }

  try {
    // Check if already JPEG
    const isJpeg =
      frameBuffer[0] === 0xff &&
      frameBuffer[1] === 0xd8 &&
      frameBuffer[2] === 0xff;

    let sharpInstance;
    if (isJpeg) {
      sharpInstance = sharp(frameBuffer);
    } else {
      const expectedSize = frameWidth * frameHeight * CHANNELS;
      const rawWidth = frameBuffer.length === expectedSize ? frameWidth : Math.round(Math.sqrt(frameBuffer.length / CHANNELS * (16 / 9)));
      const rawHeight = frameBuffer.length === expectedSize ? frameHeight : Math.round(rawWidth * 9 / 16);
      sharpInstance = sharp(frameBuffer, {
        raw: { width: rawWidth, height: rawHeight, channels: CHANNELS },
      });
    }

    const croppedBuffer = await sharpInstance
      .extract({ left, top, width, height })
      .jpeg({ quality: 85 })
      .toBuffer();

    return croppedBuffer.toString('base64');
  } catch {
    // Fallback to full frame if crop fails
    return frameBufferToBase64(frameBuffer);
  }
}

function getBaseUrl(): string {
  return getSidecarBaseUrl();
}

function isSidecarAvailable(): boolean {
  const status = getSidecarStatus();
  return status === 'healthy' || status === 'starting';
}

// --- Public API ---

export async function detectFaces(
  cameraId: string,
  frameBuffer: Buffer,
  timestamp?: number
): Promise<DetectFacesResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping detection');
    return { faces: [] };
  }

  const frameBase64 = await frameBufferToBase64(frameBuffer);
  const url = `${getBaseUrl()}/detect`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: cameraId,
        frame_base64: frameBase64,
        timestamp: timestamp ?? Date.now() / 1000,
      }),
    });

    const data = (await response.json()) as DetectFacesResponse;
    return data;
  } catch (err) {
    console.error(`[AIBridge] detectFaces failed for ${cameraId}: ${err}`);
    return { faces: [] };
  }
}

export async function recognizeFace(
  embedding: number[],
  threshold?: number
): Promise<RecognizeFaceResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping recognition');
    return { matched: false, person_id: null, person_name: null, confidence: 0 };
  }

  const url = `${getBaseUrl()}/recognize`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embedding,
        threshold: threshold ?? 0.6,
      }),
    });

    const data = (await response.json()) as RecognizeFaceResponse;
    return data;
  } catch (err) {
    console.error(`[AIBridge] recognizeFace failed: ${err}`);
    return { matched: false, person_id: null, person_name: null, confidence: 0 };
  }
}

export async function checkHealth(): Promise<HealthCheckResponse | null> {
  const url = `${getBaseUrl()}/health`;

  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, 3_000);
    if (response.ok) {
      return (await response.json()) as HealthCheckResponse;
    }
    return null;
  } catch {
    return null;
  }
}

interface EnrollPersonResponse {
  success: boolean;
  embeddings_count: number;
  embeddings: number[][];
  errors: string[];
}

export async function enrollPerson(
  personId: string,
  personName: string,
  imagesBase64: string[]
): Promise<EnrollPersonResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — cannot enroll');
    return { success: false, embeddings_count: 0, embeddings: [], errors: ['AI sidecar unavailable'] };
  }

  const url = `${getBaseUrl()}/enroll`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: personId,
        person_name: personName,
        images_base64: imagesBase64,
      }),
    });

    const data = (await response.json()) as EnrollPersonResponse;
    return data;
  } catch (err) {
    console.error(`[AIBridge] enrollPerson failed for ${personId}: ${err}`);
    return { success: false, embeddings_count: 0, embeddings: [], errors: [String(err)] };
  }
}

export async function detectObjects(
  cameraId: string,
  frameBuffer: Buffer,
  timestamp?: number,
  confidenceThreshold?: number
): Promise<DetectObjectsResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping object detection');
    return { objects: [] };
  }

  const frameBase64 = await frameBufferToBase64(frameBuffer);
  const url = `${getBaseUrl()}/detect_objects`;

  try {
    const body: Record<string, unknown> = {
      camera_id: cameraId,
      frame_base64: frameBase64,
      timestamp: timestamp ?? Date.now() / 1000,
    };
    if (confidenceThreshold != null && !isNaN(confidenceThreshold)) {
      body.confidence_threshold = confidenceThreshold;
    }
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as DetectObjectsResponse;
    return data;
  } catch (err) {
    console.error(`[AIBridge] detectObjects failed for ${cameraId}: ${err}`);
    return { objects: [] };
  }
}

export async function autoEnroll(
  personId: string,
  cropBase64: string,
  qualityScore: number,
  similarity: number
): Promise<AutoEnrollResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping auto-enroll');
    return { success: false, auto_enrolled_count: 0 };
  }

  const url = `${getBaseUrl()}/auto_enroll`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: personId,
        crop_base64: cropBase64,
        quality_score: qualityScore,
        similarity,
      }),
    });

    return (await response.json()) as AutoEnrollResponse;
  } catch (err) {
    console.error(`[AIBridge] autoEnroll failed for person ${personId}: ${err}`);
    return { success: false, auto_enrolled_count: 0 };
  }
}

export async function addNegative(
  personId: string,
  cropBase64: string,
  sourceEventId?: string
): Promise<NegativeAddResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping addNegative');
    return { success: false, id: '' };
  }

  const url = `${getBaseUrl()}/negative/add`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: personId,
        crop_base64: cropBase64,
        source_event_id: sourceEventId ?? null,
      }),
    });

    return (await response.json()) as NegativeAddResponse;
  } catch (err) {
    console.error(`[AIBridge] addNegative failed for person ${personId}: ${err}`);
    return { success: false, id: '' };
  }
}

export async function listNegatives(personId: string): Promise<NegativeListResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping listNegatives');
    return { entries: [] };
  }

  const url = `${getBaseUrl()}/negative/list?person_id=${encodeURIComponent(personId)}`;

  try {
    const response = await fetchWithRetry(url, { method: 'GET' });
    return (await response.json()) as NegativeListResponse;
  } catch (err) {
    console.error(`[AIBridge] listNegatives failed for person ${personId}: ${err}`);
    return { entries: [] };
  }
}

export async function deleteNegative(negativeId: string): Promise<{ success: boolean }> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping deleteNegative');
    return { success: false };
  }

  const url = `${getBaseUrl()}/negative/${encodeURIComponent(negativeId)}`;

  try {
    const response = await fetchWithRetry(url, { method: 'DELETE' });
    return (await response.json()) as { success: boolean };
  } catch (err) {
    console.error(`[AIBridge] deleteNegative failed for id ${negativeId}: ${err}`);
    return { success: false };
  }
}

export async function zoneCheck(
  cameraId: string,
  objects: ZoneCheckObject[],
  zones: ZoneCheckZone[]
): Promise<ZoneCheckResponse> {
  if (!isSidecarAvailable()) {
    return { events: [] };
  }

  if (objects.length === 0 || zones.length === 0) {
    return { events: [] };
  }

  const url = `${getBaseUrl()}/zone_check`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: cameraId,
        objects,
        zones,
      }),
    });

    return (await response.json()) as ZoneCheckResponse;
  } catch (err) {
    console.error(`[AIBridge] zoneCheck failed for ${cameraId}: ${err}`);
    return { events: [] };
  }
}

// --- Re-ID ---

interface ReIDMatchResult {
  global_person_id: string | null;
  person_id: string | null;
  similarity: number;
  matched: boolean;
}

interface ReIDExtractResponse {
  body_embedding: number[];
  match: ReIDMatchResult;
}

export async function extractReID(
  cameraId: string,
  trackId: number,
  cropBase64: string,
  timestamp: number
): Promise<ReIDExtractResponse> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — skipping Re-ID extract');
    return {
      body_embedding: [],
      match: { global_person_id: null, person_id: null, similarity: 0, matched: false },
    };
  }

  const url = `${getBaseUrl()}/reid/extract`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: cameraId,
        track_id: trackId,
        crop_base64: cropBase64,
        timestamp,
      }),
    });

    return (await response.json()) as ReIDExtractResponse;
  } catch (err) {
    console.error(`[AIBridge] extractReID failed for ${cameraId}/track ${trackId}: ${err}`);
    return {
      body_embedding: [],
      match: { global_person_id: null, person_id: null, similarity: 0, matched: false },
    };
  }
}

export async function matchReID(
  cameraId: string,
  trackId: number,
  cropBase64: string,
  timestamp: number
): Promise<ReIDMatchResult> {
  if (!isSidecarAvailable()) {
    return { global_person_id: null, person_id: null, similarity: 0, matched: false };
  }

  const url = `${getBaseUrl()}/reid/match`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: cameraId,
        track_id: trackId,
        crop_base64: cropBase64,
        timestamp,
      }),
    });

    return (await response.json()) as ReIDMatchResult;
  } catch (err) {
    console.error(`[AIBridge] matchReID failed for ${cameraId}/track ${trackId}: ${err}`);
    return { global_person_id: null, person_id: null, similarity: 0, matched: false };
  }
}

// --- Embeddings Sync ---

interface EmbeddingsSyncResponse {
  success: boolean;
  count: number;
}

/**
 * Sync all enrolled face embeddings from the encrypted SQLite store
 * to the Python sidecar's in-memory gallery.
 *
 * Flow: DB (encrypted) → CryptoService.decrypt → POST /embeddings/sync → sidecar memory
 *
 * Must be called:
 *  1. After sidecar becomes healthy on startup
 *  2. After every enrollment / deletion that changes the embedding set
 */
export async function syncEmbeddingsToSidecar(): Promise<number> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — cannot sync embeddings');
    return 0;
  }

  try {
    // Dynamic import to avoid circular dependency at module load time
    const { getAllEmbeddings } = await import('./DatabaseService');
    const allEmbeddings = getAllEmbeddings();

    const payload = {
      embeddings: allEmbeddings.map((e) => ({
        person_id: e.personId,
        person_name: e.personName,
        embedding: e.embedding,
      })),
    };

    const url = `${getBaseUrl()}/embeddings/sync`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as EmbeddingsSyncResponse;
    console.log(`[AIBridge] Synced ${data.count} embeddings to sidecar`);
    return data.count;
  } catch (err) {
    console.error(`[AIBridge] syncEmbeddingsToSidecar failed: ${err}`);
    return 0;
  }
}

export async function updateSidecarConfig(config: {
  gpu_enabled?: boolean;
  model_name?: string;
  det_threshold?: number;
  rec_threshold?: number;
}): Promise<ConfigUpdateResponse | null> {
  if (!isSidecarAvailable()) {
    console.warn('[AIBridge] Sidecar unavailable — cannot update config');
    return null;
  }

  const url = `${getBaseUrl()}/config`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    return (await response.json()) as ConfigUpdateResponse;
  } catch (err) {
    console.error(`[AIBridge] updateSidecarConfig failed: ${err}`);
    return null;
  }
}
