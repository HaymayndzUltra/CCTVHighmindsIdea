# AI Agents & Intelligence Systems

## System Architecture Overview

This CCTV system implements a **multi-agent AI architecture** combining computer vision, biometric recognition, behavioral analysis, and spatial intelligence. The system uses a **Python FastAPI sidecar** for GPU-accelerated AI inference and an **Electron main process** for orchestration, event processing, and cross-camera intelligence.

**Hardware Target:** Ryzen 9 7900 CPU + RTX 4090 GPU (24GB VRAM) + 32GB RAM

---

## 🧠 Core AI Agents

### 1. **Object Detection Agent** (YOLOv8s)

**Location:** `python-sidecar/services/object_detection.py`

**Model:** YOLOv8s (CUDA-accelerated via Ultralytics)

**Capabilities:**
- Real-time person, vehicle, and animal detection
- 8 COCO classes: person, bicycle, car, motorcycle, bus, truck, cat, dog
- Confidence threshold: 0.4 (configurable)
- GPU inference on CUDA device

**API Endpoints:**
- `POST /detect/objects` — Frame-level object detection
- Returns: `{objects: [{object_class, bbox, confidence, class_id}]}`

**Integration:** Primary detection layer feeding into ByteTrack tracker

---

### 2. **Multi-Object Tracking Agent** (ByteTrack)

**Location:** `python-sidecar/services/tracker.py`

**Algorithm:** ByteTrack-inspired IoU-based tracking

**Capabilities:**
- Per-camera persistent track IDs
- High/low confidence detection matching
- Lost track recovery (30-frame timeout)
- Motion trail history (60 points max)
- Tentative → Confirmed track lifecycle (3-hit minimum)

**State Management:**
- Independent `TrackerCamera` instance per camera
- Greedy Hungarian-style IoU matching (threshold: 0.3)
- Track age management with automatic cleanup

**API Endpoints:**
- `POST /detect/objects` — Returns tracked objects with `track_id`
- Track state embedded in detection response

**Integration:** Feeds track IDs to Re-ID, gait, and zone detection agents

---

### 3. **Face Detection Agent** (InsightFace)

**Location:** `python-sidecar/services/face_detection.py`

**Model:** InsightFace (buffalo_l)

**Capabilities:**
- 512-dimensional face embeddings
- Bounding box + confidence scores
- Automatic CLAHE night enhancement (low luminance < threshold)
- Quality-aware detection with raw face object passthrough

**Night Vision Enhancement:**
- Adaptive CLAHE on Y-channel (YCrCb color space)
- Triggered when mean luminance < configured threshold
- Preserves color accuracy via YCrCb conversion

**API Endpoints:**
- `POST /detect/faces` — Face detection with embeddings
- Returns: `{faces: [{bbox, confidence, embedding, clahe_applied}]}`

**Integration:** Feeds embeddings to recognition and quality gate agents

---

### 4. **Face Recognition Agent** (Cosine Similarity)

**Location:** `python-sidecar/services/face_recognition.py`

**Algorithm:** Cosine similarity matching against enrolled gallery

**Capabilities:**
- In-memory embedding gallery (synced from encrypted DB)
- Configurable similarity threshold (default: 0.45)
- Best-match selection across all enrolled persons
- Graceful degradation when no match found

**Embedding Sync:**
- Electron decrypts AES-encrypted embeddings from SQLite
- Syncs to sidecar via `POST /embeddings/sync`
- Auto-resync on sidecar restart detection

**API Endpoints:**
- `POST /recognize` — Match embedding against gallery
- `POST /embeddings/sync` — Update enrolled embeddings
- `GET /embeddings/count` — Gallery size check

**Integration:** Primary identity layer for person identification

---

### 5. **Quality Gate Agent** (Multi-Metric Validation)

**Location:** `python-sidecar/services/quality_gate.py`

**Metrics Evaluated:**
- **Pose angles:** Yaw (±60°), Pitch (±40°), Roll (±45°)
- **Blur detection:** Laplacian variance (min: 15)
- **Detection confidence:** Min score 0.35
- **Face size:** Min 64×64 pixels
- **Landmark quality:** 5-point facial landmark validation

**CCTV-Optimized Thresholds:**
- Relaxed from strict access control to accommodate surveillance scenarios
- Yaw artifact fix: Capped nose offset to ±0.85 (prevents 90° arcsin errors)

