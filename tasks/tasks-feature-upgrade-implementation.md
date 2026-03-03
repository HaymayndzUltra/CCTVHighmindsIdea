# Technical Task Plan: FaceTracker AI Features → Tapo CCTV Desktop

> **Source**: `docs/feature-upgrade-analysis.md`
> **Objective**: Port intelligent AI features from FaceTracker (GuardianAI) to Tapo CCTV Desktop
> **Recommended Model**: Claude 3.5 Sonnet (complex AI/ML integration)
> **Execution Mode**: Focus Mode (validate after each parent task)

---

## Phase 1: Foundation Fixes (CRITICAL) — 1-2 days

> **Context**: These are prerequisites for all AI features. Must be completed first.

### [ ] Task 1.1: Fix CUDA/GPU Acceleration
**Priority**: P0 (CRITICAL)  
**Effort**: Low  
**Impact**: 5-10x inference speedup

**Objective**: Enable GPU acceleration for ONNX Runtime to utilize RTX 4090.

**Sub-tasks**:
- [ ] 1.1.1: Diagnose CUDA library mismatch
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Verify installed CUDA version: `nvidia-smi`
  - Check ONNX Runtime GPU provider availability
  - Identify missing `cublasLt64_12.dll` dependency

- [ ] 1.1.2: Install matching CUDA toolkit
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Install CUDA 12.x toolkit matching ONNX Runtime requirements
  - Install cuDNN 8.x for CUDA 12
  - Update PATH environment variables

- [ ] 1.1.3: Update python-sidecar dependencies
  - [APPLIES RULES: 3-code-quality-checklist.md, 5-documentation-context-integrity.md]
  - Pin `onnxruntime-gpu` to compatible version
  - Update `requirements.txt` with CUDA dependencies
  - Test GPU provider initialization in `services/face_detection.py`

- [ ] 1.1.4: Verify GPU acceleration
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add GPU provider logging to FastAPI startup
  - Run benchmark: CPU vs GPU inference time
  - Document GPU requirements in `python-sidecar/README.md`

---

### [ ] Task 1.2: Separate AI Stream (Sub-Stream) from Display Stream
**Priority**: P0 (CRITICAL)  
**Effort**: Medium  
**Impact**: 4x reduction in AI processing load

**Objective**: Send 720p sub-stream to AI, keep 1080p main stream for display.

**Sub-tasks**:
- [ ] 1.2.1: Add sub-stream configuration
  - [APPLIES RULES: 3-code-quality-checklist.md, 5-documentation-context-integrity.md]
  - Extend `CameraConfig` interface to include `aiStreamUrl` (sub-stream)
  - Update `config.py` with sub-stream URLs for all cameras
  - Document stream separation architecture in README

- [ ] 1.2.2: Modify StreamManager for dual streams
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Create separate FFmpeg processes: one for display, one for AI
  - Route sub-stream frames to python-sidecar
  - Keep main stream for renderer display
  - Add stream health monitoring

- [ ] 1.2.3: Update python-sidecar frame receiver
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Accept 720p frames (1280×720 RGB24)
  - Update frame size constants in detection services
  - Verify face detection accuracy on 720p vs 1080p

- [ ] 1.2.4: Performance validation
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Measure CPU/GPU usage before and after
  - Verify detection accuracy maintained
  - Document bandwidth savings

---

## Phase 2: Core AI Features (HIGH) — 3-5 days

> **Context**: Port FaceTracker's intelligent detection and tracking capabilities.

### [ ] Task 2.1: YOLOv8s Object Detection + ByteTrack Tracking
**Priority**: P1 (HIGH)  
**Effort**: Medium-High  
**Impact**: Real object tracking with persistent IDs

**Objective**: Replace pixel-diff motion with YOLO object detection and multi-object tracking.

**Sub-tasks**:
- [ ] 2.1.1: Add YOLOv8s to python-sidecar
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add `ultralytics` to `requirements.txt`
  - Download YOLOv8s model weights to `models/`
  - Create `services/object_detector.py` (port from FaceTracker `ai/object_detector.py`)

- [ ] 2.1.2: Implement ByteTrack tracker
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add `lap` (Linear Assignment Problem) to requirements
  - Create `services/tracker.py` (port from FaceTracker `ai/tracker.py`)
  - Maintain per-camera ByteTrack state

