# Tapo CCTV Desktop — Comprehensive Feature Showcase

> **Generated from source code analysis** — March 4, 2026
> Based on actual implementation in `python-sidecar/`, `src/main/`, and `src/renderer/`

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **AI Models / Agents** | 12 (6 ONNX/PT models + 6 heuristic fallbacks) |
| **Python Sidecar Services** | 17 service modules |
| **Python API Endpoints** | 18 router modules (~30+ endpoints) |
| **Electron Main Services** | 22 TypeScript service modules |
| **IPC Handler Groups** | 17 handler modules |
| **UI Screens** | 9 navigable screens + 1 fullscreen view |
| **UI Components** | 24 React components |
| **External Integrations** | 4 (Telegram, Ollama, go2rtc, Tapo API) |

**Architecture:** 4-layer Electron desktop app (React renderer → Node.js main process → Python FastAPI sidecar → SQLite + go2rtc)

**Target Hardware:** Ryzen 9 7900 CPU + RTX 4090 GPU (24GB VRAM) + 32GB RAM

**Camera Setup:** 4 logical cameras — CAM-1 (C520WS PTZ), CAM-2A (C246D wide), CAM-2B (C246D telephoto PTZ), CAM-3 (C520WS PTZ)

---

## Part 1: Architecture Overview

### 4-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: React Renderer (Vite + React 19 + TailwindCSS)│
│  - 9 screens, 24 components, WebRTC video display       │
│  - IPC bridge via window.electronAPI (preload)           │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: Electron Main Process (Node.js + TypeScript)   │
│  - 22 services: orchestration, intelligence, integration │
│  - 17 IPC handler groups                                 │
│  - FFmpeg subprocess management (streams + recordings)   │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: Python AI Sidecar (FastAPI on port 8520)       │
│  - GPU-accelerated inference (CUDA via RTX 4090)         │
│  - 6 AI models: InsightFace, YOLOv8s, OSNet-AIN,        │
│    GaitGL, MiniFASNet, YAMNet                            │
│  - Heuristic fallbacks when ONNX models unavailable      │
├─────────────────────────────────────────────────────────┤
│  LAYER 4: Data & Streaming                               │
│  - SQLite (better-sqlite3) — events, persons, embeddings │
│  - go2rtc — RTSP proxy + WebRTC signaling (port 1984)    │
│  - AES-encrypted face embeddings                         │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
Camera RTSP → go2rtc (RTSP proxy) → FFmpeg (720p RGB24 decode)
    ↓                                      ↓
WebRTC (display)              MotionDetector (pixel diff)
                                           ↓
                              DetectionPipeline (orchestrator)
                                    ↓           ↓           ↓
                              YOLO+ByteTrack  Face Det.  Re-ID Extract
                                    ↓           ↓           ↓
                              ZoneService    Recognition  Cross-Cam Match
                                    ↓           ↓           ↓
                              EventProcessor (dedup, snapshot, Telegram)
                                    ↓           ↓           ↓
                              JourneyService  PresenceService  Analytics
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TailwindCSS 4, Lucide icons, Vite 7 |
| **Desktop** | Electron 40, TypeScript 5.9 |
| **AI Runtime** | Python 3, FastAPI, Ultralytics, InsightFace, ONNX Runtime, OpenCV |
| **Database** | SQLite via better-sqlite3 (sync), AES encryption for embeddings |
| **Streaming** | go2rtc (WebRTC + RTSP proxy), FFmpeg (decode + recording) |
| **Imaging** | sharp (Node.js snapshot processing) |
| **Notifications** | node-telegram-bot-api |
| **LLM** | Ollama (local, HTTP API on port 11434) |

---

## Part 2: Python AI Sidecar Features (12 AI Agents)

### Feature 1: Object Detection (YOLOv8s)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/object_detection.py`
- Key functions: `load_yolo_model()`, `detect_objects()`, `get_person_crops()`
- Router: `python-sidecar/routers/object_detection.py` — `POST /detect/objects`

**What it does:**
Real-time detection of persons, vehicles, and animals in camera frames using YOLOv8s with CUDA acceleration.

**How it works:**
Loads `yolov8s.pt` weights (auto-downloads if missing) onto CUDA device. Processes BGR frames at configurable confidence threshold (default 0.4). Filters to 8 COCO classes: person, bicycle, car, motorcycle, bus, truck, cat, dog. Returns bounding boxes, class names, and confidence scores.

**Real-world example:**
Isang tao ang lumalakad sa harap ng bahay — YOLO detects `person` at confidence 0.87 with bounding box `[120, 50, 340, 480]`. A stray dog following behind is detected as `dog` at 0.72.

**Code evidence:**
```python
# python-sidecar/services/object_detection.py:87-154
def detect_objects(frame, confidence_threshold=0.4, allowed_classes=None):
    results = _yolo_model.predict(source=frame, conf=confidence_threshold, ...)
    # Returns: [{object_class: "person", bbox: [x1,y1,x2,y2], confidence: 0.87}]
```

---

### Feature 2: Multi-Object Tracking (ByteTrack)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/tracker.py`
- Key classes: `TrackerService`, `TrackerCamera`, `Track`
- Integrated via: `POST /detect/objects` (tracking happens server-side)

**What it does:**
Maintains persistent track IDs across frames for each camera. Enables continuous tracking of the same person/vehicle even when detection briefly fails.

**How it works:**
ByteTrack-inspired IoU-based tracker with 3-pass matching:
1. High-confidence detections → active tracks (IoU threshold 0.3)
2. Low-confidence detections → remaining active tracks
3. Remaining high-confidence detections → lost tracks (recovery)

Track lifecycle: Tentative → Confirmed (after 3 hits) → Lost (after 30 missed frames). Each track maintains a 60-point motion trail (center coordinates + timestamps).

**Real-world example:**
Person walks across CAM-1 field of view over 15 seconds. Track #47 follows them consistently even when partially occluded by a post for 2 seconds. Trail shows the walking path as a polyline.

**Code evidence:**
```python
# python-sidecar/services/tracker.py:101-155
class Track:
    def update(self, bbox, confidence, timestamp):
        self.hits += 1
        if self.hits >= MIN_HITS:  # 3 hits → confirmed
            self.is_confirmed = True
        self._add_trail_point(bbox, timestamp)
```

---