**API Endpoints:**
- `POST /quality/check` — Validate face crop quality
- Returns: `{passed, score, reasons: {yaw, pitch, blur, size, confidence}}`

**Integration:** Gates auto-enrollment and high-confidence recognition

---

### 6. **Person Re-Identification Agent** (OSNet-AIN)

**Location:** `python-sidecar/services/reid.py`

**Model:** OSNet-AIN ONNX (256-dim body embeddings)

**Capabilities:**
- Cross-camera person matching via body appearance
- Works without face visibility (backs, side views, obscured faces)
- In-memory gallery with TTL (5-minute default)
- Clothing color extraction (HSV histograms)
- Relative height estimation from bbox aspect ratio

**Fallback Mode:**
- Heuristic color histogram descriptor when ONNX unavailable
- Upper/lower body region analysis (torso vs. legs)
- 256-dim feature vector from HSV histograms

**Gallery Management:**
- Per-camera track storage with global person ID assignment
- Cross-camera matching excludes source camera
- Automatic expiry cleanup (configurable TTL)

**API Endpoints:**
- `POST /reid/extract` — Extract body embedding from person crop
- `POST /reid/match` — Cross-camera matching
- `GET /reid/gallery/stats` — Gallery statistics

**Integration:** Secondary identity layer for face-obscured scenarios

---

### 7. **Gait Recognition Agent** (GaitGL)

**Location:** `python-sidecar/services/gait_recognition.py`

**Model:** GaitGL ONNX (128-dim gait embeddings)

**Capabilities:**
- Walking pattern analysis from 30-frame sequences (~2s @ 15fps)
- Silhouette extraction via adaptive thresholding
- Works when face and body appearance are obscured
- Stride frequency analysis via FFT

**Heuristic Fallback:**
- Motion dynamics: vertical oscillation, aspect ratio variation
- FFT-based stride frequency detection
- Height/width statistics over walking sequence
- 128-dim normalized feature vector

**API Endpoints:**
- `POST /gait/analyze` — Analyze walking sequence
- Returns: `{gait_embedding, confidence, method, frames_used}`

**Integration:** Tertiary identity layer in 4-layer fusion system

---

### 8. **Identity Fusion Agent** (Multi-Layer Weighted Fusion)

**Location:** `python-sidecar/services/identity_fusion.py`

**Algorithm:** Weighted score combination with graceful degradation

**Fusion Weights (4-layer):**
- **Face:** 50% (primary biometric)
- **Body Re-ID:** 25% (appearance)
- **Gait:** 15% (behavioral)
- **Soft biometrics:** 10% (height, clothing, etc.)

**Capabilities:**
- Automatic weight normalization when layers unavailable
- Confidence level classification: low / medium / high
- Layer-specific score tracking
- Person ID resolution priority: face > gait > body

**Confidence Classification:**
- **High:** 3+ layers @ ≥0.5 OR 2+ layers @ ≥0.55 OR single layer @ ≥0.65
- **Medium:** Score ≥0.45
- **Low:** Score <0.45

**Integration:** Combines all biometric layers into unified identity score

---

### 9. **Liveness Detection Agent** (MiniFASNet)

**Location:** `python-sidecar/services/liveness.py`

**Model:** MiniFASNet ONNX (anti-spoofing)

**Capabilities:**
- Photo/screen/mask spoof detection
- Texture analysis via Laplacian variance
- Color histogram spread analysis
- Binary live/spoof classification with confidence score

**Heuristic Fallback:**
- Texture variance scoring (real faces: high variance)
- Color distribution analysis (spoofs: limited range)
- Weighted combination: 60% texture + 40% color
- Threshold: 0.35 for liveness

**API Endpoints:**
- `POST /liveness/check` — Anti-spoofing validation
- Returns: `{is_live, score, method}`

**Integration:** Optional security layer for access control scenarios

---

### 10. **Sound Event Detection Agent** (YAMNet)

**Location:** `python-sidecar/services/sound_detection.py`

**Model:** YAMNet (AudioSet 521-class classifier)

**Security Sound Classes:**
- **Glass break:** Breaking, Shatter, Glass
- **Gunshot:** Gunshot/gunfire, Machine gun, Firecracker
- **Scream:** Screaming, Shout, Yell
- **Dog bark:** Bark, Dog, Growling
- **Horn:** Vehicle horn, Air horn

**Capabilities:**
- 16kHz audio processing (0.96s frames, 0.48s hop)
- Multi-class detection with confidence thresholds
- Temporal event localization (start/end timestamps)
- ONNX or TFLite model support