- [ ] 2.1.3: Create /detect_objects endpoint
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - New FastAPI endpoint: `POST /detect_objects`
  - Input: camera_id + frame (base64 or binary)
  - Output: list of tracked objects with IDs, classes, bboxes
  - Share YOLO model across cameras (singleton pattern)

- [ ] 2.1.4: Integrate with detection pipeline
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Update `src/main/services/DetectionPipeline.ts`
  - Call `/detect_objects` before face detection
  - Only run face recognition on person-class detections
  - Store track IDs in detection events

- [ ] 2.1.5: Update renderer to display tracked objects
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Draw bounding boxes with track IDs on canvas
  - Color-code by class (person: green, vehicle: blue, animal: yellow)
  - Show track trail (last 10 positions)

---

### [ ] Task 2.2: Face Quality Gate
**Priority**: P1 (HIGH)  
**Effort**: Medium  
**Impact**: Eliminate false alerts from poor-quality faces

**Objective**: Only alert on clear, front-facing, sharp faces.

**Sub-tasks**:
- [ ] 2.2.1: Add quality scoring to face detection
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Port quality checks from FaceTracker `ai/face_engine.py`
  - Implement: yaw/pitch angle check, blur detection (Laplacian), confidence threshold
  - Add quality score to `/detect` endpoint response

- [ ] 2.2.2: Implement weighted voting system
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Require N consecutive high-quality recognitions before alert
  - Weighted voting: higher similarity = higher vote weight
  - Add `FACE_CONFIRM_FRAMES` config (default: 3)

- [ ] 2.2.3: Add embedding temporal smoothing
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Exponential moving average (EMA) of embeddings
  - Config: `FACE_EMBEDDING_EMA_ALPHA = 0.4`
  - Reduces jitter in recognition results

- [ ] 2.2.4: Update alert logic
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Only trigger alerts after quality gate passes
  - Log rejected detections (quality too low) for debugging
  - Add quality metrics to Telegram alerts

---

### [ ] Task 2.3: Night Vision Enhancement (CLAHE)
**Priority**: P2 (MEDIUM)  
**Effort**: Low  
**Impact**: Better night detection accuracy

**Objective**: Apply CLAHE preprocessing to low-light frames.

**Sub-tasks**:
- [ ] 2.3.1: Implement CLAHE preprocessing
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add OpenCV CLAHE to `services/face_detection.py`
  - Detect low luminance: `mean(frame) < 80`
  - Apply CLAHE before InsightFace inference

- [ ] 2.3.2: Add configuration
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Config: `FACE_NIGHT_ENHANCE = True`
  - Config: `FACE_LOW_LUM_THRESHOLD = 80.0`
  - Make it toggleable per camera

- [ ] 2.3.3: Validate night performance
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Test with night footage from cameras
  - Compare detection rates with/without CLAHE
  - Document in README

---

### [ ] Task 2.4: Auto-Enrollment (Runtime Augmentation)
**Priority**: P2 (MEDIUM)  
**Effort**: Medium  
**Impact**: Self-improving recognition over time

**Objective**: Automatically capture new reference embeddings for known persons.

**Sub-tasks**:
- [ ] 2.4.1: Design auto-enrollment database schema
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add `auto_enrolled` flag to embeddings table
  - Add `enrollment_timestamp` and `expiry_date` columns
  - Add `quality_score` column

- [ ] 2.4.2: Implement auto-enrollment logic
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Trigger: high-confidence match (similarity > 0.55) + high quality (> 80)
  - Limit: max 5 auto-enrolled samples per person
  - Store new embedding with metadata

- [ ] 2.4.3: Add expiry mechanism
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Config: `AUTO_ENROLL_EXPIRY_DAYS = 30`
  - Periodic cleanup job: delete expired auto-enrollments
  - Keep manual enrollments forever

- [ ] 2.4.4: Update enrollment UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Show auto-enrolled samples in person profile
  - Allow user to promote/delete auto-enrollments
  - Display enrollment source (manual vs auto)

---

### [ ] Task 2.5: Negative Gallery
**Priority**: P2 (MEDIUM)  
**Effort**: Low  
**Impact**: Reject known false positives

**Objective**: Store false positive face crops to actively reject bad matches.

**Sub-tasks**:
- [ ] 2.5.1: Create negative gallery database
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - New table: `negative_embeddings` (person_id, embedding, crop_path)
  - Store rejected face crops in `data/negative_gallery/`