### Feature 3: Face Detection (InsightFace buffalo_l)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/face_detection.py`
- Key functions: `detect_faces()`, `_apply_clahe()`, `_should_apply_clahe()`
- Router: `python-sidecar/routers/detection.py` — `POST /detect/faces`

**What it does:**
Detects faces in camera frames and extracts 512-dimensional face embeddings for recognition. Automatically enhances low-light/night frames using CLAHE.

**How it works:**
Uses InsightFace `buffalo_l` model (CUDA). For each detected face, returns bounding box, confidence score, and 512-dim normalized embedding vector. Night vision enhancement: checks mean luminance of the frame; if below threshold, applies CLAHE (Contrast Limited Adaptive Histogram Equalization) on the Y-channel of YCrCb color space to improve face detection quality without distorting colors.

**Real-world example:**
At 2AM, IR camera captures a face. Mean luminance = 45 (below threshold). CLAHE enhances contrast → InsightFace detects the face at confidence 0.67 instead of missing it entirely.

**Code evidence:**
```python
# python-sidecar/services/face_detection.py:19-38
def _apply_clahe(frame):
    ycrcb = cv2.cvtColor(frame, cv2.COLOR_BGR2YCrCb)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    ycrcb[:, :, 0] = clahe.apply(ycrcb[:, :, 0])
    return cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)
```

---

### Feature 4: Face Recognition (Cosine Similarity)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/face_recognition.py`
- Key functions: `recognize_face()`, `set_embeddings()`, `reload_embeddings()`
- Router: `python-sidecar/routers/recognition.py` — `POST /recognize`
- Sync: `python-sidecar/routers/embeddings_sync.py` — `POST /embeddings/sync`

**What it does:**
Matches detected face embeddings against an enrolled gallery of known persons using cosine similarity. Gallery is synced from Electron (which decrypts AES-encrypted embeddings from SQLite).

**How it works:**
In-memory gallery of enrolled 512-dim embeddings. For each query embedding, computes cosine similarity against every enrolled embedding. Returns best match if similarity >= threshold (default 0.45). Gallery is injected via `set_embeddings()` using in-place `.clear()/.extend()` to ensure all module references stay valid.

**Real-world example:**
Family member "Maria" has 3 enrolled embeddings from different angles. When her face is detected, cosine similarity = 0.73 against her best embedding → matched as "Maria" with high confidence.

**Code evidence:**
```python
# python-sidecar/services/face_recognition.py:122-178
def recognize_face(embedding, threshold=None):
    for enrolled in _enrolled_embeddings:
        score = _cosine_similarity(query_vec, enrolled["embedding"])
        if score > best_score:
            best_score = score
            best_match = enrolled
    return {"matched": True, "person_id": ..., "confidence": best_score}
```

---

### Feature 5: Face Quality Gate (Multi-Metric Validation)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/quality_gate.py`
- Key functions: `score_face()`, `_estimate_blur()`, `_estimate_pose_from_landmarks()`
- Router: `python-sidecar/routers/detection.py` (integrated in face detection flow)

**What it does:**
Validates detected faces for quality before enrollment or recognition. Rejects faces that would produce noisy embeddings (blurry, extreme angle, too small, low confidence).

**How it works:**
Evaluates 4 quality dimensions:
- **Pose (yaw/pitch):** Estimated from 5-point facial landmarks. Yaw capped at ±0.85 arcsin offset to prevent 90° artifacts from IR cameras.
- **Blur:** Laplacian variance of face crop (min: 15 for CCTV-optimized threshold).
- **Size:** Min 64×64 pixels.
- **Detection confidence:** Min 0.35.

Composite quality score (0-100): 40% pose + 40% blur + 20% detection confidence.

**CCTV-optimized thresholds:** Relaxed from access-control defaults: yaw 60°, pitch 40°, min blur 15, min det score 0.35.

**Code evidence:**
```python
# python-sidecar/services/quality_gate.py:76-78
# Fix: cap nose offset to prevent arcsin(1.0) = 90° artifacts
capped_offset = np.clip(nose_x_offset, -0.85, 0.85)
yaw_deg = float(np.degrees(np.arcsin(capped_offset)))
```

---

### Feature 6: Person Re-Identification (OSNet-AIN)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/reid.py` (463 lines)
- Key functions: `extract_embedding()`, `match_cross_camera()`, `add_to_gallery()`, `extract_clothing_colors()`, `estimate_height()`
- Router: `python-sidecar/routers/reid.py` — `POST /reid/extract`, `POST /reid/match`, `GET /reid/gallery/stats`

**What it does:**
Identifies the same person across different cameras using body appearance, even without face visibility. Extracts 256-dim body embeddings, matches against an in-memory gallery with TTL-based expiry.

**How it works:**
- **ONNX model path:** OSNet-AIN with CUDA → 256-dim L2-normalized embedding from person crop resized to 256×128. ImageNet normalization.
- **Heuristic fallback:** HSV color histogram descriptor (upper/lower body split → 64+32+32 bins × 2 regions = 256 dims).
- **Gallery:** Per-camera thread-safe storage with global person ID assignment. Cross-camera matching excludes source camera. 5-minute TTL with automatic cleanup.
- **Extras:** Clothing color extraction via k-means on HSV, relative height estimation from bbox aspect ratio.

**Real-world example:**
Person enters through CAM-1 gate, face detected and recognized as "Juan". They walk to the backyard (CAM-3) wearing a red shirt. Re-ID matches their body appearance from CAM-1 gallery → confirmed same person, no face needed.

**Code evidence:**
```python
# python-sidecar/services/reid.py:292-346
def match_cross_camera(source_camera_id, embedding, ...):
    for cam_id, entries in _gallery.items():
        if cam_id == source_camera_id:  # Skip same camera
            continue
        sim = _cosine_similarity(embedding, entry["embedding"])
        if sim >= threshold:
            best_match = {"matched": True, "global_person_id": ...}
```

---

### Feature 7: Gait Recognition (GaitGL)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/gait_recognition.py`
- Key functions: `analyze_gait()`, `_preprocess_silhouettes()`, `_heuristic_analyze()`
- Router: `python-sidecar/routers/gait.py` — `POST /gait/analyze`

**What it does:**
Identifies people by their walking pattern from 30-frame sequences (~2s at 15fps). Works even when face and body appearance are obscured (coat, mask, backpack).

