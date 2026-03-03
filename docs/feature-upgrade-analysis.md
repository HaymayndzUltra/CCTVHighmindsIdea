# Feature Upgrade Analysis: FaceTracker → Tapo CCTV Desktop

## Executive Summary

This document analyzes the AI features from **FaceTracker (GuardianAI)** that should be ported to **Tapo CCTV Desktop**, plus advanced ideas that go **beyond** FaceTracker's capabilities. The goal is to combine FaceTracker's intelligent AI brain with Tapo CCTV Desktop's polished Electron UI.

---

## Current State Comparison

| Layer | Tapo CCTV Desktop | FaceTracker |
|-------|-------------------|-------------|
| **UI** | ✅ Electron + React (polished) | ⚠️ Flask web (basic) |
| **Streaming** | ✅ go2rtc + FFmpeg raw frames | ✅ go2rtc + OpenCV |
| **Object Detection** | ❌ Pixel-diff motion only | ✅ YOLOv8s + ByteTrack |
| **Face Recognition** | ✅ InsightFace buffalo_l | ✅ InsightFace buffalo_l |
| **Tracking** | ❌ None | ✅ Multi-object tracking |
| **Zones** | ⚠️ Basic line crossing | ✅ Polygon zones + tripwires |
| **Intelligence** | ❌ None | ✅ Presence + Journey + LLM reports |
| **GPU** | ⚠️ CUDA failing (CPU only) | ✅ CUDA working |

---

## Phase 1: Foundation Fixes (Priority: CRITICAL)

These must be fixed first — they're prerequisites for all AI features.

### 1.1 Fix CUDA/GPU Acceleration
- **Current**: ONNX Runtime falls back to CPUExecutionProvider despite RTX 4090
- **Root cause**: `onnxruntime_providers_cuda.dll` can't load `cublasLt64_12.dll`
- **Fix**: Install matching CUDA 12.x toolkit + cuDNN, or pin `onnxruntime-gpu` to match installed CUDA version
- **Impact**: 5-10x inference speedup → enables real-time AI on all 4 cameras simultaneously
- **Effort**: Low (dependency fix)

### 1.2 Switch to Sub-Stream for AI Processing
- **Current**: AI sidecar receives 1920×1080 RGB24 frames (6.2MB each) via FFmpeg
- **Better**: Send sub-stream (720p) to AI, main stream to display only
- **Why**: FaceTracker uses `ai_stream: "sub"` — 720p is sufficient for face detection and uses 75% less bandwidth/compute
- **Impact**: ~4x reduction in AI processing load per camera
- **Effort**: Medium (separate display and AI stream paths)

---

## Phase 2: Port FaceTracker's Core AI (Priority: HIGH)

### 2.1 YOLOv8s Object Detection + ByteTrack Tracking
**What it does**: Detects persons, vehicles, animals with persistent track IDs across frames.

**Why it's better than pixel-diff motion**:
- Knows WHAT moved (person vs car vs cat)
- Tracks the SAME person across frames with a unique ID
- Enables trajectory analysis, loitering detection, counting
- Eliminates false positives from shadows, rain, wind

**Implementation approach**:
- Add `ultralytics` to python-sidecar requirements
- New `/detect_objects` endpoint: accepts frame → returns tracked objects with IDs
- Share YOLO model across cameras (like FaceTracker: shared weights, per-camera ByteTrack state)
- Only run face recognition on person-class detections (massive accuracy improvement)

**FaceTracker reference**: `ai/object_detector.py`, `ai/tracker.py`, `ai/pipeline.py`

**Effort**: Medium-High

### 2.2 Face Quality Gate
**What it does**: Only alerts on clear, front-facing, sharp faces — prevents false alerts from blurry/sideways faces.

**FaceTracker's quality checks**:
```
- FACE_CONFIRM_FRAMES = 3        # min consecutive recognitions before alert
- FACE_WEIGHTED_VOTING = True     # similarity-weighted confirmation
- FACE_MAX_YAW_DEG = 40.0        # reject too-sideways faces
- FACE_MAX_PITCH_DEG = 30.0      # reject too-steep angles
- FACE_MIN_BLUR_SCORE = 60.0     # reject blurry faces (Laplacian variance)
- FACE_MIN_DET_SCORE = 0.72      # min InsightFace confidence
- FACE_EMBEDDING_EMA_ALPHA = 0.4 # temporal smoothing of embeddings
```

**Why it matters**: Current system alerts on any detected face regardless of quality. This causes spam alerts from partial/blurry detections.

**Implementation**: Add quality scoring to python-sidecar's `/detect` endpoint.

**FaceTracker reference**: `ai/face_engine.py` (quality gate logic), `ai/pipeline.py` (voting system)

**Effort**: Medium

### 2.3 Night Vision Enhancement (CLAHE)
**What it does**: Applies Contrast Limited Adaptive Histogram Equalization to low-light frames before face detection.

**FaceTracker config**:
```python
FACE_NIGHT_ENHANCE = True
FACE_LOW_LUM_THRESHOLD = 80.0  # mean luminance threshold
```

