// ============================================================
// Shared TypeScript types for IPC payloads
// Used by both Main process and Renderer (via preload)
// ============================================================

// --- Camera ---

export interface CameraConfig {
  id: string;
  label: string;
  ipAddress: string;
  model: string;
  type: string;
  rtspUrl: string;
  rtspMainUrl: string | null;
  rtspSubUrl: string | null;
  hasPtz: boolean;
  ptzType: 'tapo' | 'onvif' | null;
  cameraGroupId: string | null;
  lineCrossingConfig: LineCrossingConfig | null;
  heuristicDirection: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  motionSensitivity: number;
  enabled: boolean;
  floorX: number | null;
  floorY: number | null;
  floorFovDeg: number | null;
  floorRotationDeg: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineCrossingConfig {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  enterDirection: 'enter_from_left' | 'enter_from_right';
}

// --- Person ---

export interface Person {
  id: string;
  name: string;
  label: string | null;
  enabled: boolean;
  telegramNotify: 'immediate' | 'silent_log' | 'daily_summary';
  presenceState: PresenceState;
  presenceUpdatedAt: string | null;
  lastSeenCameraId: string | null;
  lastSeenAt: string | null;
  adaptiveThreshold: number | null;
  autoEnrollEnabled: boolean;
  autoEnrollCount: number;
  embeddingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export type PresenceState = 'HOME' | 'AT_GATE' | 'AWAY' | 'ARRIVING' | 'DEPARTING' | 'UNKNOWN';

export interface EnrollRequest {
  personName: string;
  label?: string;
  imageData: string[];
  source: 'upload' | 'capture' | 'event';
}

// --- Face Detection ---

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedFace {
  bbox: BoundingBox;
  label: string;
  confidence: number;
  isKnown: boolean;
  personId: string | null;
}

export interface DetectionResult {
  cameraId: string;
  faces: DetectedFace[];
  timestamp: number;
}

// --- Events ---

export type EventType =
  | 'detection'
  | 'zone_enter'
  | 'zone_exit'
  | 'loiter'
  | 'journey'
  | 'presence_change'
  | 'behavior'
  | 'sound'
  | 'topology_anomaly'
  | 'liveness_fail';

export type BehaviorType =
  | 'loiter'
  | 'running'
  | 'pacing'
  | 'tailgating'
  | 'tampering'
  | 'crowd'
  | 'wrong_direction'
  | 'time_anomaly';

export type SoundEventType = 'glass_break' | 'gunshot' | 'scream' | 'dog_bark' | 'horn';

export type IdentityMethod = 'face' | 'body_reid' | 'gait' | 'fused' | null;

export interface DetectionEvent {
  id: string;
  cameraId: string;
  personId: string | null;
  personName: string;
  isKnown: boolean;
  eventType: EventType;
  direction: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  detectionMethod: 'line_crossing' | 'heuristic' | 'zone' | 'tripwire' | null;
  confidence: number;
  trackId: number | null;
  globalPersonId: string | null;
  bbox: BoundingBox | null;
  snapshotPath: string | null;
  clipPath: string | null;
  zoneId: string | null;
  journeyId: string | null;
  behaviorType: BehaviorType | null;
  behaviorDetails: string | null;
  soundEventType: SoundEventType | null;
  soundConfidence: number | null;
  livenessScore: number | null;
  isLive: boolean | null;
  identityMethod: IdentityMethod;
  identityFusionScore: number | null;
  telegramSent: boolean;
  telegramSentAt: string | null;
  createdAt: string;
}

export interface EventFilters {
  cameraId?: string;
  personId?: string;
  isKnown?: boolean;
  eventType?: string;
  direction?: 'ENTER' | 'EXIT' | 'INSIDE';
  zoneId?: string;
  journeyId?: string;
  behaviorType?: BehaviorType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// --- Stream ---

export interface StreamFrameData {
  cameraId: string;
  frameBuffer: Buffer;
  timestamp: number;
}

// --- PTZ ---

export type PtzAction = 'move_up' | 'move_down' | 'move_left' | 'move_right' | 'stop' | 'zoom_in' | 'zoom_out' | 'go_to_preset' | 'set_preset';

export interface PtzCommand {
  cameraId: string;
  action: PtzAction;
  params: Record<string, unknown>;
}

export interface PtzPreset {
  id: string;
  cameraId: string;
  presetId: number;
  name: string;
  panPosition: number | null;
  tiltPosition: number | null;
  zoomLevel: number | null;
  dwellSec: number;
  sortOrder: number;
  createdAt: string;
}

export interface PtzPatrolSchedule {
  id: string;
  cameraId: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
  createdAt: string;
}

// --- System Status ---

export interface CameraStatus {
  cameraId: string;
  status: 'connected' | 'reconnecting' | 'offline';
  fps: number;
}

export interface ServiceStatus {
  status: 'starting' | 'healthy' | 'unhealthy' | 'stopped';
  uptime: number;
}

export interface GpuInfo {
  available: boolean;
  name: string;
  vramMb: number;
}

export interface SystemStatus {
  cameras: CameraStatus[];
  aiService: ServiceStatus;
  gpu: GpuInfo;
}

// --- System Status Response (from system:status IPC) ---

export interface SystemStatusResponse {
  aiServiceStatus: 'starting' | 'healthy' | 'unhealthy' | 'stopped';
  gpuEnabled: boolean;
  camerasConnected: number;
  totalEvents: number;
  dbFileSize: number;
}

// --- Settings ---

export interface AppSettings {
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
  retentionDays: number;
  autoPurgeEnabled: boolean;
  defaultLayout: '1x1' | '2x2' | '3x1' | 'custom';
  miniPtzEnabled: boolean;
  recognitionThreshold: number;
  detectionThreshold: number;
  gpuEnabled: boolean;
  motionSensitivityDefault: number;
  [key: string]: string | number | boolean;
}

// --- Telegram ---

export interface TelegramTestRequest {
  token: string;
  chatId: string;
}

// --- Electron API type (matches preload) ---

export interface CameraListItem {
  id: string;
  label: string;
  ipAddress: string;
  model: string;
  type: string;
  rtspUrl: string;
  rtspMainUrl: string | null;
  rtspSubUrl: string | null;
  hasPtz: boolean;
  ptzType: string | null;
  cameraGroupId: string | null;
  heuristicDirection: string | null;
  motionSensitivity: number;
  enabled: boolean;
}

export interface ElectronAPI {
  stream: {
    start: (cameraId: string) => Promise<void>;
    stop: (cameraId: string) => Promise<void>;
    onFrame: (callback: (data: StreamFrameData) => void) => () => void;
  };
  webrtc: {
    start: (cameraId: string) => Promise<{
      success: boolean;
      signalingUrl: string;
      streamName: string;
      subStreamUrl: string | null;
      go2rtcApiBase: string;
    }>;
    signal: (cameraId: string, sdpOffer: string) => Promise<{
      success: boolean;
      sdpAnswer: string;
    }>;
    stop: (cameraId: string) => Promise<{ success: boolean }>;
    state: (cameraId: string) => Promise<{
      state: 'idle' | 'negotiating' | 'connected' | 'failed' | 'stopped';
      useFallback: boolean;
      negotiationAttempts: number;
      lastError: string | null;
    }>;
  };
  recording: {
    start: (cameraId: string, mode?: string) => Promise<{ success: boolean }>;
    stop: (cameraId: string) => Promise<{ success: boolean }>;
    status: (cameraId?: string) => Promise<unknown>;
    segments: (cameraId: string, from: string, to: string) => Promise<{
      segments: Array<{
        id: string;
        camera_id: string;
        file_path: string;
        start_time: string;
        end_time: string;
        duration_sec: number;
        file_size_bytes: number | null;
        format: string;
        recording_mode: string;
      }>;
    }>;
    playback: (segmentId: string) => Promise<{ filePath: string }>;
    diskUsage: () => Promise<{ totalBytes: number; perCamera: Record<string, number> }>;
  };
  sound: {
    onEvent: (callback: (data: {
      cameraId: string;
      events: Array<{ sound_class: string; confidence: number; start_ms: number; end_ms: number }>;
      timestamp: number;
    }) => void) => () => void;
  };
  llm: {
    status: () => Promise<{
      status: 'unknown' | 'running' | 'stopped' | 'error';
      modelLoaded: boolean;
      modelName: string;
      lastError: string | null;
    }>;
    summary: (date: string, generate?: boolean) => Promise<{
      summary: {
        id: string;
        summaryDate: string;
        summaryText: string;
        modelUsed: string | null;
        eventCount: number | null;
        generatedAt: string;
        telegramSent: boolean;
      } | null;
      fromCache: boolean;
    }>;
  };
  analytics: {
    heatmap: (cameraId: string, from: string, to: string) => Promise<{
      cells: Array<{ row: number; col: number; count: number }>;
    }>;
    activity: (from: string, to: string, cameraId?: string) => Promise<{
      data: Array<{
        date: string;
        hour: number;
        cameraId: string | null;
        detectionCount: number;
        personCount: number;
        knownCount: number;
        unknownCount: number;
      }>;
    }>;
    presence: (from: string, to: string, personId?: string) => Promise<{
      segments: Array<{
        personId: string;
        personName: string;
        state: string;
        startTime: string;
        endTime: string | null;
      }>;
    }>;
    zoneTraffic: (from: string, to: string, zoneId?: string) => Promise<{
      data: Array<{
        zoneId: string;
        zoneName: string;
        enterCount: number;
        exitCount: number;
        loiterCount: number;
      }>;
    }>;
  };
  camera: {
    list: () => Promise<CameraListItem[]>;
    update: (cameraId: string, data: Partial<Pick<CameraListItem, 'label' | 'ipAddress' | 'model' | 'rtspUrl' | 'enabled' | 'motionSensitivity'>>) => Promise<{ success: boolean }>;
  };
  ptz: {
    command: (cameraId: string, action: string, params: Record<string, unknown>) => Promise<void>;
    presets: (cameraId: string) => Promise<{ presets: PtzPreset[] }>;
  };
  ai: {
    onDetection: (callback: (data: DetectionResult) => void) => () => void;
    onObjects: (callback: (data: { cameraId: string; objects: unknown[]; timestamp: number }) => void) => () => void;
    pipelineStatus: () => Promise<{ isRunning: boolean }>;
  };
  events: {
    list: (filters: EventFilters) => Promise<DetectionEvent[]>;
    snapshotBase64: (snapshotPath: string) => Promise<string | null>;
    onNew: (callback: (data: DetectionEvent) => void) => () => void;
  };
  person: {
    enroll: (data: EnrollRequest) => Promise<{ success: boolean; embeddingsCount: number; errors: string[] }>;
    list: () => Promise<Person[]>;
    delete: (personId: string) => Promise<{ success: boolean }>;
    toggle: (personId: string, enabled: boolean) => Promise<{ success: boolean }>;
    negativeAdd: (personId: string, cropBase64: string, sourceEventId?: string) => Promise<{ success: boolean; id: string }>;
    negativeList: (personId: string) => Promise<{ entries: Array<{ id: string; person_id: string; created_at: string }> }>;
    negativeDelete: (negativeId: string) => Promise<{ success: boolean }>;
  };
  settings: {
    get: (key: string) => Promise<{ value: string }>;
    set: (key: string, value: string) => Promise<void>;
  };
  telegram: {
    test: (token: string, chatId: string) => Promise<{ success: boolean; message: string }>;
  };
  zone: {
    save: (data: {
      cameraId: string;
      name: string;
      zoneType: string;
      geometry: unknown;
      color?: string;
      alertEnabled?: boolean;
      loiterThresholdSec?: number;
      loiterCooldownSec?: number;
      loiterMovementRadius?: number;
      id?: string;
    }) => Promise<{ success: boolean; id: string }>;
    list: (cameraId: string) => Promise<{ zones: Zone[] }>;
    get: (zoneId: string) => Promise<Zone | null>;
    update: (zoneId: string, data: Record<string, unknown>) => Promise<{ success: boolean }>;
    delete: (zoneId: string) => Promise<{ success: boolean }>;
    onEvent: (callback: (data: { cameraId: string; events: unknown[]; timestamp: number }) => void) => () => void;
  };
  line: {
    save: (cameraId: string, lineCoords: LineCrossingConfig, direction: string) => Promise<void>;
    get: (cameraId: string) => Promise<LineCrossingConfig | null>;
  };
  system: {
    onStatus: (callback: (data: SystemStatus) => void) => () => void;
    getStatus: () => Promise<SystemStatusResponse>;
  };
  privacy: {
    purgeAllFaces: () => Promise<{ success: boolean }>;
    purgeOldEvents: () => Promise<{ deletedCount: number }>;
  };
  journey: {
    list: (personId?: string) => Promise<{ journeys: Journey[] }>;
    active: () => Promise<{
      journeys: Array<{
        id: string;
        personId: string;
        personName: string;
        globalPersonId: string | null;
        status: string;
        steps: JourneyStep[];
        lastCameraId: string;
        summary: string;
        startedAt: string;
        durationSec: number;
      }>;
    }>;
    onUpdate: (callback: (data: {
      journeyId: string;
      personId: string;
      personName: string;
      status: string;
      steps: JourneyStep[];
      totalDurationSec: number | null;
    }) => void) => () => void;
  };
  presence: {
    list: () => Promise<{
      presences: Array<{
        personId: string;
        personName: string;
        state: PresenceState;
        lastCameraId: string | null;
        lastSeenAt: string | null;
        stateChangedAt: string | null;
      }>;
    }>;
    history: (personId: string, limit?: number) => Promise<{ history: PresenceHistoryEntry[] }>;
    onUpdate: (callback: (data: {
      personId: string;
      personName: string;
      state: PresenceState;
      previousState: PresenceState;
      triggerCameraId: string | null;
      triggerReason: string;
      timestamp: number;
    }) => void) => () => void;
  };
  topology: {
    get: () => Promise<{ edges: TopologyEdge[] }>;
    save: (edges: TopologyEdge[]) => Promise<{ success: boolean }>;
    onAnomaly: (callback: (data: {
      type: string;
      globalPersonId: string;
      personId: string | null;
      fromCameraId: string;
      toCameraId: string | null;
      elapsedSec: number;
      expectedMinSec: number | null;
      expectedMaxSec: number | null;
      skippedCameraId: string | null;
      description: string;
      timestamp: number;
    }) => void) => () => void;
  };
  floorplan: {
    get: () => Promise<FloorPlanConfig | null>;
    save: (config: Partial<FloorPlanConfig>) => Promise<{ success: boolean }>;
    positions: () => Promise<{ persons: Array<{ globalPersonId: string; personId: string | null; cameraId: string; timestamp: number }> }>;
  };
}

// --- v2.0 New Domain Types ---

export type ZoneType = 'RESTRICTED' | 'MONITORED' | 'COUNTING' | 'TRIPWIRE';

export interface Zone {
  id: string;
  cameraId: string;
  name: string;
  zoneType: ZoneType;
  geometry: string;
  color: string;
  alertEnabled: boolean;
  loiterThresholdSec: number;
  loiterCooldownSec: number;
  loiterMovementRadius: number;
  enterCount: number;
  exitCount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyStep {
  cameraId: string;
  timestamp: string;
  action: string;
}

export type JourneyStatus = 'active' | 'completed' | 'expired';

export interface Journey {
  id: string;
  personId: string | null;
  personName: string | null;
  globalPersonId: string | null;
  status: JourneyStatus;
  startedAt: string;
  completedAt: string | null;
  totalDurationSec: number | null;
  path: JourneyStep[];
  createdAt: string;
}

export interface PresenceHistoryEntry {
  id: string;
  personId: string;
  state: PresenceState;
  previousState: PresenceState | null;
  triggerCameraId: string | null;
  triggerReason: string | null;
  createdAt: string;
}

export interface TopologyEdge {
  id: string;
  fromCameraId: string;
  toCameraId: string;
  transitMinSec: number;
  transitMaxSec: number;
  direction: 'inbound' | 'outbound' | 'bidirectional' | null;
  enabled: boolean;
  createdAt: string;
}

export interface RecordingSegment {
  id: string;
  cameraId: string;
  filePath: string;
  startTime: string;
  endTime: string;
  durationSec: number;
  fileSizeBytes: number | null;
  format: 'mp4' | 'hls';
  recordingMode: 'continuous' | 'event_triggered';
  createdAt: string;
}

export interface ReIDGalleryEntry {
  id: string;
  cameraId: string;
  trackId: number;
  globalPersonId: string | null;
  personId: string | null;
  clothingDescriptor: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface GaitProfile {
  id: string;
  personId: string;
  sourceCameraId: string | null;
  qualityScore: number | null;
  createdAt: string;
}

export interface DailySummary {
  id: string;
  summaryDate: string;
  summaryText: string;
  modelUsed: string | null;
  eventCount: number | null;
  generatedAt: string;
  telegramSent: boolean;
  createdAt: string;
}

export interface AnalyticsRollup {
  id: string;
  cameraId: string | null;
  zoneId: string | null;
  rollupDate: string;
  rollupHour: number | null;
  detectionCount: number;
  personCount: number;
  knownCount: number;
  unknownCount: number;
  zoneEnterCount: number;
  zoneExitCount: number;
  loiterCount: number;
  behaviorCount: number;
  soundEventCount: number;
  createdAt: string;
}

export interface FloorPlanCameraPosition {
  id: string;
  label: string;
  floorX: number | null;
  floorY: number | null;
  fovDeg: number | null;
  rotationDeg: number | null;
}

export interface FloorPlanConfig {
  id: string;
  imagePath: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  scaleMetersPerPixel: number | null;
  cameras: FloorPlanCameraPosition[];
  createdAt: string;
  updatedAt: string;
}

export interface NegativeGalleryEntry {
  id: string;
  personId: string;
  cropThumbnail: Buffer | null;
  sourceEventId: string | null;
  createdAt: string;
}

export interface TrackedObject {
  trackId: number;
  objectClass: string;
  bbox: BoundingBox;
  confidence: number;
  cameraId: string;
}

export interface TrackTrail {
  trackId: number;
  points: Array<{ x: number; y: number; timestamp: number }>;
}

export interface PersonPosition {
  personId: string | null;
  globalPersonId: string | null;
  cameraId: string;
  bbox: BoundingBox;
  floorX: number | null;
  floorY: number | null;
  timestamp: number;
}

export interface BehaviorAlert {
  trackId: number;
  cameraId: string;
  behaviorType: BehaviorType;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface SoundEvent {
  cameraId: string;
  eventType: SoundEventType;
  confidence: number;
  timestamp: number;
}

export interface FaceEmbedding {
  id: string;
  personId: string;
  sourceType: 'upload' | 'capture' | 'event_clip' | 'auto_enroll';
  sourceReference: string | null;
  qualityScore: number | null;
  isAutoEnrolled: boolean;
  autoEnrollExpiresAt: string | null;
  createdAt: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