**How it works:**
- **ONNX model path:** GaitGL model processes binary silhouette sequences (64×44 per frame). Extracts 128-dim gait embedding.
- **Heuristic fallback:** FFT-based stride frequency analysis + aspect ratio dynamics + height statistics → 128-dim feature vector.
- **Silhouette extraction:** Adaptive Otsu thresholding on grayscale person crops.

**Real-world example:**
A person approaches wearing a full hoodie and mask at night. Face and Re-ID fail. But their walking pattern (stride length, pace, gait cycle) matches enrolled gait profile at 0.62 similarity → identified.

**Code evidence:**
```python
# python-sidecar/services/gait_recognition.py:179-218
# Heuristic: FFT on vertical center oscillation for stride frequency
fft_magnitudes = np.abs(np.fft.rfft(centers_detrended))
# Aspect ratio dynamics during walk cycle
ar_mean, ar_std, ar_range = float(np.mean(aspect_ratios)), ...
```

---

### Feature 8: 4-Layer Identity Fusion
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/identity_fusion.py`
- Key functions: `fuse_identity()`, `_classify_confidence()`, `configure()`
- Dataclasses: `FusionInput`, `FusionResult`

**What it does:**
Combines face, body Re-ID, gait, and soft biometric scores into a single fused identity confidence. Degrades gracefully when individual layers are unavailable.

**How it works:**
Default weights: **face=50%, body=25%, gait=15%, soft biometrics=10%**. When layers are missing, weights are auto-normalized across available layers. Confidence classification:
- **High:** 3+ layers @ ≥0.5 OR 2+ layers @ ≥0.55 OR single layer @ ≥0.65
- **Medium:** Score ≥0.45
- **Low:** Score <0.45

Person ID resolution priority: face > gait > body.

**Code evidence:**
```python
# python-sidecar/services/identity_fusion.py:122-147
fused = sum(score * (weight / total_weight) for _, score, weight in layers)
confidence_level = _classify_confidence(fused, len(layers))
# Returns: FusionResult(fused_score=0.72, layers_used=["face","body"], ...)
```

---

### Feature 9: Liveness Detection (MiniFASNet)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/liveness.py`
- Key functions: `check_liveness()`, `_onnx_liveness()`, `_heuristic_liveness()`
- Router: `python-sidecar/routers/liveness.py` — `POST /liveness/check`

**What it does:**
Anti-spoofing detection to identify presentation attacks (photos, screens, masks). Returns binary live/spoof classification with confidence score.

**How it works:**
- **ONNX path:** MiniFASNet model processes 80×80 face crop. Binary classification (live probability).
- **Heuristic fallback:** 60% texture variance (Laplacian) + 40% color histogram spread. Real faces have high texture variance and wide color distribution. Threshold: 0.35.

**Real-world example:**
Someone holds up a phone showing a person's photo to the camera. Liveness detection scores texture_variance=42 (low, flat image) and color_spread=0.31 (limited) → score=0.28 → `is_live: false` → spoof rejected.

---

### Feature 10: Sound Event Detection (YAMNet)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/sound_detection.py`
- Key functions: `classify_audio()`, `_run_inference()`, `load_sound_model()`
- Router: `python-sidecar/routers/sound.py` — `POST /sound/classify`

**What it does:**
Classifies security-relevant audio events from camera microphone feeds: glass breaking, gunshots, screams, dog barking, vehicle horns.

**How it works:**
YAMNet model (521-class AudioSet classifier) processes 16kHz mono audio in 0.96s frames with 0.48s hop. Supports ONNX and TFLite model formats. Maps 521 YAMNet classes to 5 security event categories using pre-computed index sets for fast lookup. Audio is resampled and normalized before inference.

**Security Sound Classes:**
- `glass_break` → Breaking, Shatter, Glass
- `gunshot` → Gunshot/gunfire, Machine gun, Firecracker
- `scream` → Screaming, Shout, Yell
- `dog_bark` → Bark, Dog, Growling
- `horn` → Vehicle horn, Air horn

**Code evidence:**
```python
# python-sidecar/services/sound_detection.py:166-199
for start_sample in range(0, len(audio_data) - frame_length + 1, hop_length):
    scores = _run_inference(frame)
    for event_type in target_classes:
        target_indices = SECURITY_CLASS_INDICES[event_type]
        max_score = max(float(scores[idx]) for idx in target_indices if idx < len(scores))
```

---

### Feature 11: Auto-Enrollment
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/auto_enrollment.py`
- Key functions: `try_auto_enroll()`, `purge_expired_auto_enrollments()`
- Router: `python-sidecar/routers/auto_enrollment.py`

**What it does:**
Automatically stores new face embeddings from high-quality detections of recognized persons, improving recognition accuracy over time without manual intervention.

**How it works:**
Criteria: recognition similarity ≥ 0.55, quality score ≥ 80.0, max 5 auto-enrolled embeddings per person. Auto-enrolled embeddings expire after 30 days (automatic purge). Per-person `auto_enroll_enabled` flag controls opt-in.

**Code evidence:**
```python
# python-sidecar/services/auto_enrollment.py:121-207
def try_auto_enroll(person_id, person_name, crop_base64, quality_score, similarity):
    if similarity < cfg.auto_enroll_min_similarity: return {"success": False, ...}
    if quality_score < cfg.auto_enroll_min_quality: return {"success": False, ...}
    # Extract embedding from crop, store with 30-day expiry
```

---

### Feature 12: Negative Gallery (False Positive Suppression)
**Category:** AI
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `python-sidecar/services/negative_gallery.py`
- Key functions: `add_negative()`, `is_in_negative_gallery()`, `list_negatives()`, `delete_negative()`
- Router: `python-sidecar/routers/negative_gallery.py`

**What it does:**
Suppresses recurring false positives (strangers, reflections, posters) by storing their embeddings and checking before recognition.

**How it works:**
Maintains per-person in-memory cache of negative embeddings loaded from SQLite. Before accepting a recognition match, checks cosine similarity against negative gallery (threshold: 0.65). If match found → reject the recognition. Cache is invalidated on writes.

---

## Part 3: Electron Main Process Services (22 Services)

### Feature 13: Detection Pipeline Orchestrator
**Category:** Service (Orchestration)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/DetectionPipeline.ts` (762 lines)
- Key class: `DetectionPipeline`
- Key methods: `start()`, `stop()`, `handleMotionDetected()`, `runDetection()`