**Implementation**: Add CLAHE preprocessing in python-sidecar before InsightFace inference.

**Effort**: Low

### 2.4 Auto-Enrollment (Runtime Augmentation)
**What it does**: When a known person is detected with high confidence in good conditions, automatically captures new reference embeddings to improve future recognition.

**FaceTracker config**:
```python
AUTO_ENROLL_ENABLED = True
AUTO_ENROLL_MIN_SIM = 0.55       # only auto-enroll high-confidence matches
AUTO_ENROLL_MAX_PER_PERSON = 5   # limit auto-enrolled samples
AUTO_ENROLL_MIN_QUALITY = 80.0   # only capture high-quality faces
AUTO_ENROLL_EXPIRY_DAYS = 30     # auto-expire old augmentations
```

**Why it matters**: People look different at night, in different lighting, with glasses, etc. Auto-enrollment builds a richer embedding gallery over time without manual effort.

**Effort**: Medium

### 2.5 Negative Gallery
**What it does**: Stores "false positive" face crops so the system can actively reject known bad matches.

**Example**: If the system keeps mistaking a painting on the wall for "Angelo", you add that crop to Angelo's negative gallery. Future matches against that crop are rejected.

**Effort**: Low (database + similarity check addition)

---

## Phase 3: Port FaceTracker's Intelligence Layer (Priority: HIGH)

### 3.1 Zone Detection System
**What it does**: Define polygon zones on camera views with different behaviors:
- **RESTRICTED**: Alert when anyone enters
- **MONITORED**: Log all activity
- **COUNTING**: Count entries/exits
- **TRIPWIRE**: Directional line crossing with track correlation

**UI needed**: Zone editor overlay on camera tile (draw polygons/lines on the canvas)

**FaceTracker reference**: `ai/zone_detector.py`, `ai/zone_sequence_detector.py`

**Effort**: High (includes UI zone editor)

### 3.2 Loitering Detection
**What it does**: Alerts when a person stays in a zone longer than a threshold (e.g., someone lingering at the gate for >15 seconds).

**Requires**: ByteTrack tracking (Phase 2.1) + Zone system (Phase 3.1)

**FaceTracker config**:
```python
LOITERING_THRESHOLD_SECONDS = 15
LOITERING_COOLDOWN_SECONDS = 180
LOITERING_MIN_MOVEMENT_RADIUS = 80.0  # must stay within this radius
```

**Effort**: Medium (depends on 2.1 + 3.1)

### 3.3 Cross-Camera Journey Tracking
**What it does**: Tracks a person's movement across cameras using face recognition:
```
Gate (CAM-2A/2B) → Garden (CAM-3) → Indoor (CAM-1)
```

**How it works**:
- When a face is recognized at one camera, a "journey" starts
- If the same face appears at the next expected camera within a time window, the journey updates
- Generates events like "Angelo arrived: Gate → Garden → House in 45s"

**FaceTracker reference**: `intelligence/journey_tracker.py`

**Effort**: Medium

### 3.4 Presence Tracking (HOME/AWAY States)
**What it does**: Maintains presence state per known person:
```
States: HOME → AT_GATE → AWAY → ARRIVING → DEPARTING
```

**Generates events like**:
- "Angelo is DEPARTING (detected at gate, was HOME)"
- "Angelo is ARRIVING (detected at gate, was AWAY)"
- "Angelo marked AWAY (not seen for 30 minutes)"

**FaceTracker reference**: `intelligence/presence_tracker.py`

**Effort**: Medium

### 3.5 Tele Burst Capture
**What it does**: When a person is detected on CAM-2A (wide-angle), immediately captures a burst of frames from CAM-2B (telephoto) to get a closer, higher-quality face image for Telegram alerts.

**Why it's clever**: The telephoto lens has better zoom but narrower field of view. By triggering it when the wide-angle detects someone, you get the best of both worlds.

**FaceTracker reference**: `ai/tele_burst_capture.py`

**Effort**: Medium

### 3.6 Camera Group Deduplication
**What it does**: CAM-2A and CAM-2B watch the same area. Without deduplication, every face event triggers TWO alerts (one per camera). Camera groups suppress duplicate alerts within the same group.

**FaceTracker reference**: `config.py` CAMERA_GROUPS

**Effort**: Low

---

## Phase 4: Advanced Ideas BEYOND FaceTracker (Priority: MEDIUM)

### 4.1 Real-Time Bounding Box Overlay on Canvas
**What it does**: Draw detection boxes, track trails, person names, and confidence scores directly on the video canvas in the Electron renderer.

**FaceTracker limitation**: Annotation is done server-side (OpenCV drawRectangle on frames), adding latency and preventing interactive overlays.

**Better approach for Electron**:
- AI sidecar returns detection coordinates (not annotated frames)
- Renderer draws SVG/Canvas overlays on top of the video canvas
- Overlays can be interactive (click a box to enroll, right-click to add to negative gallery)
- Smooth interpolation between detection frames for fluid tracking visualization

**Effort**: Medium