**API Endpoints:**
- `POST /sound/classify` — Audio event classification
- Returns: `[{class, confidence, start_ms, end_ms}]`

**Integration:** Audio intelligence layer for security alerts

---

### 11. **Auto-Enrollment Agent** (Adaptive Gallery Expansion)

**Location:** `python-sidecar/services/auto_enrollment.py`

**Strategy:** Opportunistic embedding collection from high-quality detections

**Enrollment Criteria:**
- Recognition similarity ≥ 0.55
- Quality score ≥ 80.0
- Max 5 auto-enrolled embeddings per person
- 30-day expiry (automatic purge)

**Capabilities:**
- Automatic embedding extraction from matched faces
- Per-person enrollment count tracking
- Expiry-based cleanup to prevent DB bloat
- Person-level enable/disable flag

**Integration:** Enhances recognition accuracy over time via gallery expansion

---

### 12. **Negative Gallery Agent** (False Positive Suppression)

**Location:** `python-sidecar/services/negative_gallery.py`

**Purpose:** Suppress recurring false positives (strangers, reflections, posters)

**Capabilities:**
- Store embeddings of non-persons to ignore
- Similarity check before recognition (threshold: 0.65)
- Automatic rejection when negative match found
- Manual negative sample addition via UI

**API Endpoints:**
- `POST /negative/add` — Add negative sample
- `GET /negative/list` — List negative gallery
- `DELETE /negative/{id}` — Remove negative sample

**Integration:** Pre-filter before face recognition to reduce false alarms

---

## 🎯 Orchestration & Intelligence Layers

### 13. **Detection Pipeline Orchestrator**

**Location:** `src/main/services/DetectionPipeline.ts`

**Responsibilities:**
- Motion event → AI inference coordination
- Concurrency management (max 3 simultaneous detections)
- Per-camera in-flight detection tracking
- Telephoto burst capture (5-frame best-quality selection)
- Gait sequence buffer accumulation (30-45 frames)
- Performance metrics logging

**Pipeline Flow:**
```
Motion Event
  ↓
YOLO + ByteTrack (objects with track IDs)
  ↓
Person Crops Extraction
  ↓
Face Detection (InsightFace)
  ↓
Face Recognition (if face detected)
  ↓
Re-ID Extraction (body embedding)
  ↓
Cross-Camera Re-ID Matching
  ↓
Gait Buffer Accumulation (30+ frames)
  ↓
Zone Detection (polygon intersection)
  ↓
Event Processor (event creation + Telegram alerts)
```

**Performance Targets:**
- Latency: <2000ms per frame
- Concurrency: 3 cameras simultaneous
- Drop strategy: Per-camera in-flight timeout (10s)

---

### 14. **Event Processor Agent**

**Location:** `src/main/services/EventProcessor.ts`

**Responsibilities:**
- Detection → Event transformation
- Camera group deduplication (5s window, best confidence)
- Snapshot generation (720p JPEG with bounding boxes)
- Telegram alert dispatch
- Journey + Presence integration
- Database persistence

**Event Types:**
- `detection` — Face/person detection
- `zone_enter` / `zone_exit` — Zone boundary crossing
- `loiter` — Prolonged zone presence
- `journey` — Multi-camera path completion
- `presence_change` — HOME/AWAY state transition
- `behavior` — Anomaly detection
- `sound` — Audio event detection

**Deduplication Logic:**
- Same person + camera group + 5s window → keep best confidence
- Prevents duplicate alerts from dual-lens cameras (CAM-2A/2B)

---

### 15. **Topology Intelligence Agent**

**Location:** `src/main/services/TopologyService.ts`

**Capabilities:**
- Camera spatial relationship modeling (directed graph)
- Expected next camera prediction
- Transit time validation (min/max bounds)
- Camera group membership queries
- Anomaly detection: skip, transit violation, disappearance

**Anomaly Types:**
- **Skip detected:** Person appears at camera C without passing through expected camera B
- **Transit violation:** Person appears too quickly or too slowly (outside min/max window)
- **Disappearance:** Person not seen for > blind_spot_max_sec

**Floor Plan Integration:**
- 2D position estimation via edge interpolation
- Real-time person dot rendering on floor plan
- Trail visualization with SVG paths

---

### 16. **Journey Tracking Agent**

**Location:** `src/main/services/JourneyService.ts`

**State Machine:** Start → Update → Complete/Expire