- [ ] 2.5.2: Add negative matching to recognition
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Before positive match, check against negative gallery
  - If similarity to negative > threshold → reject match
  - Log rejection reason

- [ ] 2.5.3: Add UI for negative gallery management
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Button on false alerts: "Add to Negative Gallery"
  - Show negative samples in person profile
  - Allow deletion of negative samples

---

## Phase 3: Intelligence Layer (HIGH) — 3-5 days

> **Context**: Port FaceTracker's high-level intelligence features.

### [ ] Task 3.1: Zone Detection System
**Priority**: P1 (HIGH)  
**Effort**: High  
**Impact**: Spatial awareness and rule-based alerts

**Objective**: Define polygon zones with different behaviors (RESTRICTED, MONITORED, COUNTING, TRIPWIRE).

**Sub-tasks**:
- [ ] 3.1.1: Design zone database schema
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Table: `zones` (camera_id, name, type, polygon_points, config)
  - Zone types: RESTRICTED, MONITORED, COUNTING, TRIPWIRE
  - Store polygon as JSON array of [x, y] points

- [ ] 3.1.2: Implement zone detection logic
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Port from FaceTracker `ai/zone_detector.py`
  - Point-in-polygon algorithm (ray casting)
  - Line crossing detection for tripwires
  - Create `services/zone_detector.py`

- [ ] 3.1.3: Create zone editor UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Overlay canvas on camera tile
  - Draw polygon by clicking points
  - Edit/delete existing zones
  - Zone configuration panel (type, name, rules)

- [ ] 3.1.4: Integrate with detection pipeline
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Check each tracked object against zones
  - Generate zone events (entry, exit, violation)
  - Store zone events in database

- [ ] 3.1.5: Add zone-based alerts
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - RESTRICTED zone: alert on any entry
  - MONITORED zone: log all activity
  - COUNTING zone: count entries/exits
  - TRIPWIRE: directional crossing alerts

---

### [ ] Task 3.2: Loitering Detection
**Priority**: P2 (MEDIUM)  
**Effort**: Medium  
**Impact**: Detect suspicious lingering behavior

**Objective**: Alert when a person stays in a zone longer than threshold.

**Sub-tasks**:
- [ ] 3.2.1: Implement loitering tracker
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Track time-in-zone per track ID
  - Config: `LOITERING_THRESHOLD_SECONDS = 15`
  - Config: `LOITERING_MIN_MOVEMENT_RADIUS = 80.0` (pixels)

- [ ] 3.2.2: Add loitering detection logic
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Trigger alert when threshold exceeded
  - Cooldown period: `LOITERING_COOLDOWN_SECONDS = 180`
  - Verify person stayed within radius (not just passing through)

- [ ] 3.2.3: Add loitering alerts
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Generate loitering event with duration
  - Send Telegram alert with snapshot
  - Show loitering status in UI

---

### [ ] Task 3.3: Cross-Camera Journey Tracking
**Priority**: P2 (MEDIUM)  
**Effort**: Medium  
**Impact**: Track person movement across cameras

**Objective**: Track a person's journey across multiple cameras using face recognition.

**Sub-tasks**:
- [ ] 3.3.1: Design journey database schema
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Table: `journeys` (person_id, start_time, end_time, path)
  - Table: `journey_checkpoints` (journey_id, camera_id, timestamp)

- [ ] 3.3.2: Implement journey tracker
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Port from FaceTracker `intelligence/journey_tracker.py`
  - Start journey on first detection
  - Update journey on subsequent camera detections
  - Close journey after timeout (no detection for N minutes)

- [ ] 3.3.3: Add journey visualization
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Timeline view: show person's path across cameras
  - Display: "Angelo: Gate → Garden → House in 45s"
  - Click to view snapshots at each checkpoint

---

### [ ] Task 3.4: Presence Tracking (HOME/AWAY States)
**Priority**: P2 (MEDIUM)  
**Effort**: Medium  
**Impact**: Track occupancy state per person

**Objective**: Maintain presence state per known person (HOME, AWAY, ARRIVING, DEPARTING, AT_GATE).

**Sub-tasks**:
- [ ] 3.4.1: Design presence state machine
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - States: HOME, AWAY, AT_GATE, ARRIVING, DEPARTING
  - Transitions based on camera detections and time
  - Port from FaceTracker `intelligence/presence_tracker.py`