**What it does:**
Orchestrates the entire detection flow: motion event → YOLO + ByteTrack → person crops → face detection → recognition → Re-ID → gait → zone detection → event creation.

**How it works:**
- **Concurrency:** Max 3 simultaneous detections across all cameras.
- **Per-camera guard:** Drop frames if detection already in-flight (10s timeout safety).
- **Diagnostic counters:** motionEventCount, droppedConcurrency, droppedInFlight (logged every 30s).
- **Telephoto burst capture:** Wide camera triggers telephoto PTZ → captures 5 frames → selects best-quality frame by face confidence.
- **Gait buffer accumulation:** Collects 30-45 person crop frames per track, triggers gait analysis when buffer full (30s cooldown per track).
- **Performance target:** <2000ms per frame latency.

**Pipeline flow:**
```
Motion Event → YOLO+ByteTrack → Person Crops → Face Detection
    → Face Recognition → Re-ID Extraction → Cross-Camera Match
    → Gait Buffer → Zone Detection → EventProcessor
```

---

### Feature 14: Event Processor
**Category:** Service (Orchestration)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/EventProcessor.ts` (987 lines)
- Key class: `EventProcessor`
- Key methods: `processDetection()`, `checkLineCrossing()`, `captureSnapshot()`

**What it does:**
Transforms raw detections into meaningful events with direction detection (ENTER/EXIT), snapshot capture, deduplication, and downstream dispatch to Telegram/Journey/Presence services.

**How it works:**
- **Centroid tracking:** Per-camera tracked face centroids (5-point history, 5s expiry).
- **Line-crossing detection:** Vector cross-product algorithm determines if trajectory crosses a configured line, and from which side (ENTER/EXIT).
- **Heuristic fallback:** Frame-edge detection when no line is configured.
- **Camera group dedup:** Same person + same camera group within 5s → keep best-confidence snapshot only.
- **Snapshot generation:** 720p JPEG with padding around face crop via sharp.
- **Downstream dispatch:** Telegram alerts, Journey tracking, Presence FSM updates.

**Event types:** `detection`, `zone_enter`, `zone_exit`, `loiter`, `journey`, `presence_change`, `behavior`, `sound`

---

### Feature 15: Journey Tracking Service
**Category:** Service (Intelligence)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/JourneyService.ts` (423 lines)
- Key class: `JourneyService` (extends EventEmitter)
- Key methods: `processDetection()`, `startJourney()`, `addJourneyStep()`, `completeJourney()`, `expireStaleJourneys()`

**What it does:**
Tracks a person's path across multiple cameras as a "journey". Validates camera transitions against topology. Detects anomalies (unexpected routes, too-fast/too-slow transit).

**How it works:**
1. Known person detected at any camera → start new journey
2. Same person at different camera + valid topology transit → add step
3. Person reaches interior camera → complete journey
4. No detection within blind_spot_max_sec → expire journey

Dedup: Same person + same camera within 3s → skip. Topology validation: checks `isTransitTimeValid()` and `hasDirectEdge()`.

**Real-world example:**
"Maria" detected at CAM-1 (gate) → 8 seconds later at CAM-2A (walkway) → 12 seconds later at CAM-3 (backyard). Journey completed with 3 steps. Telegram alert: "Maria arrived: Gate → Walkway → Backyard (20s total)".

---

### Feature 16: Presence Service (5-State FSM)
**Category:** Service (Intelligence)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/PresenceService.ts` (465 lines)
- Key class: `PresenceService` (extends EventEmitter)
- Key methods: `processDetection()`, `checkTimeouts()`, `getCameraRole()`

**What it does:**
Tracks per-person HOME/AWAY presence state using a 5-state finite state machine driven by camera detections and topology.

**State machine:**
```
UNKNOWN → AT_GATE → ARRIVING → HOME
                                 ↓
              AWAY ← DEPARTING ←─┘
```

**Transitions:**
- Gate camera detection → AT_GATE
- Interior camera detection → HOME
- 30-minute timeout (configurable) → AWAY
- Camera role determined by topology: cameras with no inbound edges = gate; with inbound edges = interior

**Real-world example:**
"Juan" has been away for hours (`AWAY`). At 5:30 PM, detected at gate camera → `AT_GATE`. 5 seconds later, detected at interior camera → `ARRIVING` → `HOME`. Telegram: "Juan is HOME".

---

### Feature 17: Topology Service (Spatial Intelligence)
**Category:** Service (Intelligence)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/TopologyService.ts` (565 lines)
- Key class: `TopologyService` (extends EventEmitter)
- Key methods: `getExpectedNextCameras()`, `isTransitTimeValid()`, `areInSameGroup()`, `recordDetection()`, `estimateFloorPosition()`

**What it does:**
Models camera spatial relationships as a directed graph. Enables transit time validation, next-camera prediction, anomaly detection, and floor plan position estimation.

**Capabilities:**
- **Edge cache:** 30s TTL, loaded from `topology_edges` DB table
- **Transit validation:** Checks if elapsed time between cameras falls within [min, max] bounds
- **Camera groups:** Identifies which cameras share the same physical location (e.g., CAM-2A/2B)
- **Anomaly detection:** `skip_detected` (skipped expected camera), `transit_violation` (too fast/slow), `disappearance` (not seen within blind spot window)
- **Floor plan:** Position interpolation from camera coordinates

---

### Feature 18: Zone Detection & Loitering
**Category:** Service (Behavioral)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/ZoneService.ts` (640 lines)
- Key class: `ZoneService` (extends EventEmitter)
- Key methods: `checkTrackedObjects()`, `isPointInPolygon()`, `checkTripwireCrossing()`

**What it does:**
Detects when tracked objects enter/exit polygon zones, cross tripwire lines, or loiter (dwell too long in restricted areas).

**Zone types:**
- **RESTRICTED** — Alert on any entry
- **MONITORED** — Track enter/exit events
- **COUNTING** — Count directional flow
- **TRIPWIRE** — Directional line crossing detection

**How it works:**
- **Point-in-polygon:** Ray-casting algorithm using foot-point (bottom-center of bbox, more accurate than centroid for person detection).
- **Tripwire crossing:** Cross-product line intersection test with directional classification (IN/OUT).
- **Loitering:** Per-track timer starts on zone entry. If track remains within `loiterMovementRadius` for longer than `loiterThresholdSec` → loiter alert. Configurable cooldown prevents alert spam.

---

### Feature 19: PTZ Control System
**Category:** Service (Hardware)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/PTZService.ts` (520 lines)
- File: `src/main/services/TapoAPIService.ts` (487 lines)
- Key class: `PTZService` (extends EventEmitter)
- Key methods: `move()`, `stop()`, `gotoPreset()`, `zoomToTarget()`, `startAutoTrack()`, `startPatrol()`