### 4.2 WebRTC Streaming (Replace Raw Frame IPC)
**What it does**: Replace the current 6.2MB-per-frame IPC pipeline with WebRTC streaming from go2rtc directly to the renderer.

**Current pipeline** (heavy):
```
Camera → go2rtc → FFmpeg (decode) → raw RGB24 (6.2MB) → IPC → renderer canvas
```

**WebRTC pipeline** (efficient):
```
Camera → go2rtc → WebRTC (H.264 hardware decode) → renderer <video> element
```

**Benefits**:
- 100x less IPC bandwidth (compressed H.264 vs raw RGB24)
- Hardware H.264 decode on GPU (near-zero CPU)
- Sub-100ms latency
- go2rtc already has WebRTC support built-in

**AI pipeline stays separate**: AI sidecar still processes sub-stream frames for detection, but display uses WebRTC.

**Effort**: Medium-High

### 4.3 DVR/NVR Recording with Timeline Playback
**What it does**: Continuous recording with event-tagged timeline scrubber.

**Implementation**:
- go2rtc can record to MP4/HLS segments
- Store 24/7 recordings or event-triggered clips
- Timeline UI in renderer with event markers
- Click an event → jump to that timestamp in recording

**Effort**: High

### 4.4 Analytics Dashboard
**What it does**: Visual analytics of security data:
- **Heatmap**: Where people appear most often per camera
- **Activity graph**: Detections per hour/day
- **Person presence timeline**: When each person was home/away
- **Zone traffic**: Entry/exit counts per zone per day

**UI**: New "Analytics" screen in sidebar with charts (recharts/nivo)

**Effort**: High

### 4.5 LLM-Powered Daily Reports
**What it does**: AI-generated natural language summary of the day's security events.

**FaceTracker reference**: `intelligence/daily_report.py`, `intelligence/llm_engine.py`

**Example output**:
```
Daily Security Summary — March 3, 2026
- 12 person detections across 4 cameras
- Angelo arrived home at 6:15 PM (Gate → Garden → House in 40s)
- Unknown person detected at front gate at 2:30 AM (3 occurrences, loitered 45s)
- CAM-3 had highest activity (garden lights attract movement at night)
- Recommendation: Review 2:30 AM gate footage
```

**Advanced idea**: Use local LLM (Ollama/llama.cpp) instead of OpenAI API for privacy.

**Effort**: Medium

### 4.6 Liveness Detection (Anti-Spoofing)
**What it does**: Detects if a face is from a real person or a photo/screen held up to the camera.

**FaceTracker's approach**: LBP texture analysis (~85-90% accuracy, experimental)

**Better approach**: Use dedicated anti-spoofing model (e.g., MiniFASNet from Silent-Face-Anti-Spoofing) for higher accuracy.

**Effort**: Medium

### 4.7 Sound Event Detection
**What it does**: Analyze audio from camera streams for:
- Glass breaking
- Gunshots
- Screaming/shouting
- Dog barking
- Vehicle horn