- [ ] 3.4.2: Implement presence tracker
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Track last_seen timestamp per person
  - Auto-transition to AWAY after timeout (30 minutes)
  - Detect ARRIVING/DEPARTING based on gate camera

- [ ] 3.4.3: Add presence UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Dashboard widget: show who's HOME/AWAY
  - Presence timeline: visualize state changes over time
  - Presence alerts: notify on state changes

---

### [ ] Task 3.5: Tele Burst Capture
**Priority**: P3 (LOW)  
**Effort**: Medium  
**Impact**: Better face quality from telephoto lens

**Objective**: When CAM-2A detects person, trigger burst capture from CAM-2B (telephoto).

**Sub-tasks**:
- [ ] 3.5.1: Implement burst capture logic
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Port from FaceTracker `ai/tele_burst_capture.py`
  - On CAM-2A detection → trigger CAM-2B capture
  - Capture 5-10 frames from telephoto
  - Select best quality frame

- [ ] 3.5.2: Integrate with alert system
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Use telephoto frame for Telegram alerts
  - Fallback to wide-angle if telephoto unavailable
  - Log burst capture success/failure

---

### [ ] Task 3.6: Camera Group Deduplication
**Priority**: P3 (LOW)  
**Effort**: Low  
**Impact**: Prevent duplicate alerts from camera groups

**Objective**: Suppress duplicate alerts when multiple cameras see the same person.

**Sub-tasks**:
- [ ] 3.6.1: Add camera group configuration
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Config: `CAMERA_GROUPS = [["CAM-2A", "CAM-2B"]]`
  - Group cameras watching same area

- [ ] 3.6.2: Implement deduplication logic
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Within a group, only send one alert per person per time window
  - Prefer higher-quality detection (better face angle/clarity)
  - Log suppressed alerts

---

## Phase 4: Advanced Features (MEDIUM) — 5-10 days

> **Context**: Features beyond FaceTracker's current capabilities.

### [ ] Task 4.1: Real-Time Bounding Box Overlay
**Priority**: P2 (MEDIUM)  
**Effort**: Medium  
**Impact**: Interactive detection visualization

**Objective**: Draw detection boxes, track trails, and labels on canvas in renderer.

**Sub-tasks**:
- [ ] 4.1.1: Stream detection coordinates to renderer
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - IPC channel: main → renderer with detection data
  - Send: track_id, bbox, class, confidence, person_name
  - Update rate: 10-15 FPS (not every frame)

- [ ] 4.1.2: Implement canvas overlay system
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - SVG/Canvas layer on top of video canvas
  - Draw bounding boxes with labels
  - Color-code by recognition status (known: green, unknown: red)

- [ ] 4.1.3: Add track trail visualization
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Store last 10 positions per track
  - Draw trail as fading line
  - Smooth interpolation between positions

- [ ] 4.1.4: Add interactive features
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Click box → enroll person
  - Right-click box → add to negative gallery
  - Hover → show detailed info

---

### [ ] Task 4.2: WebRTC Streaming (Replace Raw IPC)
**Priority**: P1 (HIGH)  
**Effort**: Medium-High  
**Impact**: 100x less IPC bandwidth, hardware decode

**Objective**: Replace raw RGB24 IPC with WebRTC streaming from go2rtc.

**Sub-tasks**:
- [ ] 4.2.1: Configure go2rtc WebRTC endpoints
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Enable WebRTC in go2rtc config
  - Generate WebRTC offer/answer for each camera
  - Handle ICE candidates

- [ ] 4.2.2: Implement WebRTC client in renderer
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Use RTCPeerConnection API
  - Replace canvas rendering with <video> element
  - Handle connection state changes

- [ ] 4.2.3: Keep AI pipeline separate
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - AI sidecar still processes sub-stream via FFmpeg
  - Display uses WebRTC (main stream)
  - Ensure both pipelines run independently

- [ ] 4.2.4: Validate performance
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Measure IPC bandwidth reduction
  - Verify latency < 100ms
  - Test with all 4 cameras simultaneously

---

### [ ] Task 4.3: DVR/NVR Recording with Timeline
**Priority**: P3 (LOW)  
**Effort**: High  
**Impact**: Continuous recording and playback

**Objective**: 24/7 recording with event-tagged timeline scrubber.