**What it does:**
Intelligent PTZ (Pan-Tilt-Zoom) control with auto-tracking, preset patrol, zoom-on-demand, and coordinated multi-camera handoff.

**Capabilities:**
- **Basic PTZ:** Directional movement, stop, preset goto/save
- **Zoom-on-demand:** Zooms camera to center on a target bounding box
- **PID auto-tracking:** Smooth following of a tracked person using PID controller (Kp=0.4, Ki=0.02, Kd=0.15) with 10% dead zone
- **Preset patrol:** Cycle through presets with configurable dwell time. Auto-interrupt on detection, resume after tracking ends.
- **Multi-camera handoff:** Uses topology predictions to pre-position next camera

**TapoAPIService:** Reverse-engineered HTTP API client for TP-Link Tapo cameras. Handles MD5-hashed authentication, session management (10-min TTL), self-signed certificate bypass.

---

### Feature 20: Recording Service
**Category:** Service (Infrastructure)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/RecordingService.ts` (518 lines)
- Key functions: `startRecording()`, `stopRecording()`, `finalizeSegment()`, `cleanupOldRecordings()`

**What it does:**
Manages continuous or event-triggered MP4 recording per camera using FFmpeg.

**How it works:**
- **Recording modes:** `continuous`, `event_triggered`, `off`
- **Segmentation:** Configurable segment duration (default 15 min)
- **Storage:** Per-camera directories with timestamped MP4 files
- **Retention:** Automatic cleanup of segments older than configurable retention period (default 30 days)
- **DB tracking:** Each segment tracked in `recording_segments` table (file path, duration, size)

---

### Feature 21: Sound Service (Audio Intelligence)
**Category:** Service (Intelligence)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/SoundService.ts` (281 lines)
- Key functions: `startAudioCapture()`, `stopAudioCapture()`, `classifyBufferedAudio()`

**What it does:**
Extracts audio from camera RTSP streams via FFmpeg, buffers 2-second segments, and sends to the Python sidecar for sound event classification.

**How it works:**
FFmpeg extracts audio as raw PCM float32 at 16kHz mono from RTSP stream → buffers in memory → every 2 seconds sends to `POST /sound/classify` → creates events for detected security sounds. Configurable target classes and confidence threshold.

---

### Feature 22: Telegram Alerts
**Category:** Service (Integration)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/TelegramService.ts` (561 lines)
- Key class: `TelegramService`
- Key methods: `sendAlert()`, `sendPresenceAlert()`, `sendJourneyAlert()`, `sendTestMessage()`

**What it does:**
Sends structured notifications via Telegram bot with snapshot images, throttling, and bundling.

**Throttling rules:**
- Per-camera cooldown: 30 seconds
- Per-person cooldown: 60 seconds
- Bundle window: multiple detections on same camera within 5s → single alert

**Alert types:**
- Detection alerts (unknown person = ALERT, known = INFO/silent unless journey/presence context)
- Presence alerts (HOME/AWAY/AT_GATE state changes)
- Journey alerts (multi-step path completed)

---

### Feature 23: Ollama LLM Integration (Daily Summaries)
**Category:** Service (Integration)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/OllamaService.ts` (384 lines)
- Key functions: `generate()`, `buildDailySummaryPrompt()`, `generateDailySummary()`, `startScheduler()`

**What it does:**
Generates AI-powered daily security summaries using locally-running Ollama LLM (default: llama3.2). Scheduled at configurable time (default 23:00). Optionally delivered via Telegram.

**How it works:**
Builds a structured prompt from DB-queried event data (event counts by type, person activity, unknown detections, zone traffic, presence history). Sends to `POST http://localhost:11434/api/generate` with temperature 0.3. Stores summary in `daily_summaries` table.

**Code evidence:**
```typescript
// src/main/services/OllamaService.ts:154-200
function buildDailySummaryPrompt(date: string): string {
    // Queries: event_type counts, person activity, unknown count, zone activity
    // Builds: structured security report prompt
}
```

---

### Feature 24: Analytics Service
**Category:** Service (Intelligence)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/AnalyticsService.ts` (349 lines)
- Key functions: `runHourlyRollup()`, `getActivityData()`, `getHeatmapData()`, `getPresenceTimeline()`, `getZoneTrafficData()`

**What it does:**
Periodic aggregation of detection data into analytics rollups for dashboard visualization.

**Capabilities:**
- **Hourly rollup:** Aggregates detection counts, person counts, known/unknown split, zone enter/exit, loiter, behavior, sound events per camera per hour
- **Heatmap data:** Bins detection bbox centers into 20×20 grid cells per camera
- **Presence timeline:** Per-person home/away segments from presence_history table
- **Zone traffic:** Per-zone enter/exit/loiter counts for date range

---

### Feature 25: Stream Management
**Category:** Service (Infrastructure)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/StreamManager.ts` (367 lines) — AI pipeline stream
- File: `src/main/services/WebRTCService.ts` (270 lines) — Display stream
- File: `src/main/services/Go2RtcService.ts` (412 lines) — RTSP proxy

**Dual-stream architecture:**
- **Display:** WebRTC via go2rtc (low latency, browser-native `<video>` element)
- **AI pipeline:** FFmpeg decoding at 720p/12fps into raw RGB24 buffers → MotionDetector → DetectionPipeline

**go2rtc:** Managed child process with health check polling, auto-restart with backoff (3 attempts), graceful shutdown. Provides RTSP proxy (port 8554) and WebRTC signaling (port 1984).

**WebRTCService:** SDP signaling proxy to go2rtc, connection state tracking, automatic re-negotiation on failure, fallback to raw frame IPC.

---