**Capabilities:**
- Multi-step path tracking across cameras
- Topology-aware next camera validation
- Blind spot timeout handling (configurable)
- Journey completion alerts (Telegram)
- Per-person journey deduplication (3s window)

**Lifecycle:**
1. **Start:** Known person detected at any camera
2. **Update:** Same person appears at expected next camera within transit window
3. **Complete:** Person reaches interior camera (end of path)
4. **Expire:** No detection for > blind_spot_max_sec

**Integration:** Feeds journey context into event alerts

---

### 17. **Presence Tracking Agent**

**Location:** `src/main/services/PresenceService.ts`

**5-State FSM:** UNKNOWN → AT_GATE → ARRIVING → HOME → DEPARTING → AWAY

**Transitions:**
- **AT_GATE:** Detected at gate camera (no inbound topology edges)
- **ARRIVING:** Moving from gate toward interior
- **HOME:** Detected at interior camera
- **DEPARTING:** Moving from interior toward gate
- **AWAY:** Not seen for 30 minutes (configurable timeout)

**Capabilities:**
- Per-person state tracking in memory
- Topology-based camera role classification (gate vs. interior)
- Timeout-based AWAY transition
- Telegram presence alerts (HOME/AWAY/AT_GATE)
- Presence history persistence

**Integration:** Provides household presence awareness for automation

---

### 18. **Intelligent PTZ Control Agent**

**Location:** `src/main/services/PTZService.ts`

**Capabilities:**
- Auto-tracking with PID controller
- Zoom-to-target (person-centered framing)
- Preset patrol with interrupt/resume
- Multi-camera coordinated handoff via topology
- Tapo C520WS/C246D API integration

**Auto-Tracking:**
- PID-based smooth pan/tilt adjustment
- Target lock on track ID
- Automatic zoom adjustment based on person distance
- Handoff to next camera when person exits FOV

**Preset Patrol:**
- Sequential preset visitation
- Configurable dwell time per preset
- Interrupt on detection → resume after tracking complete

---

### 19. **Zone Detection Agent**

**Location:** `src/main/services/ZoneService.ts`

**Capabilities:**
- Polygon-based zone definition (GeoJSON)
- Track-to-zone intersection detection
- Entry/exit event generation
- Loitering detection (configurable dwell time)
- Per-zone type rules (restricted, monitored, safe)

**Zone Types:**
- **Restricted:** Alerts on any entry
- **Monitored:** Alerts on loitering only
- **Safe:** No alerts (tracking only)

**API Endpoints:**
- `POST /zone/check` — Check track intersections with zones
- Returns: `{events: [{zone_id, track_id, event_type}]}`

**Integration:** Feeds zone events into event processor for alerts

---

## 🔧 Supporting Services

### 20. **AI Bridge Service**

**Location:** `src/main/services/AIBridgeService.ts`

**Responsibilities:**
- HTTP client to Python sidecar (localhost:8520)
- Frame buffer → base64 JPEG conversion (Sharp)
- Request timeout (5s) + retry (1 attempt)
- Sidecar health monitoring
- Embedding sync orchestration (decrypt → POST)

**Endpoints Wrapped:**
- `/detect/faces`, `/detect/objects`, `/recognize`
- `/embeddings/sync`, `/embeddings/count`
- `/reid/extract`, `/reid/match`, `/gait/analyze`
- `/liveness/check`, `/sound/classify`, `/zone/check`
- `/quality/check`, `/negative/add`, `/auto_enroll`

---

### 21. **Process Manager**

**Location:** `src/main/services/ProcessManager.ts`

**Responsibilities:**
- Python sidecar lifecycle management (spawn, monitor, restart)
- go2rtc process management
- Health check loop (10s interval)
- Embedding sync validation (30s cooldown)
- Re-ID gallery cleanup (1-min interval)

**Health Checks:**
- Sidecar status: `GET /health`
- Model load status: `model_loaded`, `yolo_loaded`, `reid_loaded`, `gait_loaded`, `liveness_loaded`, `sound_loaded`
- GPU availability: `gpu_available`, `gpu_name`
- Embedding count validation

---

### 22. **Telegram Alert Service**

**Location:** `src/main/services/TelegramService.ts`

**Capabilities:**
- Rich alert formatting with emojis
- Snapshot image attachments (720p JPEG)
- Journey context in alerts
- Presence state notifications
- Zone event alerts
- Configurable alert types