**Sub-tasks**:
- [ ] 4.3.1: Configure go2rtc recording
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Enable HLS/MP4 recording in go2rtc
  - Configure storage path and retention policy
  - Segment recordings (1-hour chunks)

- [ ] 4.3.2: Implement recording manager
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Track recording files per camera
  - Handle disk space management
  - Auto-delete old recordings based on policy

- [ ] 4.3.3: Build timeline UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Timeline scrubber with event markers
  - Click event → jump to timestamp
  - Playback controls (play, pause, speed)

- [ ] 4.3.4: Add event tagging
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Tag recordings with detection events
  - Filter timeline by event type
  - Export clips around events

---

### [ ] Task 4.4: Analytics Dashboard
**Priority**: P3 (LOW)  
**Effort**: High  
**Impact**: Visual insights into security data

**Objective**: Dashboard with heatmaps, activity graphs, presence timelines.

**Sub-tasks**:
- [ ] 4.4.1: Design analytics database schema
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Aggregate detection events by hour/day
  - Store zone traffic counts
  - Track person presence duration

- [ ] 4.4.2: Implement analytics queries
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Detections per hour/day
  - Zone entry/exit counts
  - Person presence timeline
  - Heatmap data (detection density)

- [ ] 4.4.3: Build analytics UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - New "Analytics" screen in sidebar
  - Charts: recharts or nivo
  - Heatmap overlay on camera view
  - Date range selector

---

### [ ] Task 4.5: LLM-Powered Daily Reports
**Priority**: P3 (LOW)  
**Effort**: Medium  
**Impact**: AI-generated security summaries

**Objective**: Generate natural language daily security reports.

**Sub-tasks**:
- [ ] 4.5.1: Implement report generator
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Port from FaceTracker `intelligence/daily_report.py`
  - Aggregate day's events
  - Generate structured summary

- [ ] 4.5.2: Integrate LLM (Ollama or OpenAI)
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Use local LLM (Ollama) for privacy
  - Fallback to OpenAI API if configured
  - Prompt engineering for security reports

- [ ] 4.5.3: Add report UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Daily report view
  - Email/Telegram delivery option
  - Report history archive

---

### [ ] Task 4.6: Liveness Detection (Anti-Spoofing)
**Priority**: P3 (LOW)  
**Effort**: Medium  
**Impact**: Prevent photo/screen spoofing

**Objective**: Detect if face is from real person or photo/screen.

**Sub-tasks**:
- [ ] 4.6.1: Integrate anti-spoofing model
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Use MiniFASNet (Silent-Face-Anti-Spoofing)
  - Add to python-sidecar models
  - Run on face crops before recognition

- [ ] 4.6.2: Add liveness scoring
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Output: real vs spoof confidence
  - Threshold: reject if spoof confidence > 0.7
  - Log liveness results

- [ ] 4.6.3: Update UI with liveness status
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Show liveness indicator on detections
  - Alert on spoofing attempts
  - Store liveness score in database

---

### [ ] Task 4.7: Sound Event Detection
**Priority**: P3 (LOW)  
**Effort**: High  
**Impact**: Audio-based threat detection

**Objective**: Analyze camera audio for glass breaking, gunshots, screaming, etc.

**Sub-tasks**:
- [ ] 4.7.1: Extract audio from camera streams
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Use FFmpeg to extract audio track
  - Resample to 16kHz mono
  - Buffer audio in 1-second chunks

- [ ] 4.7.2: Integrate YAMNet audio classifier
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Add TensorFlow/ONNX YAMNet model
  - Classify audio events
  - Filter for security-relevant sounds

- [ ] 4.7.3: Add audio event alerts
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Alert on: glass breaking, gunshots, screaming
  - Log all audio events
  - Audio event timeline in UI

---

### [ ] Task 4.8: Adaptive Per-Person Thresholds
**Priority**: P3 (LOW)  
**Effort**: Low-Medium  
**Impact**: Improved recognition accuracy

**Objective**: Dynamically adjust similarity threshold per person.

**Sub-tasks**:
- [ ] 4.8.1: Analyze enrollment quality
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Compute embedding clustering metrics
  - Calculate intra-person variance
  - Determine optimal threshold per person

- [ ] 4.8.2: Implement adaptive thresholds
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Store per-person threshold in database
  - Update threshold based on runtime performance
  - Bounds: `FACE_MIN_THRESHOLD = 0.45`, `FACE_MAX_THRESHOLD = 0.65`