### Feature 26: Motion Detection
**Category:** Service (Infrastructure)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/MotionDetector.ts` (235 lines)
- Key class: `MotionDetector` (extends EventEmitter)
- Key method: `processFrame()`

**What it does:**
Triggers the AI detection pipeline only when motion is detected, saving GPU resources during quiet periods.

**How it works:**
Per-pixel intensity difference between consecutive frames (sampled every 4th pixel for performance). Sensitivity 0-100 maps to a pixel-change percentage threshold (50 → 5% pixels must change). 500ms cooldown between triggers. Emits `motionDetected` event with (cameraId, frameBuffer).

---

### Feature 27: Database & Encryption
**Category:** Service (Infrastructure)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/DatabaseService.ts` (51,905 bytes — largest file)
- File: `src/main/services/CryptoService.ts` (4,706 bytes)

**DatabaseService capabilities:**
- SQLite via better-sqlite3 (synchronous, single-file)
- Schema migrations (v1.0 → v2.0)
- 20+ tables: cameras, persons, face_embeddings, events, zones, topology_edges, journeys, presence_history, recording_segments, analytics_rollup, daily_summaries, settings, negative_gallery, gait_profiles, etc.
- Seed default cameras, settings, and topology on first run

**CryptoService:**
- AES-256-GCM encryption for face embeddings at rest
- Encryption key derived from machine-specific identifier
- Transparent encrypt/decrypt for embedding storage and retrieval

---

### Feature 28: Process Manager
**Category:** Service (Infrastructure)
**Status:** ✅ Fully Implemented

**Implementation:**
- File: `src/main/services/ProcessManager.ts` (12,658 bytes)

**What it does:**
Manages the Python AI sidecar lifecycle: startup, health monitoring, embedding sync verification, auto-restart, and graceful shutdown.

**Capabilities:**
- Start Python sidecar as child process
- Health check polling (periodic HTTP GET to `/health`)
- Embedding sync verification (30s cooldown): detects sidecar restart (0 embeddings) and re-syncs
- Re-ID gallery cleanup (1-min interval)
- Status reporting to renderer

---

## Part 4: React UI (9 Screens + 24 Components)

### Screen 1: Dashboard
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/Dashboard/Dashboard.tsx`
- Components: `CameraGrid`, `LayoutSelector`, `StatusBar`, `PresencePanel`
- Features: Multi-camera grid (1×1, 2×2, 3×1, custom), live WebRTC feeds, system status bar, presence strip

### Screen 2: Camera Fullscreen View
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/CameraFullscreenView/CameraFullscreenView.tsx` (596 lines)
- Components: `PTZControls`, `DetectionOverlay`, `OverlayContextMenu`, `RecordingIndicator`, `TimelineScrubber`
- Features: Full-screen camera with WebRTC + canvas fallback, live detection overlay (color-coded boxes + trails), PTZ controls for PTZ cameras, recording playback with timeline scrubber, zone overlay toggle, context menu (enroll, mark false positive, track)

### Screen 3: Event Log
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/EventLog/EventLog.tsx`
- Components: `FilterBar`, `EventTable`, `EventDetail`
- Features: Paginated event list, multi-filter (camera, person, event type, date range, known/unknown), event detail panel with snapshot, type-colored badges

### Screen 4: Person Directory
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/PersonDirectory/PersonDirectory.tsx`
- Components: `PersonList`, `PersonDetail`, `EnrollmentModal`, `ConfirmDeleteModal`
- Features: List all enrolled persons, person detail (embeddings, events, settings), enrollment from upload/capture/event, toggle enable/disable, delete with confirmation

### Screen 5: Zone Editor
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/ZoneEditor/ZoneEditor.tsx` (554 lines)
- Components: `PolygonDrawTool`, `TripwireDrawTool`
- Features: Visual zone drawing on live camera feed (WebRTC), 4 zone types (Restricted/Monitored/Counting/Tripwire), configurable loitering thresholds, color customization, alert enable/disable

### Screen 6: Analytics
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/Analytics/Analytics.tsx`
- Components: `HeatmapPanel`, `ActivityGraph`, `PresenceTimeline`, `ZoneTrafficPanel`
- Features: 4-panel analytics dashboard with date picker, per-camera detection heatmap (20×20 grid), hourly activity stacked bars, per-person presence timeline, zone traffic counts

### Screen 7: Floor Plan
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/FloorPlan/FloorPlan.tsx` (324 lines)
- Features: Upload floor plan image, place cameras on floor plan, live person dots (color-coded: green=known, red=unknown, blue=body-only), SVG motion trails (30-point history), camera icons with tooltips, 2-second position polling

### Screen 8: Situation Room
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/SituationRoom/SituationRoom.tsx` (396 lines)
- Features: 4-panel command center — Alert Feed (severity-coded: CRIT/HIGH/MED/LOW with pulse animation), Floor Map integration, Active Camera Feed, Person Status panel (presence badges). Real-time IPC subscriptions: zone events, topology anomalies, presence updates.

### Screen 9: Settings
**Status:** ✅ Fully Implemented
- File: `src/renderer/screens/Settings/Settings.tsx`
- Sub-screens: `TopologyEditor.tsx`, `FloorPlanEditor.tsx`, `PTZConfig.tsx`
- Tabs: Telegram, Retention, Cameras, PTZ, Topology, Floor Plan, Layout, System

---

### Key UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `CameraGrid` | `CameraGrid.tsx` | Multi-camera layout grid |
| `CameraTile` | `CameraTile.tsx` | Individual camera feed tile |
| `DetectionOverlay` | `DetectionOverlay.tsx` (374 lines) | SVG bounding boxes, labels, trails over video |
| `OverlayContextMenu` | `OverlayContextMenu.tsx` | Right-click menu on detections |
| `FaceDetectionOverlay` | `FaceDetectionOverlay.tsx` | Face-specific overlay |
| `LineCrossingOverlay` | `LineCrossingOverlay.tsx` | Entry/exit line visualization |
| `PolygonDrawTool` | `PolygonDrawTool.tsx` | Interactive polygon zone drawing |
| `TripwireDrawTool` | `TripwireDrawTool.tsx` | Interactive tripwire line drawing |
| `PTZControls` | `PTZControls.tsx` | Directional pad + presets for PTZ cameras |
| `MiniPTZ` | `MiniPTZ.tsx` | Compact PTZ control in camera tile |
| `PresencePanel` | `PresencePanel.tsx` | Per-person presence badges + last camera |
| `EnrollmentModal` | `EnrollmentModal.tsx` | Person enrollment dialog (upload/capture) |
| `FilterBar` | `FilterBar.tsx` | Event filtering (camera, person, type, date) |
| `EventTable` | `EventTable.tsx` | Paginated event list with type badges |
| `EventDetail` | `EventDetail.tsx` | Event detail with snapshot + metadata |
| `PersonList` | `PersonList.tsx` | Person directory list view |
| `PersonDetail` | `PersonDetail.tsx` | Person detail panel |
| `StatusBar` | `StatusBar.tsx` | System status indicators |
| `LayoutSelector` | `LayoutSelector.tsx` | Camera grid layout picker |
| `RecordingIndicator` | `RecordingIndicator.tsx` | Recording status badge |
| `TimelineScrubber` | `TimelineScrubber.tsx` | Recording playback timeline |
| `ActivityGraph` | `analytics/ActivityGraph.tsx` | Hourly detection bar chart |
| `HeatmapPanel` | `analytics/HeatmapPanel.tsx` | Detection density heatmap |
| `PresenceTimeline` | `analytics/PresenceTimeline.tsx` | Home/away timeline |
| `ZoneTrafficPanel` | `analytics/ZoneTrafficPanel.tsx` | Zone enter/exit/loiter counts |