**Alert Types:**
- Face detection (known/unknown)
- Zone entry/exit/loiter
- Journey completion
- Presence changes (HOME/AWAY)
- Sound events
- Topology anomalies

---

## 📊 AI Performance Characteristics

### Inference Latency (RTX 4090)
- **YOLOv8s:** ~15ms per frame (1280×720)
- **InsightFace:** ~20ms per face
- **Face Recognition:** <1ms (cosine similarity)
- **Re-ID (OSNet):** ~10ms per person crop
- **Gait (GaitGL):** ~50ms per 30-frame sequence
- **Total Pipeline:** <2000ms target (motion → alert)

### Memory Footprint
- **VRAM:** ~4GB (all models loaded)
- **RAM:** ~2GB (Python sidecar + Electron main)
- **Gallery:** ~50KB per 1000 embeddings (512-dim float32)

### Accuracy Metrics (Estimated)
- **Face Recognition:** >95% @ threshold 0.45 (daylight)
- **Re-ID:** >80% cross-camera matching @ threshold 0.55
- **Object Detection:** >90% person detection @ conf 0.4
- **Tracking:** >85% ID consistency across occlusions

---

## 🚀 Deployment Configuration

### Model Files Required
```
python-sidecar/models/
├── yolov8s.pt              # YOLOv8s weights (auto-download)
├── osnet_ain_x1_0.onnx     # Re-ID model (optional)
├── gaitgl.onnx             # Gait model (optional)
├── minifasnet.onnx         # Liveness model (optional)
└── yamnet.onnx             # Sound model (optional)
```

### GPU Requirements
- **Minimum:** NVIDIA GPU with CUDA 11.8+ support
- **Recommended:** RTX 4090 (24GB VRAM) for 4-camera concurrent processing
- **Fallback:** CPU-only mode (10× slower, not recommended for real-time)

### Configuration Files
- `python-sidecar/config.py` — AI model thresholds, quality gates
- `.env` — Sidecar port, GPU settings, Telegram credentials
- `go2rtc.yaml` — RTSP stream configuration

---

## 🎓 AI Agent Interaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Motion Detector                          │
│                    (Frame-level change detection)               │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Detection Pipeline Orchestrator              │
│              (Concurrency + burst + gait buffering)             │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                    ┌────────┴────────┐
                    ↓                 ↓
         ┌──────────────────┐  ┌─────────────────┐
         │  YOLO + ByteTrack│  │  Face Detection │
         │   (Objects+IDs)  │  │   (InsightFace) │
         └────────┬─────────┘  └────────┬────────┘
                  ↓                     ↓
         ┌────────────────────┐  ┌──────────────────┐
         │   Re-ID Extraction │  │  Face Recognition│
         │     (OSNet-AIN)    │  │  (Cosine Sim)    │
         └────────┬───────────┘  └────────┬─────────┘
                  ↓                       ↓
         ┌────────────────────┐  ┌──────────────────┐
         │ Cross-Camera Match │  │  Quality Gate    │
         │  (Gallery Search)  │  │  (Multi-Metric)  │
         └────────┬───────────┘  └────────┬─────────┘
                  ↓                       ↓
         ┌────────────────────────────────────────┐
         │        Identity Fusion Agent           │
         │   (4-layer weighted combination)       │
         └────────────────┬───────────────────────┘
                          ↓
         ┌────────────────────────────────────────┐
         │          Event Processor               │
         │  (Dedup + Snapshot + DB + Telegram)    │
         └────────┬───────────────────────────────┘
                  ↓
    ┌─────────────┴─────────────┐
    ↓                           ↓
┌───────────────┐      ┌────────────────┐
│ Journey Agent │      │ Presence Agent │
│ (Path Track)  │      │  (5-State FSM) │
└───────────────┘      └────────────────┘
```

---

## 📝 Summary

This system implements **22 specialized AI agents** working in concert to provide:

1. **Multi-modal biometric identification** (face + body + gait + soft)
2. **Cross-camera intelligence** (Re-ID + topology + journey tracking)
3. **Behavioral analysis** (presence FSM + loitering + anomalies)
4. **Spatial awareness** (zones + floor plan + topology graph)
5. **Audio intelligence** (security sound classification)
6. **Adaptive learning** (auto-enrollment + negative gallery)
7. **Intelligent automation** (PTZ tracking + preset patrol)

The architecture prioritizes **graceful degradation** (heuristic fallbacks), **real-time performance** (<2s latency), and **production reliability** (health monitoring, auto-restart, embedding sync).