**Implementation**: Use YAMNet (Google's audio event classifier) on camera audio streams.

**Why it's beyond FaceTracker**: FaceTracker has no audio analysis at all.

**Effort**: High

### 4.8 Adaptive Face Threshold Per Person
**What it does**: Instead of a global similarity threshold, each person gets a dynamically adjusted threshold based on their enrollment quality and runtime performance.

**FaceTracker has this** (partially):
```python
FACE_ADAPTIVE_THRESHOLD = True
FACE_MIN_THRESHOLD = 0.45
FACE_MAX_THRESHOLD = 0.65
FACE_MIN_MARGIN = 0.08  # best-vs-second-best gap
```

**Advanced idea**: Use enrollment embedding clustering to set per-person thresholds automatically. People with diverse reference photos get lower thresholds (more forgiving), people with only 1-2 photos get higher thresholds (stricter).

**Effort**: Low-Medium

---

## Recommended Implementation Order

```
Phase 1 (Foundation) — 1-2 days
  1.1 Fix CUDA/GPU → instant 5-10x AI speedup
  1.2 Separate AI stream (sub) from display stream (main)

Phase 2 (Core AI) — 3-5 days
  2.1 YOLOv8s + ByteTrack → real object tracking
  2.2 Face quality gate → eliminate false alerts
  2.3 Night enhancement (CLAHE) → better night detection
  2.4 Auto-enrollment → self-improving recognition
  2.5 Negative gallery → reject known false positives

Phase 3 (Intelligence) — 3-5 days
  3.1 Zone detection system + UI editor
  3.2 Loitering detection
  3.3 Journey tracking
  3.4 Presence tracking (HOME/AWAY)
  3.5 Tele burst capture (dual-lens optimization)
  3.6 Camera group dedup

Phase 4 (Advanced) — 5-10 days
  4.1 Real-time bounding box overlay
  4.2 WebRTC streaming (replace raw IPC)
  4.3 DVR/NVR recording + timeline
  4.4 Analytics dashboard
  4.5 LLM daily reports
  4.6 Liveness detection
  4.7 Sound event detection
  4.8 Adaptive per-person thresholds
```

---

## Architecture for Porting

The key architectural decision: **keep the Python AI sidecar as the AI brain**.

```
┌─────────────────────────────────────────────────┐
│                  Electron Main                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ go2rtc   │  │ StreamMgr│  │ DetectionPipe │ │
│  │ (proxy)  │  │ (FFmpeg) │  │ (orchestrator)│ │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘ │
│       │              │               │           │
│       │    ┌─────────▼───────────────▼────────┐ │
│       │    │       Python AI Sidecar           │ │
│       │    │  ┌─────────┐ ┌────────────────┐  │ │
│       │    │  │ YOLOv8s │ │  InsightFace   │  │ │
│       │    │  │ByteTrack│ │  (buffalo_l)   │  │ │
│       │    │  └─────────┘ └────────────────┘  │ │
│       │    │  ┌─────────┐ ┌────────────────┐  │ │
│       │    │  │  Zones  │ │  Presence/     │  │ │
│       │    │  │ Loiter  │ │  Journey       │  │ │
│       │    │  └─────────┘ └────────────────┘  │ │
│       │    └──────────────────────────────────┘ │
└───────┼─────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────┐
│               Electron Renderer                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Canvas (video) + SVG Overlays (boxes)   │   │
│  │  Zone Editor + Analytics + Timeline      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

The Python sidecar already exists. Most FaceTracker features can be ported as new modules within the sidecar, exposed via new FastAPI endpoints. The Electron main process orchestrates, and the renderer displays.

---

## Phase 5: Presidential-Level Surveillance Tracking (Priority: FUTURE / R&D)

> _"Parang presidente ng bansa"_ — the goal is seamless, zero-gap tracking of subjects
> across every camera with full situational awareness, real-time identity confirmation,
> and predictive path analysis.

This phase describes capabilities found in **government/military-grade CCTV systems**
(e.g., presidential security details, airport perimeter, embassy compounds). These go
far beyond what FaceTracker currently implements.

---

### 5.1 Cross-Camera Person Re-Identification (Re-ID)

**What it does**: When a person walks out of CAM-1's field of view and into CAM-3,
the system **automatically knows it's the same person** — even if the face is never
visible (back turned, wearing hat, mask, etc.).

**How it works**:
- YOLO detects a person → crop the full body
- Extract a **body appearance embedding** (clothing color, body shape, proportions)
- Match body embeddings across cameras → same person gets a **global track ID**
- Fuse with face embedding when available for higher confidence

**Models**:
| Model | Speed (RTX 4090) | Accuracy (mAP) | Notes |
|-------|------------------|-----------------|-------|
| OSNet-AIN | ~2ms/crop | 88.6% (Market-1501) | Best speed/accuracy tradeoff |
| FastReID (BoT) | ~3ms/crop | 94.5% (Market-1501) | Higher accuracy, heavier |
| TransReID (ViT) | ~8ms/crop | 95.1% (Market-1501) | SOTA but GPU-hungry |
| CLIP-ReID | ~10ms/crop | 93.8% (Market-1501) | Zero-shot clothing change robustness |

**Recommended**: Start with **OSNet-AIN** (lightweight, ONNX exportable, 2ms latency).
Upgrade to FastReID if accuracy is insufficient.

**Implementation outline**:
```
1. Add ReID model to python-sidecar (new services/reid.py)
2. On every YOLO person detection → extract body crop → compute ReID embedding
3. Maintain a global ReID gallery (short-term: last 5 minutes of embeddings per track)
4. When a new person appears on ANY camera → match against gallery
5. If match found → assign same global_person_id across cameras
6. Fuse with face embedding when available (weighted: face 0.7 + body 0.3)
```

**FaceTracker gap**: ❌ No body Re-ID at all. Tracking is per-camera only (ByteTrack
resets when a person leaves the frame). This is the **single biggest missing piece**.

**Effort**: High (new model integration + cross-camera matching logic)

---

### 5.2 Spatial Topology Map (Camera Connectivity Graph)

**What it does**: The system understands the **physical layout** of cameras — which
cameras are adjacent, expected transit times, and valid movement paths.

**Example topology**:
```
                    ┌─────────────┐
                    │  CAM-2A/2B  │
                    │ (Front Gate)│
                    └──────┬──────┘
                           │  ~10s walk
                    ┌──────▼──────┐
                    │   CAM-3     │
                    │  (Garden)   │
                    └──────┬──────┘
                           │  ~15s walk
                    ┌──────▼──────┐
                    │   CAM-1     │
                    │   (Sala)    │
                    └─────────────┘
```

**Configuration** (new config section):
```python
CAMERA_TOPOLOGY = {
    "edges": [
        {"from": "CAM-2A", "to": "CAM-3",  "transit_sec": (8, 20),  "direction": "inbound"},
        {"from": "CAM-3",  "to": "CAM-1",  "transit_sec": (10, 25), "direction": "inbound"},
        {"from": "CAM-1",  "to": "CAM-3",  "transit_sec": (10, 25), "direction": "outbound"},
        {"from": "CAM-3",  "to": "CAM-2A", "transit_sec": (8, 20),  "direction": "outbound"},
    ],
    "blind_spot_max_sec": 60,  # max time a person can be "missing" before alert
}
```

**Capabilities enabled**:
- **Predictive handoff**: "Person leaving CAM-3 heading towards house → pre-warm CAM-1 recording"
- **Anomaly detection**: Person appears at CAM-1 without passing CAM-3 → possible intrusion from side
- **Transit time violation**: Person took 3 minutes between cameras that are 15 seconds apart → suspicious (hiding? scouting?)
- **Disappearance alert**: Person entered via gate but never reached house after 60 seconds

**FaceTracker gap**: ⚠️ PresenceTracker has a basic 5-state FSM (HOME/AWAY/ARRIVING/DEPARTING/AT_GATE)
but no explicit topology graph or transit time modeling.

**Effort**: Medium

---

### 5.3 Floor Plan Real-Time Visualization

**What it does**: An overhead map of the property with **real-time dots** showing where
each tracked person is located, with identity labels and movement trails.

**UI mockup**:
```
┌─────────────────────────────────────────────────┐
│  🏠 Property Map                    [Live]      │
│                                                  │
│    ┌──────┐        ┌──────────────┐             │
│    │ Gate │        │   Garden     │             │
│    │  📹  │───path──│    📹       │             │
│    │ 🔴A  │        │  🟢B  🔵?  │             │
│    └──────┘        └──────┬───────┘             │
│                           │                      │
│                    ┌──────▼───────┐              │
│                    │    Sala      │              │
│                    │     📹      │              │
│                    │    🟢C      │              │
│                    └─────────────┘              │
│                                                  │
│  Legend: 🟢 Known  🔴 Unknown  🔵 Unidentified  │
│  A = "Unknown Male" (gate, 3s ago)              │
│  B = "Angelo" (garden, now)                      │
│  C = "Maria" (sala, 12s ago)                    │
│                                                  │
│  Trail: Angelo → Gate(6:14) → Garden(6:14:15)   │
└─────────────────────────────────────────────────┘
```

**Implementation**:
- Store camera positions as (x, y) on a floor plan image
- Map person detections to approximate (x, y) based on camera FOV + position in frame
- Render with Canvas/SVG in Electron renderer
- Animate position transitions (smooth interpolation between camera detections)
- Show movement trail (last 5 minutes) as a fading line

**Effort**: High (needs floor plan editor UI + coordinate mapping)

---

### 5.4 Multi-Layer Identity Confirmation

**What it does**: Presidential security doesn't rely on just one biometric. Multiple
layers confirm identity with increasing confidence:

| Layer | Biometric | When Used | Accuracy | Speed |
|-------|-----------|-----------|----------|-------|
| **Primary** | Face Recognition | Face visible, front-facing | ~99.5% | 8ms |
| **Secondary** | Body Re-ID | Face not visible, masked | ~88-95% | 2-3ms |
| **Tertiary** | Gait Recognition | Far distance, poor lighting | ~85-92% | 15ms |
| **Soft** | Height + Clothing | Supplementary confirmation | ~70% | <1ms |

**Gait Recognition** (most advanced):
- Every person has a unique walking pattern (stride length, arm swing, posture)
- Works at distances where face is too small to recognize
- Robust to disguise (can't easily change how you walk)
- Models: GaitSet, GaitGL, OpenGait
- **Limitation**: Requires ~2 seconds of walking footage (not instant)

**Soft Biometrics** (cheapest):
- Estimate height from bounding box + camera calibration
- Extract dominant clothing colors (histogram of body crop)
- Hair color/length from head region
- These alone aren't reliable but **combined with Re-ID** they boost confidence

**FaceTracker gap**: Only has face recognition (Layer 1). No body Re-ID, gait, or soft biometrics.

**Effort**: Very High (gait requires temporal sequence modeling)

---

### 5.5 Behavioral Anomaly Detection

**What it does**: Detects suspicious behavior patterns, not just "who is this person"
but "what are they doing and is it normal?"

| Behavior | Detection Method | Requires |
|----------|-----------------|----------|
| **Loitering** | Track stays in zone > threshold | ByteTrack + Zones |
| **Pacing/Circling** | Track trajectory forms repeated loops | ByteTrack + path analysis |
| **Running** | Track velocity exceeds threshold | ByteTrack + velocity calc |
| **Tailgating** | Two persons enter restricted zone within <2s of each other | ByteTrack + Zones |
| **Object Abandonment** | Static detection persists after person leaves | YOLO + temporal diff |
| **Camera Tampering** | Sudden large-area change or black frame | Frame analysis |
| **Crowd Formation** | >N persons in zone simultaneously | ByteTrack + Zones |
| **Wrong Direction** | Person moves against expected flow (e.g., entering through exit) | ByteTrack + Topology |
| **Time Anomaly** | Activity at unusual hour (e.g., 3 AM movement in garden) | Event timestamp analysis |

**Implementation priority** (ordered by impact/effort ratio):
1. Loitering — already partially in FaceTracker (Phase 3.2)
2. Running detection — simple velocity threshold
3. Time anomaly — trivial to implement, high value
4. Camera tampering — frame-level analysis, no AI needed
5. Tailgating — needs zone + multi-person track correlation
6. The rest — R&D level

**Effort**: Medium to Very High (depends on which behaviors)

---

### 5.6 Situation Room Command Dashboard

**What it does**: A unified "war room" view combining all intelligence into one screen,
designed for a security operator monitoring in real-time.

**Layout**:
```
┌────────────────────────────────────────────────────────────┐
│ ⚠️ ALERTS (3)                              Mar 3, 8:25 AM │
│ ├── 🔴 Unknown person at Gate (2 min ago)                  │
│ ├── 🟡 Angelo departed (Gate → Away, 5 min ago)            │
│ └── 🟢 Maria arrived (Gate → Garden → House, 12 min ago)   │
├────────────────────────────┬───────────────────────────────┤
│        FLOOR MAP           │     ACTIVE CAMERA FEED        │
│    (real-time dots)        │   (click dot → shows feed)    │
│    [see 5.3 above]         │   ┌─────────────────────┐    │
│                            │   │ CAM-2A: Front Gate   │    │
│                            │   │ [live video + boxes]  │    │
│                            │   └─────────────────────┘    │
├────────────────────────────┼───────────────────────────────┤
│   PERSON STATUS            │   EVENT TIMELINE              │
│   Angelo: 🔴 AWAY (35m)   │   ━━━●━━━━●━━━━●━━━━━●━━━▶  │
│   Maria:  🟢 HOME (12m)   │      6AM   7AM  8AM    now    │
│   Juan:   🟡 AT_GATE      │   Click to jump to recording  │
│   Unknown: ⚪ 2 sightings  │                               │
└────────────────────────────┴───────────────────────────────┘
```

**Electron advantage**: This is where Tapo CCTV Desktop has a huge advantage over
FaceTracker's basic Flask dashboard. Electron + React can deliver a polished,
responsive, multi-panel situation room that feels like professional security software.

**Effort**: Very High (but builds on all previous phases)

---

### Gap Analysis: Current State vs Presidential-Level

| Capability | Presidential-Level | FaceTracker (GuardianAI) | Tapo CCTV Desktop | Gap Size |
|---|---|---|---|---|
| Face Recognition | ✅ Multi-angle, voting, adaptive | ✅ Implemented (14 proposals) | ⚠️ Basic single-shot | Small / Large |
| Cross-Camera Re-ID | ✅ Body + face + gait fusion | ❌ Per-camera only | ❌ None | **Critical** |
| Track Handoff | ✅ Seamless global track IDs | ❌ Per-camera ByteTrack | ❌ No tracking at all | **Critical** |
| Spatial Topology | ✅ Full graph + transit times | ⚠️ Basic PresenceTracker FSM | ❌ None | Large |
| Behavioral Analysis | ✅ 10+ behavior classifiers | ⚠️ Zone + loitering only | ❌ None | Large |
| Gait Recognition | ✅ Walking pattern biometric | ❌ None | ❌ None | Large |
| Floor Plan Map | ✅ Real-time dot visualization | ❌ Camera grid only | ❌ Camera grid only | Large |
| Situation Room | ✅ Unified command dashboard | ❌ Basic web UI | ⚠️ Better UI shell | Medium |
| Journey Playback | ✅ Full trail + recording | ⚠️ Event log exists | ❌ None | Medium |
| Multi-Layer Identity | ✅ Face + body + gait + soft | ✅ Face only | ⚠️ Face only | Large |

### Recommended Roadmap to Presidential-Level

```
Near-term (builds on existing FaceTracker features):
  ● Port FaceTracker AI to Tapo CCTV Desktop (Phases 1-3 of this doc)
  ● This alone gets you ~65% of the way

Medium-term (new capabilities):
  5.1 Cross-Camera Re-ID (OSNet-AIN)        — the BIGGEST unlock
  5.2 Spatial Topology Map                   — enables predictive tracking
  5.5 Behavioral Anomaly Detection (basics)  — loitering, running, time anomaly

Long-term (R&D / polish):
  5.3 Floor Plan Visualization               — situation awareness
  5.4 Multi-Layer Identity (gait)            — works when face isn't visible
  5.6 Situation Room Dashboard               — ties everything together
```

---

### 5.7 Intelligent PTZ Control & Auto-Tracking

**Current state**: Only CAM-2B (C246D telephoto) has PTZ. CAM-1 and CAM-3 (C212) are fixed.

**Presidential-level requirement**: **ALL cameras should have PTZ capability** for:
- **Auto-tracking**: Camera automatically follows detected persons
- **Preset patrol**: Automated patrol between preset positions
- **Threat response**: Snap to alert location instantly
- **Zoom-on-demand**: Operator clicks a detection → camera zooms to that person
- **Coordinated multi-camera**: When person exits CAM-1 FOV, CAM-3 pre-positions to intercept

---

#### 5.7.1 Hardware Upgrade Path

| Current Camera | Model | PTZ? | Recommended Upgrade |
|----------------|-------|------|---------------------|
| CAM-1 (Sala) | Tapo C212 | ❌ Fixed | → **Tapo C520WS** (2K PT, $50) |
| CAM-2A (Gate Wide) | C246D Lens 1 | ❌ Fixed | ✅ Keep (wide coverage) |
| CAM-2B (Gate Tele) | C246D Lens 2 | ✅ PT only | ✅ Keep (telephoto zoom) |
| CAM-3 (Garden) | Tapo C212 | ❌ Fixed | → **Tapo C520WS** (2K PT, $50) |

**Alternative**: If budget allows, upgrade all to **Tapo C510W** (3MP PT, better night vision, $60).

**Total upgrade cost**: ~$100-120 for 2 cameras (CAM-1 + CAM-3).

---

#### 5.7.2 Auto-Tracking Implementation

**What it does**: When a person is detected, the PTZ camera automatically pans/tilts to keep them centered in frame, and zooms in for better face capture.

**Algorithm** (simplified):
```python
def auto_track(camera_id: str, person_bbox: tuple):
    """
    person_bbox = (x1, y1, x2, y2) in frame coordinates
    frame_size = (width, height)
    """
    frame_w, frame_h = get_frame_size(camera_id)
    
    # Calculate person center
    person_cx = (person_bbox[0] + person_bbox[2]) / 2
    person_cy = (person_bbox[1] + person_bbox[3]) / 2
    
    # Calculate offset from frame center
    frame_cx = frame_w / 2
    frame_cy = frame_h / 2
    offset_x = person_cx - frame_cx
    offset_y = person_cy - frame_cy
    
    # Dead zone: don't move if person is near center (±10% of frame)
    dead_zone = 0.1
    if abs(offset_x) < frame_w * dead_zone and abs(offset_y) < frame_h * dead_zone:
        return  # Person is centered, no adjustment needed
    
    # Calculate pan/tilt adjustment (proportional control)
    pan_speed = int(offset_x / frame_w * 100)   # -100 to +100
    tilt_speed = int(-offset_y / frame_h * 100) # inverted Y axis
    
    # Send PTZ command
    ptz_move(camera_id, pan=pan_speed, tilt=tilt_speed, duration_ms=500)
    
    # Auto-zoom based on person size
    person_height = person_bbox[3] - person_bbox[1]
    if person_height < frame_h * 0.3:  # Person is small (far away)
        ptz_zoom_in(camera_id, steps=1)
    elif person_height > frame_h * 0.7:  # Person is too large (too close)
        ptz_zoom_out(camera_id, steps=1)
```

**Challenges**:
- **Latency**: PTZ movement takes 500-1000ms. Person may have moved by the time camera adjusts.
- **Oscillation**: Naive tracking can cause camera to "hunt" back and forth. Solution: PID controller + dead zone.
- **Multi-person**: Which person to track? Priority: unknown > known, closest to center > edge.
- **Smooth motion**: Discrete PTZ commands cause jerky movement. Solution: velocity-based control.

**FaceTracker gap**: ❌ No auto-tracking at all. PTZ is manual-only via Tapo API.

**Effort**: High (requires real-time control loop + PID tuning)

---

#### 5.7.3 Preset Patrol Mode

**What it does**: Camera automatically cycles through predefined preset positions (e.g., gate → driveway → street → repeat) when no active tracking is happening.

**Configuration**:
```python
PTZ_PRESETS = {
    "CAM-1": [
        {"name": "Living Room",  "preset_id": 1, "dwell_sec": 10},
        {"name": "Kitchen",      "preset_id": 2, "dwell_sec": 8},
        {"name": "Hallway",      "preset_id": 3, "dwell_sec": 5},
    ],
    "CAM-2B": [
        {"name": "Gate Center",  "preset_id": 1, "dwell_sec": 15},
        {"name": "Street Left",  "preset_id": 2, "dwell_sec": 10},
        {"name": "Street Right", "preset_id": 3, "dwell_sec": 10},
        {"name": "Driveway",     "preset_id": 4, "dwell_sec": 8},
    ],
    "CAM-3": [
        {"name": "Garden Path",  "preset_id": 1, "dwell_sec": 12},
        {"name": "Side Gate",    "preset_id": 2, "dwell_sec": 8},
        {"name": "Backyard",     "preset_id": 3, "dwell_sec": 10},
    ],
}

PATROL_MODE = "scheduled"  # "always", "scheduled", "manual"
PATROL_SCHEDULE = {
    "night": {"start": "22:00", "end": "06:00", "enabled": True},
    "day":   {"start": "06:00", "end": "22:00", "enabled": False},
}
```

**Behavior**:
- During patrol: cycle through presets, dwell at each for N seconds
- On detection: **interrupt patrol** → auto-track person → resume patrol after person leaves
- On alert: **pause patrol** → snap to alert position → wait for operator command

**UI**: Preset editor in Settings → PTZ tab (click on camera view to set preset position)

**Effort**: Medium

---

#### 5.7.4 Coordinated Multi-Camera PTZ

**What it does**: When a person is tracked across cameras (using Re-ID from 5.1), the next camera **pre-positions** to intercept them.

**Example scenario**:
```
1. Person detected at CAM-2A (gate, wide-angle)
2. Face recognized: "Unknown Male"
3. System predicts: person will reach CAM-3 (garden) in ~10 seconds
4. CAM-3 (PTZ) pre-positions to "Garden Path" preset
5. Person enters CAM-3 FOV → CAM-3 starts auto-tracking
6. CAM-2B (telephoto) zooms in on gate for high-res face capture
```

**Requires**:
- Spatial topology map (5.2) to know camera adjacency
- Cross-camera Re-ID (5.1) to know it's the same person
- PTZ on all cameras

**This is the "presidential" capability**: Seamless handoff with cameras pre-positioning ahead of the subject's path.

**Effort**: Very High (depends on 5.1 + 5.2)

---

#### 5.7.5 Zoom-on-Demand (Operator Control)

**What it does**: Security operator clicks on a person detection in the UI → camera instantly zooms to that person.

**UI flow**:
```
1. Operator sees bounding box on CAM-3 video
2. Right-click box → context menu: "Track This Person"
3. CAM-3 PTZ moves to center that person + zooms in
4. Tracking continues until operator clicks "Stop Tracking"
```

**Alternative**: Click on floor map dot (5.3) → nearest PTZ camera slews to that location.

**Effort**: Low (UI + PTZ command integration)

---

#### 5.7.6 PTZ API Abstraction Layer

**Current state**: Tapo API is used directly in `ptzHandlers.ts`. This is camera-specific.

**Better architecture**: Abstract PTZ interface so the system can support multiple camera brands:

```typescript
// src/main/services/PTZService.ts
interface PTZCapabilities {
  hasPan: boolean;
  hasTilt: boolean;
  hasZoom: boolean;
  hasPresets: boolean;
  maxPresets: number;
  panRange: [number, number];   // degrees
  tiltRange: [number, number];  // degrees
  zoomRange: [number, number];  // optical zoom levels
}

abstract class PTZController {
  abstract move(direction: PTZDirection, speed: number): Promise<void>;
  abstract stop(): Promise<void>;
  abstract gotoPreset(presetId: number): Promise<void>;
  abstract setPreset(presetId: number, name: string): Promise<void>;
  abstract getPosition(): Promise<PTZPosition>;
  abstract getCapabilities(): PTZCapabilities;
}

class TapoPTZController extends PTZController {
  // Tapo-specific implementation using TapoAPI
}

class OnvifPTZController extends PTZController {
  // Generic ONVIF implementation (works with most IP cameras)
}

class HikvisionPTZController extends PTZController {
  // Hikvision-specific (if needed for advanced features)
}
```

**Why this matters**: If you upgrade to non-Tapo cameras in the future (e.g., Hikvision, Dahua, Axis), you just write a new controller class instead of rewriting the entire PTZ system.

**Effort**: Medium (refactoring)

---

#### 5.7.7 PTZ Calibration & Field-of-View Mapping

**What it does**: The system learns the relationship between PTZ position (pan/tilt/zoom) and the physical area being viewed.

**Why it's needed**: For coordinated multi-camera (5.7.4) to work, the system must know:
- "If I pan CAM-3 to preset 2, what physical area am I looking at?"
- "Person is at (x, y) on the floor plan — what PTZ position points there?"

**Calibration process**:
1. Place a marker (e.g., colored cone) at known floor plan coordinates
2. Manually move camera to center the marker
3. Record PTZ position + floor plan coordinates
4. Repeat for 5-10 points across the camera's coverage area
5. System builds a transformation matrix: `(pan, tilt, zoom) ↔ (floor_x, floor_y)`

**Advanced**: Use SLAM (Simultaneous Localization and Mapping) to auto-calibrate by tracking people across cameras.

**Effort**: Very High (R&D level)

---

### PTZ Feature Priority Ranking

| Feature | Impact | Effort | Priority | Depends On |
|---------|--------|--------|----------|------------|
| 5.7.5 Zoom-on-Demand | High | Low | **P0** | None |
| 5.7.3 Preset Patrol | High | Medium | **P1** | None |
| 5.7.6 PTZ Abstraction | Medium | Medium | **P1** | None |
| 5.7.2 Auto-Tracking | Very High | High | **P2** | YOLO (2.1) |
| 5.7.4 Coordinated Multi-Cam | Very High | Very High | **P3** | Re-ID (5.1), Topology (5.2) |
| 5.7.7 PTZ Calibration | Medium | Very High | **P4** | Floor Plan (5.3) |

**Recommendation**: Start with **Zoom-on-Demand** (immediate operator value) and **Preset Patrol** (autonomous coverage). Auto-tracking requires YOLO first. Coordinated multi-camera is the end goal but needs the full Re-ID + topology stack.

---

### The Single Most Important Feature

**Cross-Camera Re-ID (5.1)** is the dividing line between "a collection of independent
cameras" and "a unified surveillance system." Without it, each camera is an island.
With it, you have continuous tracking of subjects across your entire property — which
is the core capability of presidential-level security.

**PTZ on all cameras (5.7)** is the second critical requirement — it transforms passive observation into active pursuit.