---

## Part 5: Advanced Feature Ecosystems

### Cross-Camera Intelligence Pipeline
**Components:** TopologyService + JourneyService + PresenceService + Re-ID + DetectionPipeline

**End-to-end flow:**
1. Person detected at CAM-1 (gate camera)
2. Face recognized as "Maria" (or Re-ID matches body from gallery)
3. PresenceService: AWAY → AT_GATE
4. JourneyService: start new journey
5. 8 seconds later: same person at CAM-2A (walkway)
6. TopologyService: validates transit time [5s, 15s] → valid
7. JourneyService: add step (transit)
8. 12 seconds later: at CAM-3 (interior)
9. PresenceService: ARRIVING → HOME
10. JourneyService: complete (3 steps, 20s total)
11. Telegram: "Maria arrived HOME via Gate → Walkway → Backyard (20s)"

### Multi-Modal Biometric Fusion
**Components:** InsightFace + OSNet-AIN + GaitGL + Identity Fusion

**4-layer identification:**
| Layer | Model | Embedding Dim | Weight | When It Works |
|-------|-------|--------------|--------|---------------|
| **Face** | InsightFace buffalo_l | 512 | 50% | Good lighting, face visible |
| **Body** | OSNet-AIN | 256 | 25% | Face obscured, body visible |
| **Gait** | GaitGL | 128 | 15% | Everything obscured, walking |
| **Soft** | Height/clothing | variable | 10% | Supplementary signal |

**Graceful degradation:** If face fails → body+gait+soft (normalized to 100%). Single layer at ≥0.65 → still "high" confidence.

### Behavioral Analysis
**Components:** ZoneService + TopologyService + SoundService

**Detection capabilities:**
- **Zone intrusion:** Person enters restricted polygon → immediate alert
- **Loitering:** Person dwells in monitored zone > threshold → loiter event
- **Tripwire crossing:** Person crosses directional line → counted with direction
- **Route anomaly:** Person skips expected camera or transits too fast → topology anomaly
- **Disappearance:** Person not seen within blind spot window → disappearance alert
- **Sound events:** Glass break, gunshot, scream → audio security event

---

## Part 6: Integration Points

### Telegram Bot Integration
- **Status:** ✅ Fully Implemented
- **Protocol:** node-telegram-bot-api (polling disabled, send-only)
- **Alert types:** Detection (with snapshot), presence change, journey complete, daily summary
- **Features:** Per-camera and per-person throttling, bundle window, test message, configurable enable/disable

### Ollama LLM Integration
- **Status:** ✅ Fully Implemented
- **Protocol:** HTTP API (`localhost:11434`)
- **Model:** llama3.2 (configurable)
- **Features:** Health check, model verification, daily summary generation with structured security prompts, scheduled at configurable time, optional Telegram delivery

### go2rtc Streaming
- **Status:** ✅ Fully Implemented
- **Protocol:** RTSP proxy (port 8554) + WebRTC signaling (port 1984)
- **Features:** Managed child process, health monitoring, auto-restart, 4-camera dual-stream config (main + sub per camera)
- **Display:** WebRTC `<video>` element (low latency, hardware decoded)
- **AI pipeline:** FFmpeg RTSP → 720p RGB24 at 12fps

### Tapo Camera API
- **Status:** ✅ Fully Implemented
- **Protocol:** HTTPS (reverse-engineered local API, self-signed certs)
- **Features:** MD5-hashed authentication, session management, PTZ move/stop/preset/zoom, device info, motion detection config, SD card status
- **Supported models:** C520WS (PTZ), C246D (dual-lens)

---

## Part 7: Feature Comparison vs Traditional Systems

| Feature | Tapo CCTV Desktop | FaceTracker | Typical NVR |
|---------|-------------------|-------------|-------------|
| **Face Recognition** | ✅ InsightFace 512-dim | ✅ Basic | ❌ |
| **Multi-Object Tracking** | ✅ ByteTrack | ❌ | ❌ |
| **Cross-Camera Re-ID** | ✅ OSNet-AIN body matching | ❌ | ❌ |
| **Gait Recognition** | ✅ GaitGL + heuristic | ❌ | ❌ |
| **4-Layer Identity Fusion** | ✅ Face+Body+Gait+Soft | ❌ | ❌ |
| **Journey Tracking** | ✅ Multi-camera path | ❌ | ❌ |
| **Presence FSM** | ✅ 5-state HOME/AWAY | ❌ | ❌ |
| **Sound Detection** | ✅ YAMNet 521-class | ❌ | ❌ |
| **Liveness Detection** | ✅ Anti-spoofing | ❌ | ❌ |
| **Auto-Enrollment** | ✅ Quality-gated | ❌ | ❌ |
| **Negative Gallery** | ✅ False positive suppression | ❌ | ❌ |
| **Topology Intelligence** | ✅ Spatial graph + anomaly | ❌ | ❌ |
| **Zone/Tripwire/Loitering** | ✅ Polygon + line + dwell | ⚠️ Basic | ⚠️ Basic |
| **PTZ Auto-Tracking** | ✅ PID controller | ❌ | ⚠️ Basic |
| **Floor Plan Visualization** | ✅ Live person dots | ❌ | ❌ |
| **Situation Room** | ✅ 4-panel command center | ❌ | ❌ |
| **Analytics Dashboard** | ✅ Heatmap + charts | ❌ | ⚠️ Basic |
| **LLM Daily Summaries** | ✅ Ollama integration | ❌ | ❌ |
| **WebRTC Display** | ✅ go2rtc proxy | ❌ Canvas | ✅ |
| **Recording + Playback** | ✅ FFmpeg + timeline | ❌ | ✅ |
| **Telegram Alerts** | ✅ With snapshots | ✅ | ❌ |
| **Night Vision Enhancement** | ✅ CLAHE auto-enhance | ❌ | ❌ |
| **GPU Acceleration** | ✅ CUDA RTX 4090 | ❌ CPU | ❌ |