- [ ] 4.8.3: Add threshold tuning UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Show current threshold in person profile
  - Allow manual threshold adjustment
  - Display recognition confidence distribution

---

## Phase 5: Presidential-Level Surveillance (FUTURE/R&D) — 10+ days

> **Context**: Advanced features for seamless cross-camera tracking.

### [ ] Task 5.1: Cross-Camera Person Re-Identification (Re-ID)
**Priority**: P1 (CRITICAL for Phase 5)  
**Effort**: High  
**Impact**: Global tracking across all cameras

**Objective**: Track same person across cameras even without visible face.

**Sub-tasks**:
- [ ] 5.1.1: Integrate OSNet-AIN Re-ID model
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Download OSNet-AIN ONNX model
  - Add to python-sidecar `models/`
  - Create `services/reid.py`

- [ ] 5.1.2: Extract body appearance embeddings
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - On YOLO person detection → crop full body
  - Compute Re-ID embedding (512-dim vector)
  - Store in short-term gallery (5 minutes)

- [ ] 5.1.3: Implement cross-camera matching
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Match new person against Re-ID gallery
  - Assign global_person_id across cameras
  - Fuse with face embedding (weighted: face 0.7 + body 0.3)

- [ ] 5.1.4: Update tracking to use global IDs
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Replace per-camera track IDs with global IDs
  - Maintain track continuity across cameras
  - Handle track merging/splitting

---

### [ ] Task 5.2: Spatial Topology Map
**Priority**: P2 (HIGH for Phase 5)  
**Effort**: Medium  
**Impact**: Predictive tracking and anomaly detection

**Objective**: Define camera connectivity graph with transit times.

**Sub-tasks**:
- [ ] 5.2.1: Design topology configuration
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Config: `CAMERA_TOPOLOGY` with edges and transit times
  - Example: CAM-2A → CAM-3 (8-20 seconds)
  - Direction: inbound vs outbound

- [ ] 5.2.2: Implement topology-aware tracking
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Predict next camera based on current position
  - Alert on topology violations (unexpected appearance)
  - Detect disappearances (person missing > timeout)

- [ ] 5.2.3: Add predictive handoff
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Pre-warm next camera recording
  - Pre-position PTZ cameras (if available)
  - Notify operator of expected arrival

---

### [ ] Task 5.3: Floor Plan Real-Time Visualization
**Priority**: P2 (MEDIUM for Phase 5)  
**Effort**: High  
**Impact**: Situational awareness

**Objective**: Overhead map with real-time person positions.

**Sub-tasks**:
- [ ] 5.3.1: Create floor plan editor
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Upload floor plan image
  - Place camera icons at physical positions
  - Define camera FOV coverage areas

- [ ] 5.3.2: Map detections to floor plan coordinates
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Convert bbox position to approximate (x, y) on floor plan
  - Use camera position + FOV + bbox location
  - Interpolate position between cameras

- [ ] 5.3.3: Build real-time floor map UI
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - Canvas/SVG rendering
  - Animated dots for tracked persons
  - Color-code: known (green), unknown (red), unidentified (blue)
  - Show movement trails (last 5 minutes)

---

### [ ] Task 5.4: Multi-Layer Identity Confirmation
**Priority**: P3 (LOW for Phase 5)  
**Effort**: Very High  
**Impact**: Identity confirmation without visible face

**Objective**: Combine face + body Re-ID + gait + soft biometrics.

**Sub-tasks**:
- [ ] 5.4.1: Integrate gait recognition model
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Research: GaitSet, GaitGL, or OpenGait
  - Requires temporal sequence (2+ seconds of walking)
  - Add to python-sidecar

- [ ] 5.4.2: Implement soft biometrics
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Estimate height from bbox + camera calibration
  - Extract clothing color histogram
  - Hair color/length from head region

- [ ] 5.4.3: Implement multi-layer fusion
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Weighted fusion: face (0.7) + body (0.2) + gait (0.1)
  - Fallback layers when primary unavailable
  - Confidence scoring per layer

---

### [ ] Task 5.5: Behavioral Anomaly Detection
**Priority**: P2 (MEDIUM for Phase 5)  
**Effort**: Medium to High  
**Impact**: Detect suspicious behavior patterns

**Objective**: Detect loitering, running, pacing, tailgating, etc.

