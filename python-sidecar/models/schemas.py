"""Pydantic request/response models for all AI sidecar endpoints.

Based on PRD Section 4.3 — AI Microservice API Contract (v2.0).
"""

from pydantic import BaseModel, Field


# --- Health ---

class HealthResponse(BaseModel):
    status: str
    gpu_available: bool
    gpu_name: str
    vram_total_mb: int = 0
    vram_used_mb: int = 0
    cuda_version: str = ""
    execution_provider: str = "CPUExecutionProvider"
    model_loaded: bool
    model_name: str
    yolo_loaded: bool = False
    reid_loaded: bool = False
    liveness_loaded: bool = False
    sound_loaded: bool = False
    gait_loaded: bool = False


# --- Detection (Face) ---

class DetectRequest(BaseModel):
    camera_id: str
    frame_base64: str
    timestamp: float


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class QualityGateResult(BaseModel):
    yaw: float = 0.0
    pitch: float = 0.0
    blur_score: float = 0.0
    det_score: float = 0.0
    passes_gate: bool = True


class DetectedFace(BaseModel):
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    confidence: float
    embedding: list[float] = Field(..., min_length=512, max_length=512)
    quality: QualityGateResult | None = None


class DetectResponse(BaseModel):
    faces: list[DetectedFace]


# --- Recognition ---

class RecognizeRequest(BaseModel):
    embedding: list[float] = Field(..., min_length=512, max_length=512)
    threshold: float = 0.6
    person_id: str | None = None
    camera_id: str | None = None
    track_id: int | None = None


class RecognizeResponse(BaseModel):
    matched: bool
    person_id: str | None = None
    person_name: str | None = None
    confidence: float
    identity_method: str = "face"


# --- Enrollment ---

class EnrollRequest(BaseModel):
    person_id: str
    person_name: str
    images_base64: list[str]


class EnrollResponse(BaseModel):
    success: bool
    embeddings_count: int
    embeddings: list[list[float]] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# --- Person Management ---

class PersonInfo(BaseModel):
    id: str
    name: str
    embeddings_count: int
    enabled: bool


class PersonsListResponse(BaseModel):
    persons: list[PersonInfo]


class PersonUpdateRequest(BaseModel):
    enabled: bool | None = None
    name: str | None = None


class SuccessResponse(BaseModel):
    success: bool


# --- Config ---

class ConfigUpdateRequest(BaseModel):
    gpu_enabled: bool | None = None
    model_name: str | None = None
    det_threshold: float | None = None
    rec_threshold: float | None = None
    yolo_enabled: bool | None = None
    yolo_confidence: float | None = None
    yolo_classes: str | None = None
    quality_gate_enabled: bool | None = None
    night_enhance_enabled: bool | None = None
    night_luminance_threshold: float | None = None


class ConfigResponse(BaseModel):
    success: bool
    active_config: dict


# =============================================================
# v2.0 — Object Detection (YOLO + ByteTrack)
# =============================================================

class DetectedObject(BaseModel):
    object_class: str
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    confidence: float
    track_id: int | None = None


class DetectObjectsRequest(BaseModel):
    camera_id: str
    frame_base64: str
    timestamp: float


class DetectObjectsResponse(BaseModel):
    objects: list[DetectedObject]


class TrackPoint(BaseModel):
    x: float
    y: float
    timestamp: float


class TrackState(BaseModel):
    track_id: int
    object_class: str
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    trail: list[TrackPoint] = Field(default_factory=list)


class TrackStateResponse(BaseModel):
    camera_id: str
    tracks: list[TrackState]


# =============================================================
# v2.0 — Zone Check
# =============================================================

class ZonePolygon(BaseModel):
    zone_id: str
    zone_type: str
    geometry: str


class ZoneEvent(BaseModel):
    zone_id: str
    track_id: int
    event_type: str


class ZoneCheckRequest(BaseModel):
    camera_id: str
    objects: list[DetectedObject]
    zones: list[ZonePolygon]


class ZoneCheckResponse(BaseModel):
    events: list[ZoneEvent]


# =============================================================
# v2.0 — Auto-Enrollment
# =============================================================

class AutoEnrollRequest(BaseModel):
    person_id: str
    crop_base64: str
    quality_score: float
    similarity: float


class AutoEnrollResponse(BaseModel):
    success: bool
    auto_enrolled_count: int = 0


# =============================================================
# v2.0 — Negative Gallery
# =============================================================

class NegativeAddRequest(BaseModel):
    person_id: str
    crop_base64: str
    source_event_id: str | None = None


class NegativeAddResponse(BaseModel):
    success: bool
    id: str


class NegativeEntry(BaseModel):
    id: str
    person_id: str
    created_at: str


class NegativeListResponse(BaseModel):
    entries: list[NegativeEntry]


# =============================================================
# v2.0 — Re-ID (Body)
# =============================================================

class ReIDRequest(BaseModel):
    camera_id: str
    track_id: int
    crop_base64: str
    timestamp: float


class ReIDMatch(BaseModel):
    global_person_id: str | None = None
    person_id: str | None = None
    similarity: float = 0.0
    matched: bool = False


class ReIDResponse(BaseModel):
    body_embedding: list[float] = Field(default_factory=list)
    match: ReIDMatch


# =============================================================
# v2.0 — Liveness
# =============================================================

class LivenessRequest(BaseModel):
    crop_base64: str


class LivenessResponse(BaseModel):
    is_live: bool
    score: float


# =============================================================
# v2.0 — Sound Event Detection
# =============================================================

class SoundDetectRequest(BaseModel):
    camera_id: str
    audio_base64: str
    sample_rate: int = 16000


class SoundEventResult(BaseModel):
    event_type: str
    confidence: float


class SoundDetectResponse(BaseModel):
    events: list[SoundEventResult]


# =============================================================
# v2.0 — LLM Daily Summary
# =============================================================

class LLMSummaryRequest(BaseModel):
    events_json: str
    date: str


class LLMSummaryResponse(BaseModel):
    summary: str