---

## Part 8: Usage Workflows

### Workflow 1: "Who Just Entered My Property?"
```
Camera detects motion → YOLO finds person → ByteTrack assigns track #47
→ Face detected (InsightFace) → Quality gate passes (yaw 15°, blur 120)
→ Face recognized: "Maria" at 0.78 similarity
→ Re-ID: body embedding stored in gallery
→ Zone: entered "Front Yard" zone
→ Presence: AWAY → AT_GATE
→ Journey: started (step 1: Gate camera)
→ Telegram: "Maria detected at Gate (AT_GATE)"
→ 10s later: Maria at interior camera
→ Presence: AT_GATE → HOME
→ Journey: completed (2 steps, 10s)
→ Telegram: "Maria is HOME — Gate → Interior (10s)"
```

### Workflow 2: "Unknown Person Loitering at Night"
```
2:00 AM — Camera detects motion → YOLO finds person
→ CLAHE enhances low-light frame → Face detected but low quality
→ Quality gate rejects face (blur=8 < 15) → Unknown person
→ Re-ID: no gallery match (new visitor)
→ Zone: entered "Restricted" zone → immediate alert
→ 20s passes, still in zone → Loiter alert triggered
→ Telegram: "ALERT: Unknown person loitering in Restricted zone (20s)"
→ Sound: dog barking detected at confidence 0.82
→ PTZ: auto-tracks the person across the frame
```

### Workflow 3: "Daily Security Review"
```
23:00 — OllamaService scheduled trigger
→ Queries DB: 47 detections, 12 known persons, 3 unknowns, 2 zone entries, 1 loiter
→ Builds structured prompt for llama3.2
→ LLM generates: "Today was a normal day. Maria and Juan were most active (8 and 5 detections). 
   3 unknown persons detected between 14:00-16:00, likely delivery personnel.
   1 loitering event in the restricted zone at 02:30 (resolved after 25s).
   Recommendation: Review CAM-2 recordings around 14:15 for unidentified visitor."
→ Stored in daily_summaries table
→ Telegram: delivers full summary to security chat
```

---

## Appendix: Complete File Inventory

### Python Sidecar (17 services + 18 routers)
| Service | Lines | Purpose |
|---------|-------|---------|
| `object_detection.py` | 205 | YOLOv8s CUDA detection |
| `tracker.py` | 327 | ByteTrack multi-object tracking |
| `face_detection.py` | 134 | InsightFace + CLAHE night enhancement |
| `face_recognition.py` | 179 | Cosine similarity matching |
| `quality_gate.py` | 169 | Multi-metric face validation |
| `reid.py` | 463 | OSNet-AIN body Re-ID + gallery |
| `gait_recognition.py` | 266 | GaitGL walking pattern analysis |
| `identity_fusion.py` | 183 | 4-layer weighted fusion |
| `liveness.py` | 159 | MiniFASNet anti-spoofing |
| `sound_detection.py` | 234 | YAMNet audio classification |
| `auto_enrollment.py` | 242 | Quality-gated auto-enrollment |
| `negative_gallery.py` | 255 | False positive suppression |
| `enrollment.py` | ~130 | Manual face enrollment |
| `confirmation_tracker.py` | ~170 | Recognition confirmation tracking |
| `adaptive_threshold.py` | ~210 | Adaptive detection thresholds |
| `model_loader.py` | ~170 | InsightFace model management |
| `model_downloader.py` | ~150 | ONNX model download utility |

### Electron Main Process (22 services + 17 IPC handlers)
| Service | Size | Purpose |
|---------|------|---------|
| `DatabaseService.ts` | 51.9 KB | SQLite CRUD, migrations, seeding |
| `EventProcessor.ts` | 31.6 KB | Detection → event transformation |
| `DetectionPipeline.ts` | 27.1 KB | AI orchestration pipeline |
| `ZoneService.ts` | 19.2 KB | Zone/tripwire/loiter detection |
| `AIBridgeService.ts` | 19.1 KB | HTTP bridge to Python sidecar |
| `TopologyService.ts` | 18.0 KB | Spatial camera graph |
| `TelegramService.ts` | 17.9 KB | Telegram alerts |
| `PTZService.ts` | 16.4 KB | PTZ control + auto-tracking |
| `RecordingService.ts` | 14.6 KB | FFmpeg recording management |
| `TapoAPIService.ts` | 14.5 KB | Tapo camera HTTP API |
| `PresenceService.ts` | 13.9 KB | 5-state presence FSM |
| `ProcessManager.ts` | 12.7 KB | Sidecar lifecycle management |
| `JourneyService.ts` | 12.3 KB | Cross-camera journey tracking |
| `Go2RtcService.ts` | 11.9 KB | go2rtc RTSP proxy management |
| `StreamManager.ts` | 11.7 KB | FFmpeg AI stream management |
| `OllamaService.ts` | 11.5 KB | LLM daily summaries |
| `AnalyticsService.ts` | 9.9 KB | Hourly rollup + heatmaps |
| `SoundService.ts` | 8.2 KB | Audio capture + classification |
| `WebRTCService.ts` | 7.8 KB | WebRTC signaling proxy |
| `MotionDetector.ts` | 6.8 KB | Frame diff motion detection |
| `CryptoService.ts` | 4.7 KB | AES-256-GCM encryption |
| `PortConfig.ts` | 0.5 KB | Port constants |

---

> **Total source code analyzed:** ~15,000+ lines of Python, ~18,000+ lines of TypeScript, ~5,000+ lines of React TSX
> **All features verified by reading actual source code implementation**