**Sub-tasks**:
- [ ] 5.5.1: Implement velocity-based detection
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Calculate track velocity (pixels/second)
  - Detect running: velocity > threshold
  - Detect stationary: velocity < threshold

- [ ] 5.5.2: Implement trajectory analysis
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Detect pacing: repeated loops in trajectory
  - Detect circling: trajectory forms circle
  - Detect wrong direction: movement against expected flow

- [ ] 5.5.3: Implement time anomaly detection
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Flag activity at unusual hours (e.g., 3 AM)
  - Learn normal activity patterns per zone
  - Alert on deviations

- [ ] 5.5.4: Implement tailgating detection
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Detect two persons entering zone within <2 seconds
  - Requires ByteTrack + Zones
  - Alert on unauthorized following

---

### [ ] Task 5.6: Situation Room Command Dashboard
**Priority**: P3 (LOW for Phase 5)  
**Effort**: Very High  
**Impact**: Unified operator interface

**Objective**: War room view combining all intelligence.

**Sub-tasks**:
- [ ] 5.6.1: Design dashboard layout
  - [APPLIES RULES: 3-code-quality-checklist.md, common-rule-ui-foundation-design-system.md]
  - 4-panel layout: Alerts, Floor Map, Active Feed, Timeline
  - Person status panel
  - Event timeline with playback

- [ ] 5.6.2: Implement alert aggregation
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Real-time alert feed (top panel)
  - Priority-based sorting (critical, high, medium, low)
  - Click alert → jump to camera/recording

- [ ] 5.6.3: Implement interactive floor map
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Click dot → show person details + camera feed
  - Click camera → show live feed
  - Show movement trails

- [ ] 5.6.4: Implement person status panel
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - List all known persons with presence state
  - Last seen timestamp and location
  - Click person → show journey history

---

### [ ] Task 5.7: Intelligent PTZ Control & Auto-Tracking
**Priority**: P2 (MEDIUM for Phase 5)  
**Effort**: High to Very High  
**Impact**: Active pursuit of subjects

**Sub-tasks**:
- [ ] 5.7.1: Implement zoom-on-demand
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Right-click detection → "Track This Person"
  - PTZ moves to center + zoom
  - Stop tracking on user command

- [ ] 5.7.2: Implement preset patrol mode
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Define presets with dwell times
  - Cycle through presets automatically
  - Interrupt on detection → resume after

- [ ] 5.7.3: Implement auto-tracking
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - PID controller for smooth tracking
  - Dead zone to prevent oscillation
  - Auto-zoom based on person size

- [ ] 5.7.4: Implement coordinated multi-camera PTZ
  - [APPLIES RULES: 3-code-quality-checklist.md]
  - Pre-position next camera based on topology
  - Seamless handoff between cameras
  - Requires Re-ID (5.1) + Topology (5.2)

- [ ] 5.7.5: Create PTZ abstraction layer
  - [APPLIES RULES: 3-code-quality-checklist.md, 4-code-modification-safety-protocol.md]
  - Abstract PTZ interface for multiple brands
  - Implement TapoPTZController
  - Support for ONVIF, Hikvision, etc.

---

## Execution Notes

**Recommended Execution Order**:
1. Phase 1 (Foundation) — MUST complete first
2. Phase 2 (Core AI) — High value, enables everything else
3. Phase 3 (Intelligence) — Builds on Phase 2
4. Phase 4 (Advanced) — Parallel with Phase 3 (independent features)
5. Phase 5 (Presidential) — Long-term R&D

**Quality Gates**:
- After each parent task: Run `/review` workflow
- Address CRITICAL/HIGH priority issues before proceeding
- Run `/retro` after each phase completion

**Context Management**:
- Start new chat session for each parent task (recommended)
- Or use context preservation after 3-5 sub-tasks

**Model Recommendations**:
- Phase 1-2: Claude 3.5 Sonnet (complex AI/ML)
- Phase 3-4: Claude 3.5 Sonnet or GPT-4
- Phase 5: Claude 3.5 Sonnet (R&D level complexity)

---

**Total Estimated Effort**: 22-42 days (depending on scope and depth)
**Critical Path**: Phase 1 → Phase 2.1 (YOLO) → Phase 5.1 (Re-ID)
**Highest Impact**: Task 1.1 (GPU), Task 2.1 (YOLO), Task 5.1 (Re-ID)
