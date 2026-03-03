# Technical Execution Plan: Tapo CCTV Desktop v2.0 — Presidential-Level Upgrade

Based on PRD: `docs/prd-tapo-cctv-desktop-v2.md`

> **Note on AI Model Strategy:** Recommended personas for each phase:
> * **Architect (Claude Opus 4.5 / Sonnet 4.5):** Complex multi-file refactoring, architectural decisions, service orchestration, cross-layer integration. Best for Phases 1-3 and cross-cutting tasks.
> * **Algorithm Specialist (GPT-5.2):** Mathematical/algorithmic code — PID controllers, embedding distance calculations, gait analysis, Re-ID matching, topology graph algorithms. Best for Phase 5.
> * **Implementer (DeepSeek V3.2):** Straightforward CRUD, schema migrations, UI components, API endpoints, configuration. Cost-efficient for Phase 4 UI work.

---

## Existing Codebase Inventory

### Renderer (React + TypeScript)
- **Screens (4):** Dashboard, CameraFullscreenView, EventLog, PersonDirectory, Settings
- **Components (15):** CameraGrid, CameraTile, ConfirmDeleteModal, EnrollmentModal, EventDetail, EventTable, FaceDetectionOverlay, FilterBar, LayoutSelector, LineCrossingOverlay, MiniPTZ, PTZControls, PersonDetail, PersonList, StatusBar, Sidebar
- **Hooks:** useStreamFrame
- **Navigation:** Sidebar with 4 items (dashboard, event-log, person-directory, settings)

### Main Process (TypeScript)
- **Services (11):** AIBridgeService, CryptoService, DatabaseService, DetectionPipeline, EventProcessor, Go2RtcService, MotionDetector, ProcessManager, StreamManager, TapoAPIService, TelegramService
- **IPC Handlers (9):** aiHandlers, cameraHandlers, eventHandlers, lineHandlers, personHandlers, ptzHandlers, settingsHandlers, streamHandlers, telegramHandlers

### Python Sidecar (FastAPI)
- **Routers (6):** config_router, detection, enrollment, health, persons, recognition
- **Services (4):** enrollment, face_detection, face_recognition, model_loader

### Reuse Candidates (Duplicate Prevention)
- `FaceDetectionOverlay` → extend into `DetectionOverlay` (add YOLO boxes, track trails, interactive actions)
- `LineCrossingOverlay` → partially reusable for zone/tripwire drawing in `ZoneEditorOverlay`
- `PTZControls` → enhance with auto-track toggle, patrol toggle
- `FilterBar` → extend with new event types, behaviors, zones
- `StatusBar` → extend with GPU info, recording status
- `Settings` → add new tabs (existing tab architecture reusable)

---

## Implementation Layers

| Layer | Role | Impact |
|-------|------|--------|
| **Python AI Sidecar** | PRIMARY — heaviest new code (YOLO, ByteTrack, Re-ID, gait, liveness, sound, LLM) | ~60% of new code |
| **Electron Main Process** | SECONDARY — new services, IPC handlers, orchestration | ~25% of new code |
| **Electron Renderer** | SECONDARY — new screens, enhanced components | ~10% of new code |
| **SQLite** | SECONDARY — schema expansion | ~5% of new code |

---

## Git Branch Proposal

> **Suggested branch:** `feature/v2-presidential-upgrade`
> Create from `main` before starting. Each phase can be merged as a stable milestone.

---

## High-Level Task List

### Phase 1 — Foundation (CRITICAL)

- [x] **1.0 Database Schema v2.0 Migration + Shared Types** [COMPLEXITY: Complex] [DEPENDS ON: none]
> **WHY:** Every subsequent task depends on the expanded schema and TypeScript types. Doing this first prevents constant schema conflicts and enables parallel development across all layers.

- [x] **2.0 Fix CUDA/GPU Acceleration** [COMPLEXITY: Simple] [DEPENDS ON: none]
> **WHY:** GPU is broken. Without this, all AI inference runs 5-10x slower on CPU, making real-time 4-camera processing impossible. This is the #1 blocker for every AI feature.

- [x] **3.0 Dual-Stream Architecture + go2rtc Reconfiguration** [COMPLEXITY: Complex] [DEPENDS ON: 2.0]
> **WHY:** Current pipeline sends full 1080p (6.2MB/frame) to AI. Dual-stream separates display (1080p→WebRTC) from AI (720p→FFmpeg), reducing AI bandwidth by 4x and enabling 4 simultaneous camera processing.

### Phase 2 — Core AI

- [ ] **4.0 YOLO + ByteTrack Object Detection & Tracking** [COMPLEXITY: Complex] [DEPENDS ON: 2.0, 3.0]
> **WHY:** Replaces unreliable pixel-diff motion detection with real object detection. Persistent track IDs eliminate duplicate alerts and enable all downstream intelligence (zones, journeys, behaviors). This is the backbone of the entire upgrade.

- [ ] **5.0 Face Pipeline Enhancement (Quality Gate + CLAHE + Adaptive Thresholds)** [COMPLEXITY: Complex] [DEPENDS ON: 2.0]
> **WHY:** Eliminates spam alerts from blurry/sideways faces (quality gate), improves night detection (CLAHE), and reduces false matches (adaptive thresholds). Directly addresses the #1 user complaint: too many false alerts.

- [ ] **6.0 Auto-Enrollment + Negative Gallery** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 5.0]
> **WHY:** Self-improving recognition (auto-enrollment adds reference images automatically) and user-trainable false positive rejection (negative gallery). Reduces manual enrollment effort by ~80%.

### Phase 3 — Intelligence Layer

- [x] **7.0 Zone Detection System + Loitering** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 4.0]
> **WHY:** Transforms cameras from "detect everywhere" to "detect where it matters." RESTRICTED zones for high-priority areas, COUNTING zones for traffic analysis, loitering detection for suspicious behavior. Foundational for behavioral intelligence.

- [ ] **8.0 Cross-Camera Intelligence (Journey + Presence + Burst + Dedup)** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 4.0, 7.0]
> **WHY:** Connects isolated camera views into a unified property awareness system. "Angelo: Gate→Garden→House in 45s" journeys, HOME/AWAY presence states, telephoto burst capture for better face images, and camera group deduplication to eliminate duplicate alerts from CAM-2A/2B.

### Phase 4 — Advanced Features

- [x] **9.0 WebRTC Streaming + Real-Time Detection Overlay** [COMPLEXITY: Complex] [DEPENDS ON: 3.0, 4.0]
> **WHY:** Replaces raw 6.2MB frame IPC with hardware-decoded WebRTC (<100ms latency, 100x less bandwidth). Interactive detection overlay lets users click bounding boxes to enroll faces or mark false positives — the primary UI interaction model for v2.0.

- [x] **10.0 DVR/NVR Recording + Timeline UI** [COMPLEXITY: Complex] [DEPENDS ON: 9.0]
> **WHY:** Continuous recording with event-tagged timeline enables post-incident review. "What happened at the gate at 2:30 AM?" → click event marker → jump to footage. Essential for any security system.

- [x] **11.0 Analytics Dashboard** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 7.0, 8.0]
> **WHY:** Transforms raw event data into actionable insights: detection heatmaps, activity patterns, presence timelines, zone traffic. Answers "when is my property most active?" and "how much time does each person spend at home?"

- [x] **12.0 LLM Daily Reports (Ollama Integration)** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 4.0]
> **WHY:** AI-generated natural language summaries replace manual event log review. "3 unknown persons at gate between 2-4 AM, Angelo arrived at 6:15 PM" — delivered via Telegram at end of day.

- [x] **13.0 Liveness Detection + Sound Event Detection** [COMPLEXITY: Complex] [DEPENDS ON: 2.0, 5.0]
> **WHY:** Anti-spoofing (liveness) prevents photo/screen attacks on face recognition. Sound detection (glass break, gunshot, scream) adds an audio intelligence layer that works even when cameras can't see the event.

### Phase 5 — Presidential-Level

- [x] **14.0 Cross-Camera Re-ID + Spatial Topology** [COMPLEXITY: Complex] [DEPENDS ON: 1.0, 4.0, 8.0]
> **WHY:** THE dividing line between "a collection of cameras" and "a unified surveillance system." Re-ID tracks the same person across cameras even without face visibility (back turned, masked). Topology enables predictive handoff and anomaly detection (person skipped a camera, took too long).

- [x] **15.0 Floor Plan Visualization + Situation Room** [COMPLEXITY: Complex] [DEPENDS ON: 14.0]
> **WHY:** Real-time property map with person dots and movement trails provides instant situational awareness. Situation Room combines all intelligence (alerts, map, feeds, status, timeline) into a single command dashboard for continuous monitoring.

- [x] **16.0 Gait Recognition + Multi-Layer Identity** [COMPLEXITY: Complex] [DEPENDS ON: 14.0]
> **WHY:** 4-layer identity (face + body + gait + soft biometrics) provides the highest possible identification accuracy. Gait recognition works from 2s of walking footage — even when face and body appearance are obscured.

- [x] **17.0 Intelligent PTZ System** [COMPLEXITY: Complex] [DEPENDS ON: 4.0, 14.0]
> **WHY:** Transforms passive cameras into active pursuit tools. Auto-tracking follows subjects with PID-controlled smooth motion. Coordinated multi-camera handoff pre-positions the next camera before the subject arrives — the defining capability of presidential-level security.

### Cross-Cutting

- [x] **18.0 Navigation + Settings Expansion + Telegram Enhancement** [COMPLEXITY: Simple] [DEPENDS ON: 7.0, 8.0, 9.0]
> **WHY:** Sidebar needs 5 new navigation items (Zone Editor, Analytics, Floor Plan, Situation Room + updated routing). Settings needs 7 new tabs. Telegram needs enhanced message formats with journey/behavior/sound context. This is the glue that connects all new features to the user.

---

## Dependency Graph (Visual)

```
                    1.0 DB Schema ─────────────────────────────┐
                    2.0 CUDA Fix ──────────┐                   │
                                           │                   │
                    3.0 Dual-Stream ◄──── 2.0                 │
                                           │                   │
              ┌─── 4.0 YOLO+ByteTrack ◄── 2.0+3.0            │
              │    5.0 Face Pipeline ◄──── 2.0                 │
              │                            │                   │
              │    6.0 Auto-Enroll ◄────── 1.0+5.0            │
              │                                                │
              ├─── 7.0 Zones ◄──────────── 1.0+4.0            │
              │                                                │
              ├─── 8.0 Journey+Presence ◄─ 1.0+4.0+7.0        │
              │                                                │
              │    9.0 WebRTC+Overlay ◄─── 3.0+4.0            │
              │    10.0 DVR/NVR ◄───────── 9.0                │
              │    11.0 Analytics ◄──────── 1.0+7.0+8.0       │
              │    12.0 LLM Reports ◄───── 1.0+4.0            │
              │    13.0 Liveness+Sound ◄── 2.0+5.0            │
              │                                                │
              └─── 14.0 Re-ID+Topology ◄─ 1.0+4.0+8.0        │
                   15.0 FloorPlan+SitRoom ◄ 14.0              │
                   16.0 Gait+MultiID ◄──── 14.0               │
                   17.0 PTZ Intelligence ◄ 4.0+14.0           │
                                                               │
                   18.0 Nav+Settings ◄──── 7.0+8.0+9.0 ◄─────┘
```

## Summary

| Metric | Value |
|--------|-------|
| **Total high-level tasks** | 18 |
| **Phase 1 (Foundation)** | 3 tasks |
| **Phase 2 (Core AI)** | 3 tasks |
| **Phase 3 (Intelligence)** | 2 tasks |
| **Phase 4 (Advanced)** | 5 tasks |
| **Phase 5 (Presidential)** | 4 tasks |
| **Cross-cutting** | 1 task |
| **Complex tasks** | 17 |
| **Simple tasks** | 1 (Task 2.0 CUDA fix) + 1 (Task 18.0 Nav/Settings) |

---

## Detailed Execution Plan

> **Note on Parallel Execution:** Tasks with `[DEPENDS ON: ...]` must wait for prerequisites. Independent tasks within the same phase can run in parallel.
> **Rule Shorthand:**
> - `code-quality` = `3-code-quality-checklist`
> - `mod-safety` = `4-code-modification-safety-protocol`
> - `doc-integrity` = `5-documentation-context-integrity`
> - `ui-foundation` = `common-rule-ui-foundation-design-system`
> - `ui-interaction` = `common-rule-ui-interaction-a11y-perf`
> - `ui-premium` = `common-rule-ui-premium-brand-dataviz-enterprise`

---

### PHASE 1 — FOUNDATION

---

- [ ] **1.0 Database Schema v2.0 Migration + Shared Types** [COMPLEXITY: Complex]
> **WHY:** Every subsequent task depends on the expanded schema and TypeScript types. Doing this first prevents constant schema conflicts and enables parallel development across all layers.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[doc-integrity]`

  - [x] 1.1 **Schema Migration Script:** Create `src/main/database/migrations/v2.0.sql` with all new tables from PRD §5.1: `zones`, `negative_gallery`, `journeys`, `presence_history`, `topology_edges`, `recording_segments`, `reid_gallery`, `gait_profiles`, `ptz_presets`, `ptz_patrol_schedules`, `daily_summaries`, `analytics_rollup`, `floor_plan`. [APPLIES RULES: `code-quality`]
  - [x] 1.2 **Alter Existing Tables:** Add new columns to `cameras` (rtsp_sub_url, has_ptz, ptz_type, camera_group_id, floor_x/y/fov/rotation), `persons` (presence_state, presence_updated_at, last_seen_camera_id, last_seen_at, adaptive_threshold, auto_enroll_enabled/count), `face_embeddings` (quality_score, is_auto_enrolled, auto_enroll_expires_at), `events` (event_type expanded, track_id, global_person_id, zone_id, journey_id, behavior_type/details, sound_event_type/confidence, liveness_score/is_live, identity_method/fusion_score). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 1.3 **Create New Indexes:** All indexes from PRD §5.1 (zones, journeys, presence_history, recording_segments, reid_gallery, events new indexes, analytics_rollup, negative_gallery, ptz_presets, daily_summaries). [APPLIES RULES: `code-quality`]
  - [x] 1.4 **Migration Runner:** Update `DatabaseService.ts` to detect schema version and run migrations on startup. Add `schema_version` to settings table. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 1.5 **Seed 4 Logical Cameras:** Update camera seed data: CAM-1 (C520WS, PTZ), CAM-2A (C246D wide, fixed, GATE_GROUP), CAM-2B (C246D tele, PTZ, GATE_GROUP), CAM-3 (C520WS, PTZ). Include sub-stream URLs. [APPLIES RULES: `code-quality`]
  - [x] 1.6 **Seed Default Settings:** Insert all new v2.0 settings from PRD §5.2 with default values. [APPLIES RULES: `code-quality`]
  - [x] 1.7 **Shared TypeScript Types:** Update `src/shared/types.ts` with all new interfaces: `Zone`, `Journey`, `JourneyStep`, `PresenceState`, `TopologyEdge`, `RecordingSegment`, `ReIDGalleryEntry`, `GaitProfile`, `PTZPreset`, `PTZPatrolSchedule`, `DailySummary`, `AnalyticsRollup`, `FloorPlanConfig`, `TrackedObject`, `TrackTrail`, `PersonPosition`, `BehaviorAlert`, `SoundEvent`. Extend existing `Camera`, `Person`, `FaceEmbedding`, `DetectionEvent` types with new fields. [APPLIES RULES: `code-quality`]
  - [x] 1.8 **DatabaseService CRUD Methods:** Add CRUD methods for all new tables in `DatabaseService.ts`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 1.9 **Python Sidecar Pydantic Schemas:** Update `python-sidecar/models/schemas.py` with new request/response models for all new endpoints from PRD §4.3. [APPLIES RULES: `code-quality`]
  - [x] 1.10 **Documentation:** Update `APP_README.md` with new schema overview and 4-camera configuration. [APPLIES RULES: `doc-integrity`]

---

- [x] **2.0 Fix CUDA/GPU Acceleration** [COMPLEXITY: Simple]
> **WHY:** GPU is broken. Without this, all AI inference runs 5-10x slower on CPU, making real-time 4-camera processing impossible.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 2.1 **Diagnose CUDA Version:** Check installed CUDA toolkit version (`nvidia-smi`, `nvcc --version`). Identify the `cublasLt64_12.dll` mismatch causing the current failure. Document findings. [APPLIES RULES: `code-quality`]
  - [x] 2.2 **Pin onnxruntime-gpu Version:** Update `python-sidecar/requirements.txt` to pin `onnxruntime-gpu` to a version compatible with the installed CUDA 12.x. Add `cuDNN` version notes as a comment. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 2.3 **Update Model Loader:** Modify `python-sidecar/services/model_loader.py` to explicitly request CUDA Execution Provider with fallback to CPU. Log GPU name, VRAM, and provider on startup. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 2.4 **Health Endpoint GPU Info:** Enhance `python-sidecar/routers/health.py` to report `gpu_available`, `gpu_name`, `vram_total_mb`, `vram_used_mb`, `cuda_version`, `execution_provider`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 2.5 **Verification:** Run InsightFace buffalo_l detection on a test image. Confirm GPU EP loaded, inference <50ms. Compare CPU vs GPU timing. [APPLIES RULES: `code-quality`]

---

- [x] **3.0 Dual-Stream Architecture + go2rtc Reconfiguration** [COMPLEXITY: Complex]
> **WHY:** Current pipeline sends full 1080p to AI. Dual-stream separates display (1080p→WebRTC) from AI (720p→FFmpeg), reducing AI bandwidth by 4x.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[doc-integrity]`

  - [x] 3.1 **go2rtc.yaml Configuration:** Update `go2rtc/go2rtc.yaml` for 4 logical cameras. Each camera: main stream (1080p RTSP) + sub-stream (720p RTSP). Configure WebRTC output for each main stream. [APPLIES RULES: `code-quality`]
  - [x] 3.2 **Go2RtcService Enhancement:** Modify `src/main/services/Go2RtcService.ts` to manage 4 logical camera streams. Add sub-stream configuration per camera. Add health check for all streams. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 3.3 **StreamManager Dual-Path:** Refactor `src/main/services/StreamManager.ts` to route main streams to WebRTC (via go2rtc) and sub-streams to FFmpeg decode for AI sidecar. Remove direct 1080p frame IPC for AI processing. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 3.4 **FFmpeg Sub-Stream Decode:** Update FFmpeg spawn in StreamManager to decode 720p sub-streams (not 1080p main). Output raw frames to AI pipeline at configurable FPS (10-15fps). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 3.5 **IPC Stream Handlers Update:** Update `src/main/ipc/streamHandlers.ts` for 4 logical cameras. Add WebRTC signaling IPC channels (`webrtc:signal`, `webrtc:start`, `webrtc:stop`). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 3.6 **Verification:** Confirm all 4 streams display via WebRTC at 1080p. Confirm sub-stream frames arrive at AI sidecar at 720p. Measure bandwidth reduction. [APPLIES RULES: `code-quality`]
  - [x] 3.7 **Documentation:** Update `APP_README.md` with dual-stream architecture diagram. [APPLIES RULES: `doc-integrity`]

---

### PHASE 2 — CORE AI

---

- [x] **4.0 YOLO + ByteTrack Object Detection & Tracking** [COMPLEXITY: Complex]
> **WHY:** Replaces unreliable pixel-diff motion detection with real object detection. Persistent track IDs eliminate duplicate alerts and enable all downstream intelligence.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 4.1 **Install ultralytics:** Add `ultralytics` to `python-sidecar/requirements.txt`. Download YOLOv8s weights to `python-sidecar/models/`. [APPLIES RULES: `code-quality`]
  - [x] 4.2 **YOLO Service:** Create `python-sidecar/services/object_detection.py`. Load YOLOv8s with CUDA. Implement `detect_objects(frame, confidence, classes)` returning list of `{class, bbox, confidence}`. Filter classes per configuration. [APPLIES RULES: `code-quality`]
  - [x] 4.3 **ByteTrack Tracker:** Create `python-sidecar/services/tracker.py`. Implement per-camera ByteTrack state. `update(detections) → tracked_objects` with persistent track IDs. Handle occlusion recovery. [APPLIES RULES: `code-quality`]
  - [x] 4.4 **Object Detection Router:** Create `python-sidecar/routers/object_detection.py`. Implement `POST /detect_objects` endpoint (PRD §4.3). Accept `{camera_id, frame_base64, timestamp}`, return `{objects: [{class, bbox, confidence, track_id}]}`. [APPLIES RULES: `code-quality`]
  - [x] 4.5 **Track State Endpoint:** Implement `GET /track_state?camera_id=X` to return current tracking state (all active tracks with trail history). [APPLIES RULES: `code-quality`]
  - [x] 4.6 **Register Router:** Add object detection router to `python-sidecar/main.py`. [APPLIES RULES: `mod-safety`]
  - [x] 4.7 **Health Endpoint Update:** Add `yolo_loaded: bool` to health response. [APPLIES RULES: `mod-safety`]
  - [x] 4.8 **AIBridgeService Integration:** Add `detectObjects()` method to `src/main/services/AIBridgeService.ts` calling `POST /detect_objects`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 4.9 **DetectionPipeline Refactor:** Modify `src/main/services/DetectionPipeline.ts` to replace motion detection flow with: sub-stream frame → YOLO detect → ByteTrack → person crops → face detection (on person class only). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 4.10 **IPC: ai:objects Channel:** Add `ai:objects` IPC channel in `src/main/ipc/aiHandlers.ts` to push tracked object data to renderer. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 4.11 **Preload Types:** Update `src/preload/index.ts` with new IPC channel types for `ai:objects`, `ai:tracks`. [APPLIES RULES: `mod-safety`]
  - [x] 4.12 **Verification:** Run 4-camera test. Confirm person/vehicle/animal detection with persistent track IDs. Measure latency (<15ms YOLO + <2ms ByteTrack per frame). [APPLIES RULES: `code-quality`]

---

- [x] **5.0 Face Pipeline Enhancement (Quality Gate + CLAHE + Adaptive Thresholds)** [COMPLEXITY: Complex]
> **WHY:** Eliminates spam alerts from blurry/sideways faces, improves night detection, and reduces false matches.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 5.1 **Quality Gate Module:** Create `python-sidecar/services/quality_gate.py`. Implement scoring: yaw/pitch from InsightFace landmarks, blur via Laplacian variance, detection confidence. Return `{yaw, pitch, blur_score, det_score, passes_gate: bool}`. Thresholds from config. [APPLIES RULES: `code-quality`]
  - [x] 5.2 **Multi-Frame Confirmation:** Add `python-sidecar/services/confirmation_tracker.py`. Per-camera, per-track confirmation state. Require N consecutive recognitions (default 3) before emitting alert. Weighted voting with EMA smoothing (alpha from config). [APPLIES RULES: `code-quality`]
  - [x] 5.3 **CLAHE Night Enhancement:** Add CLAHE preprocessing to `python-sidecar/services/face_detection.py`. Auto-activate when mean luminance < threshold (default 80). Configurable via `night_enhance_enabled` and `night_luminance_threshold`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 5.4 **Adaptive Threshold Calculator:** Create `python-sidecar/services/adaptive_threshold.py`. Analyze embedding distribution per person. Diverse reference photos → lower threshold. Few photos → higher threshold. Range 0.45-0.65. Min margin 0.08 between best and second-best match. [APPLIES RULES: `code-quality`]
  - [x] 5.5 **Enhance /detect Endpoint:** Modify `python-sidecar/routers/detection.py` to include quality gate scores in response. Apply CLAHE if applicable. Return enriched face detection data. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 5.6 **Enhance /recognize Endpoint:** Modify `python-sidecar/routers/recognition.py` to use per-person adaptive threshold (fall back to global if not set). Apply multi-frame confirmation. Check negative gallery before returning match. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 5.7 **Config Router Update:** Expose new quality gate and night enhancement settings via `python-sidecar/routers/config_router.py`. [APPLIES RULES: `mod-safety`]
  - [x] 5.8 **Verification:** Test with blurry/sideways face images → should be rejected. Test in low-light → CLAHE should improve detection. Test adaptive thresholds with varying enrollment counts. [APPLIES RULES: `code-quality`]

---

- [x] **6.0 Auto-Enrollment + Negative Gallery** [COMPLEXITY: Complex]
> **WHY:** Self-improving recognition and user-trainable false positive rejection. Reduces manual enrollment effort by ~80%.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-interaction]`

  - [x] 6.1 **Auto-Enrollment Service:** Create `python-sidecar/services/auto_enrollment.py`. Logic: if match similarity ≥ 0.55 AND quality ≥ 80 AND auto_enroll_count < max (5) → store new embedding with `source_type='auto_enroll'` and `auto_enroll_expires_at = now + 30 days`. [APPLIES RULES: `code-quality`]
  - [x] 6.2 **Auto-Enrollment Router:** Create `python-sidecar/routers/auto_enrollment.py` with `POST /auto_enroll` endpoint. [APPLIES RULES: `code-quality`]
  - [x] 6.3 **Negative Gallery Service:** Create `python-sidecar/services/negative_gallery.py`. Store false positive crops with encrypted embeddings. During recognition, compare against negative gallery — reject if similarity > threshold. [APPLIES RULES: `code-quality`]
  - [x] 6.4 **Negative Gallery Router:** Create `python-sidecar/routers/negative_gallery.py` with `POST /negative/add`, `GET /negative/list?person_id=X`, `DELETE /negative/{id}`. [APPLIES RULES: `code-quality`]
  - [x] 6.5 **Register Routers:** Add auto_enrollment and negative_gallery routers to `python-sidecar/main.py`. [APPLIES RULES: `mod-safety`]
  - [x] 6.6 **Recognition Pipeline Integration:** Update `/recognize` flow to: check negative gallery → match against embeddings (with adaptive threshold) → trigger auto-enrollment if criteria met. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 6.7 **AIBridgeService Methods:** Add `autoEnroll()`, `addNegative()`, `listNegatives()`, `deleteNegative()` methods to `src/main/services/AIBridgeService.ts`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 6.8 **IPC Handlers:** Add negative gallery IPC handlers in `src/main/ipc/personHandlers.ts`. [APPLIES RULES: `mod-safety`]
  - [x] 6.9 **Preload Types:** Update preload with negative gallery IPC channels. [APPLIES RULES: `mod-safety`]
  - [x] 6.10 **PersonDetail UI Enhancement:** Modify `src/renderer/components/PersonDetail/PersonDetail.tsx` to show auto-enrolled images (with badge), negative gallery section, and auto-enroll toggle. [APPLIES RULES: `mod-safety`, `ui-interaction`]
  - [x] 6.11 **Expiry Cleanup:** Add periodic task in `ProcessManager.ts` to purge expired auto-enrolled embeddings (>30 days). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 6.12 **Verification:** Enroll person with 1 photo. Detect person multiple times → auto-enroll triggers. Mark detection as false positive → subsequent matches against that crop rejected. [APPLIES RULES: `code-quality`]

---

### PHASE 3 — INTELLIGENCE LAYER

---

- [x] **7.0 Zone Detection System + Loitering** [COMPLEXITY: Complex]
> **WHY:** Transforms cameras from "detect everywhere" to "detect where it matters." RESTRICTED zones for high-priority areas, COUNTING zones for traffic analysis, loitering detection for suspicious behavior.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 7.1 **ZoneService:** Create `src/main/services/ZoneService.ts`. CRUD for zones (backed by `DatabaseService`). Point-in-polygon check using ray-casting algorithm. Zone event emission: `zone_enter`, `zone_exit` (track enters/leaves polygon). Tripwire crossing detection (directional line with track correlation). [APPLIES RULES: `code-quality`]
  - [x] 7.2 **Loitering Timer:** Add loitering logic to `ZoneService`. Per-track timers: if track stays within zone AND movement radius < 80px for > threshold (default 15s) → emit `loiter` event. Cooldown (180s) prevents re-alerting. [APPLIES RULES: `code-quality`]
  - [x] 7.3 **Zone Check Sidecar Endpoint:** Create `python-sidecar/routers/zone_check.py` with `POST /zone_check` endpoint. Accept `{camera_id, objects, zones}`, return `{events: [{zone_id, track_id, event_type}]}`. Register in `main.py`. [APPLIES RULES: `code-quality`]
  - [x] 7.4 **Shapely Integration:** Add `shapely` to `python-sidecar/requirements.txt`. Use `shapely.geometry.Polygon.contains(Point)` for efficient point-in-polygon. [APPLIES RULES: `code-quality`]
  - [x] 7.5 **DetectionPipeline Zone Integration:** Modify `DetectionPipeline.ts` to call zone check after ByteTrack tracking. Pass tracked objects + zone definitions → receive zone events. Forward to `EventProcessor`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 7.6 **EventProcessor Zone Events:** Extend `EventProcessor.ts` to handle zone event types (`zone_enter`, `zone_exit`, `loiter`). Create `events` records with `zone_id`, `event_type`. Trigger Telegram for RESTRICTED zone entries and loitering. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 7.7 **Zone IPC Handlers:** Create zone IPC channels in a new `src/main/ipc/zoneHandlers.ts`: `zone:save`, `zone:get`, `zone:event`. Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 7.8 **Preload Types:** Add zone IPC channel types to `src/preload/index.ts`. [APPLIES RULES: `mod-safety`]
  - [x] 7.9 **Zone Editor Screen:** Create `src/renderer/screens/ZoneEditor/ZoneEditor.tsx`. Camera selector + live/static frame preview + polygon draw tool + tripwire draw tool + zone properties panel (type, name, color, loiter threshold) + zone list. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 7.10 **Polygon Draw Tool Component:** Create `src/renderer/components/PolygonDrawTool/PolygonDrawTool.tsx`. SVG-based polygon drawing on camera preview. Click to add vertices, double-click to close. Edit mode: drag vertices, delete vertex. Color per zone type. [APPLIES RULES: `ui-interaction`, `code-quality`]
  - [x] 7.11 **Tripwire Draw Tool Component:** Create `src/renderer/components/TripwireDrawTool/TripwireDrawTool.tsx`. Draw directional line with arrow indicator. Click start → click end. Drag to reposition. Direction arrow shows IN/OUT side. [APPLIES RULES: `ui-interaction`, `code-quality`]
  - [x] 7.12 **Zone Overlay on Camera View:** Extend `CameraFullscreenView.tsx` to render saved zones as semi-transparent colored polygons over the video feed. Toggle visibility. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 7.13 **Verification:** Draw polygon zone on camera → person enters → zone_enter event logged. Person lingers > 15s → loiter alert. Tripwire crossing generates directional event. RESTRICTED zone entry triggers Telegram. [APPLIES RULES: `code-quality`]

---

- [x] **8.0 Cross-Camera Intelligence (Journey + Presence + Burst + Dedup)** [COMPLEXITY: Complex]
> **WHY:** Connects isolated camera views into unified property awareness. Journey tracking, HOME/AWAY presence states, telephoto burst capture, and camera group deduplication.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 8.1 **TopologyService (Basic):** Create `src/main/services/TopologyService.ts`. Load topology edges from DB. Provide `getExpectedNextCameras(currentCameraId)` and `isTransitTimeValid(fromCamera, toCamera, elapsedSec)`. [APPLIES RULES: `code-quality`]
  - [x] 8.2 **JourneyService:** Create `src/main/services/JourneyService.ts`. Journey lifecycle: `startJourney(personId, cameraId)` → `updateJourney(journeyId, cameraId)` → `completeJourney(journeyId)`. Match face recognition events against active journeys using topology transit windows. Expire stale journeys after `blind_spot_max_sec`. [APPLIES RULES: `code-quality`]
  - [x] 8.3 **PresenceService:** Create `src/main/services/PresenceService.ts`. 5-state FSM per person: `UNKNOWN → AT_GATE → ARRIVING → HOME → DEPARTING → AWAY`. Transitions driven by camera detections + topology position. Timeout: "not seen 30 min" → AWAY. Emit `presence:update` events. Persist to `persons.presence_state` and `presence_history` table. [APPLIES RULES: `code-quality`]
  - [x] 8.4 **Camera Group Dedup:** Add dedup logic to `EventProcessor.ts`. For cameras in same `camera_group_id` (e.g., `GATE_GROUP`): if same person detected within 5s window across group members → emit single event with best-quality snapshot. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 8.5 **Tele Burst Capture:** Add burst trigger to `DetectionPipeline.ts`. When CAM-2A detects a person, signal CAM-2B to capture 5 high-res frames. Select best-quality frame (highest face quality score). Use for Telegram snapshot. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 8.6 **Journey + Presence IPC Handlers:** Create `src/main/ipc/journeyHandlers.ts` with channels: `journey:update`, `journey:list`, `presence:update`, `presence:list`. Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 8.7 **Preload Types:** Add journey and presence IPC channel types to preload. [APPLIES RULES: `mod-safety`]
  - [x] 8.8 **Presence Panel Component:** Create `src/renderer/components/PresencePanel/PresencePanel.tsx`. Per-person card: name, thumbnail, presence state (color-coded badge: green=HOME, yellow=ARRIVING/DEPARTING, gray=AWAY, blue=AT_GATE), last seen camera + time. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 8.9 **Dashboard Enhancement:** Add `PresencePanel` to `Dashboard.tsx` alongside existing CameraGrid. Layout: CameraGrid (top/main) + PresencePanel (side or bottom). [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 8.10 **EventLog Enhancement:** Extend `EventLog.tsx` and `FilterBar.tsx` to support new event types: `journey`, `presence_change`, `loiter`, `zone_enter`, `zone_exit`. Add event type filter dropdown. Update `EventTable` and `EventDetail` for journey/presence context. [APPLIES RULES: `mod-safety`, `ui-interaction`]
  - [x] 8.11 **TelegramService Enhancement:** Modify `TelegramService.ts` to include journey context in alerts ("Gate → Garden in 22s"), presence state changes, camera group dedup (best snapshot from group), and new message formats from PRD §6.1. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 8.12 **Verification:** Person walks Gate → Garden → House: journey event created with 3 steps. Presence transitions: AWAY → AT_GATE → ARRIVING → HOME. CAM-2A+2B detect same person: single deduplicated alert with CAM-2B telephoto snapshot. [APPLIES RULES: `code-quality`]

---

### PHASE 4 — ADVANCED FEATURES

---

- [x] **9.0 WebRTC Streaming + Real-Time Detection Overlay** [COMPLEXITY: Complex]
> **WHY:** Replaces raw 6.2MB frame IPC with hardware-decoded WebRTC. Interactive detection overlay lets users click bounding boxes to enroll or mark false positives.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 9.1 **WebRTCService:** Create `src/main/services/WebRTCService.ts`. Manage go2rtc WebRTC signaling for each camera. Handle SDP offer/answer exchange and ICE candidate relay between renderer `<video>` and go2rtc. Lifecycle: start/stop per camera. Fallback to raw frame IPC if WebRTC negotiation fails. [APPLIES RULES: `code-quality`]
  - [x] 9.2 **WebRTC IPC Handlers:** Create `src/main/ipc/webrtcHandlers.ts` with channels: `webrtc:signal`, `webrtc:start`, `webrtc:stop`. Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 9.3 **Preload Types:** Add WebRTC IPC channel types. [APPLIES RULES: `mod-safety`]
  - [x] 9.4 **useWebRTCStream Hook:** Create `src/renderer/hooks/useWebRTCStream.ts`. Replace `useStreamFrame` for display. Create RTCPeerConnection, handle signaling via IPC, attach `<video>` element. Return `{videoRef, connectionStatus}`. [APPLIES RULES: `code-quality`]
  - [x] 9.5 **CameraTile WebRTC Migration:** Modify `src/renderer/components/CameraTile/CameraTile.tsx` to use `useWebRTCStream` hook instead of canvas + `useStreamFrame`. Display via `<video>` element with hardware H.264 decode. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 9.6 **CameraFullscreenView WebRTC Migration:** Modify `CameraFullscreenView.tsx` to use `useWebRTCStream`. Replace canvas rendering with `<video>` element. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 9.7 **DetectionOverlay Component:** Create `src/renderer/components/DetectionOverlay/DetectionOverlay.tsx`. SVG layer positioned over `<video>`. Render bounding boxes (color-coded by class: person=green, vehicle=blue, animal=yellow, unknown=red), person names, confidence scores, track trails (fading polyline of last N positions). Subscribe to `ai:objects` IPC channel. Smooth interpolation between detection frames. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 9.8 **Interactive Overlay Actions:** Add click/right-click handlers to DetectionOverlay boxes. Left-click: show person detail popup. Right-click context menu: "Enroll Face", "Mark as False Positive", "Track This Person" (PTZ). [APPLIES RULES: `ui-interaction`, `code-quality`]
  - [x] 9.9 **Overlay Toggle:** Add overlay visibility toggle button to CameraTile and CameraFullscreenView. Persist preference. [APPLIES RULES: `mod-safety`, `ui-interaction`]
  - [x] 9.10 **Integrate Overlays:** Add `DetectionOverlay` to both `CameraTile` and `CameraFullscreenView`, positioned absolutely over the `<video>` element. [APPLIES RULES: `mod-safety`]
  - [x] 9.11 **Verification:** 4 cameras display via WebRTC at <100ms latency. Bounding boxes appear over video with correct positions. Click on box shows person info. Right-click offers enroll/negative gallery options. Overlay toggle works. [APPLIES RULES: `code-quality`]

---

- [x] **10.0 DVR/NVR Recording + Timeline UI** [COMPLEXITY: Complex]
> **WHY:** Continuous recording with event-tagged timeline enables post-incident review.
> **Recommended Model:** `Implementer (DeepSeek V3.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 10.1 **RecordingService:** Create `src/main/services/RecordingService.ts`. Control go2rtc MP4 recording per camera. Segment management: split by duration (configurable, default 15min). Track segments in `recording_segments` table. Retention cleanup: delete segments older than `recording_retention_days`. Modes: `continuous`, `event_triggered`, `off`. [APPLIES RULES: `code-quality`]
  - [x] 10.2 **Recording IPC Handlers:** Create `src/main/ipc/recordingHandlers.ts` with channels: `recording:start`, `recording:stop`, `recording:status`, `recording:segments`, `recording:playback`. Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 10.3 **Preload Types:** Add recording IPC channel types. [APPLIES RULES: `mod-safety`]
  - [x] 10.4 **Recording Indicator Component:** Create `src/renderer/components/RecordingIndicator/RecordingIndicator.tsx`. Red dot + "REC" badge when recording. Show disk usage. Add to CameraTile and CameraFullscreenView. [APPLIES RULES: `ui-foundation`, `code-quality`]
  - [x] 10.5 **Timeline Scrubber Component:** Create `src/renderer/components/TimelineScrubber/TimelineScrubber.tsx`. Horizontal timeline bar with time labels. Event markers (colored dots at event timestamps). Drag to scrub. Click event marker → jump to timestamp. Date picker for historical review. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 10.6 **Playback Integration:** Add playback mode to `CameraFullscreenView`. When user clicks timeline event: request segment URL from RecordingService → play via `<video>` element. Show playback controls (play/pause, speed, skip). [APPLIES RULES: `mod-safety`, `ui-interaction`]
  - [x] 10.7 **StatusBar Enhancement:** Modify `StatusBar.tsx` to show recording status (recording/stopped) and disk usage per camera. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 10.8 **Verification:** Enable continuous recording on 1 camera. Verify MP4 segments created at configured intervals. Event markers appear on timeline. Click marker → jumps to correct footage. Retention cleanup removes old segments. [APPLIES RULES: `code-quality`]

---

- [x] **11.0 Analytics Dashboard** [COMPLEXITY: Complex]
> **WHY:** Transforms raw event data into actionable insights: detection heatmaps, activity patterns, presence timelines, zone traffic.
> **Recommended Model:** `Implementer (DeepSeek V3.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`, `[ui-premium]`

  - [x] 11.1 **AnalyticsService:** Create `src/main/services/AnalyticsService.ts`. Periodic rollup job (hourly): aggregate detection counts, person counts, known/unknown split, zone enter/exit counts, loiter counts, behavior counts, sound event counts. Store in `analytics_rollup` table. Heatmap data generation: bin detection bounding box centers into grid cells per camera. [APPLIES RULES: `code-quality`]
  - [x] 11.2 **Analytics IPC Handlers:** Create `src/main/ipc/analyticsHandlers.ts` with channels: `analytics:heatmap`, `analytics:activity`, `analytics:presence`, `analytics:zoneTraffic`. Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 11.3 **Preload Types:** Add analytics IPC channel types. [APPLIES RULES: `mod-safety`]
  - [x] 11.4 **Install Chart Library:** Add `recharts` (or `@nivo/core` + `@nivo/bar` + `@nivo/line` + `@nivo/heatmap`) to `package.json`. [APPLIES RULES: `code-quality`]
  - [x] 11.5 **Analytics Screen:** Create `src/renderer/screens/Analytics/Analytics.tsx`. Date range selector + 4 panels: HeatmapPanel, ActivityGraph, PresenceTimeline, ZoneTrafficPanel. Responsive grid layout. [APPLIES RULES: `ui-foundation`, `ui-premium`, `code-quality`]
  - [x] 11.6 **HeatmapPanel Component:** Create `src/renderer/components/analytics/HeatmapPanel.tsx`. Per-camera detection heatmap. Grid overlay on camera snapshot. Color intensity = detection frequency. Camera selector. [APPLIES RULES: `ui-premium`, `code-quality`]
  - [x] 11.7 **ActivityGraph Component:** Create `src/renderer/components/analytics/ActivityGraph.tsx`. Stacked bar/line chart: detections per hour/day, stacked by camera. Toggle: hourly vs daily view. [APPLIES RULES: `ui-premium`, `code-quality`]
  - [x] 11.8 **PresenceTimeline Component:** Create `src/renderer/components/analytics/PresenceTimeline.tsx`. Per-person horizontal bar: colored segments for HOME (green), AWAY (gray), ARRIVING (yellow), DEPARTING (orange). Time axis. Person selector. [APPLIES RULES: `ui-premium`, `code-quality`]
  - [x] 11.9 **ZoneTrafficPanel Component:** Create `src/renderer/components/analytics/ZoneTrafficPanel.tsx`. Per-zone in/out counts as bar chart. Zone selector. Daily/weekly aggregation. [APPLIES RULES: `ui-premium`, `code-quality`]
  - [x] 11.10 **Verification:** Generate 24 hours of simulated events. Verify heatmap shows detection hotspots. Activity graph shows hourly pattern. Presence timeline shows person home/away segments. Zone traffic shows in/out counts. [APPLIES RULES: `code-quality`]

---

- [x] **12.0 LLM Daily Reports (Ollama Integration)** [COMPLEXITY: Complex]
> **WHY:** AI-generated natural language summaries replace manual event log review. Delivered via Telegram at end of day.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 12.1 **OllamaService:** Create `src/main/services/OllamaService.ts`. Manage Ollama process lifecycle (start/stop/health check). Check if model is downloaded. Provide `generate(prompt) → string` method via Ollama HTTP API (`POST http://localhost:11434/api/generate`). [APPLIES RULES: `code-quality`]
  - [x] 12.2 **ProcessManager Integration:** Modify `ProcessManager.ts` to start Ollama alongside Python sidecar and go2rtc. Health check for Ollama. Graceful shutdown. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 12.3 **Summary Prompt Builder:** Add `buildDailySummaryPrompt(events, date)` to OllamaService. Query day's events from DB. Structure prompt: total detections, person arrivals/departures, unknown persons, anomalies, zone activity, sound events. Instruct LLM to produce concise security summary (PRD §6.1 format). [APPLIES RULES: `code-quality`]
  - [x] 12.4 **Scheduled Summary Generation:** Add daily scheduler in OllamaService. At configured time (`llm_summary_time`, default 23:00): generate summary, store in `daily_summaries` table, optionally send via Telegram. [APPLIES RULES: `code-quality`]
  - [x] 12.5 **LLM IPC Handlers:** Create `src/main/ipc/llmHandlers.ts` with channels: `llm:summary` (get/generate for date), `llm:status` (Ollama running, model loaded). Register in main process. [APPLIES RULES: `code-quality`]
  - [x] 12.6 **Preload Types:** Add LLM IPC channel types. [APPLIES RULES: `mod-safety`]
  - [x] 12.7 **Daily Summary in Event Log:** Modify `EventLog.tsx` to show a "Daily Summary" card at the top when viewing a specific date. Fetch from `llm:summary` IPC. Render markdown-formatted summary. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 12.8 **TelegramService LLM Delivery:** Modify `TelegramService.ts` to send daily summary via Telegram when `llm_telegram_delivery` is enabled. Use PRD §6.1 "Daily Summary" format. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 12.9 **Verification:** Trigger manual summary generation for today. Verify Ollama produces coherent security summary. Verify stored in DB. Verify shown in Event Log. Verify Telegram delivery if enabled. [APPLIES RULES: `code-quality`]

---

- [x] **13.0 Liveness Detection + Sound Event Detection** [COMPLEXITY: Complex]
> **WHY:** Anti-spoofing prevents photo/screen attacks on face recognition. Sound detection adds an audio intelligence layer that works even when cameras can't see the event.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 13.1 **Liveness Model Integration:** Add MiniFASNet (or equivalent) ONNX model to `python-sidecar/models/`. Create `python-sidecar/services/liveness.py`. Load model with CUDA. `check_liveness(face_crop) → {is_live: bool, score: float}`. [APPLIES RULES: `code-quality`]
  - [x] 13.2 **Liveness Router:** Create `python-sidecar/routers/liveness.py` with `POST /liveness` endpoint. Register in `main.py`. [APPLIES RULES: `code-quality`]
  - [x] 13.3 **Liveness Pipeline Integration:** Modify `DetectionPipeline.ts` to call liveness check on face crops (when `liveness_enabled`). If `is_live=false` → generate `liveness_fail` event. Do not proceed with recognition for spoofed faces. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 13.4 **Sound Model Integration:** Add YAMNet ONNX/TFLite model to `python-sidecar/models/`. Create `python-sidecar/services/sound_detection.py`. Load model. `classify_audio(audio_segment) → [{class, confidence, start_ms, end_ms}]`. Filter by configured event types. [APPLIES RULES: `code-quality`]
  - [x] 13.5 **Sound Router:** Create `python-sidecar/routers/sound.py` with `POST /sound/classify` endpoint. Register in `main.py`. [APPLIES RULES: `code-quality`]
  - [x] 13.6 **SoundService:** Create `src/main/services/SoundService.ts`. Extract audio from camera RTSP streams (via FFmpeg). Buffer audio segments (1-2s). Send to sidecar for classification. Emit `sound:event` IPC for detected events. Create `events` records with `sound_event_type` and `sound_confidence`. [APPLIES RULES: `code-quality`]
  - [x] 13.7 **Sound + Liveness IPC:** Add `sound:event` and `liveness:result` IPC channels in appropriate handler files. Update preload types. [APPLIES RULES: `mod-safety`]
  - [x] 13.8 **EventProcessor Sound/Liveness Events:** Extend `EventProcessor.ts` to handle `sound` and `liveness_fail` event types. Trigger CRITICAL Telegram alerts for glass_break, gunshot, scream, and spoofing attempts. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 13.9 **Health Endpoint Update:** Add `liveness_loaded`, `sound_loaded` to sidecar health response. [APPLIES RULES: `mod-safety`]
  - [x] 13.10 **Verification:** Present photo of face to camera → liveness_fail event generated. Play glass breaking audio near camera → sound event detected and alert sent. [APPLIES RULES: `code-quality`]

---

### PHASE 5 — PRESIDENTIAL-LEVEL TRACKING

---

- [x] **14.0 Cross-Camera Re-ID + Spatial Topology** [COMPLEXITY: Complex]
> **WHY:** THE dividing line between "a collection of cameras" and "a unified surveillance system." Re-ID tracks the same person across cameras even without face visibility. Topology enables predictive handoff and anomaly detection.
> **Recommended Model:** `Algorithm Specialist (GPT-5.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 14.1 **OSNet-AIN Model Integration:** Add `torchreid` (or standalone OSNet-AIN ONNX export) to `python-sidecar/requirements.txt`. Download model weights to `python-sidecar/models/`. Create `python-sidecar/services/reid.py`. Load OSNet-AIN with CUDA. `extract_embedding(person_crop) → float[256]`. [APPLIES RULES: `code-quality`]
  - [x] 14.2 **Re-ID Router:** Create `python-sidecar/routers/reid.py` with `POST /reid/extract` and `POST /reid/match` endpoints (PRD §4.3). Register in `main.py`. [APPLIES RULES: `code-quality`]
  - [x] 14.3 **Re-ID Gallery Management:** Implement in-memory + DB gallery in `reid.py`. Per-camera, per-track entries with body embedding. Auto-expire after `reid_gallery_ttl_sec` (5 min). Cross-camera matching: when new track appears on camera B, compare against gallery from cameras A, C, D. Assign `global_person_id` on match. [APPLIES RULES: `code-quality`]
  - [x] 14.4 **Identity Fusion:** Add `python-sidecar/services/identity_fusion.py`. When both face and body are available: `fused_score = face_weight * face_sim + body_weight * body_sim` (default 0.7/0.3). When only body: use body Re-ID score alone. Update `identity_method` and `identity_fusion_score` on events. [APPLIES RULES: `code-quality`]
  - [x] 14.5 **DetectionPipeline Re-ID Integration:** Modify `DetectionPipeline.ts`. After YOLO + ByteTrack: extract body crop for each person track → send to `/reid/extract`. Store in Re-ID gallery. On new track appearance, call `/reid/match` against cross-camera gallery. Fuse with face recognition if available. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 14.6 **TopologyService Enhancement:** Extend `TopologyService.ts` (from 8.1) with anomaly detection: **skip detection** (person appears at camera C without being seen at expected camera B), **transit time violation** (person took too long/short between cameras), **disappearance** (person entered property but never seen leaving after `blind_spot_max_sec`). Emit `topology:anomaly` events. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 14.7 **Predictive Handoff:** Add `predictNextCamera(globalPersonId)` to TopologyService. When person detected at camera A, predict which camera they'll appear at next (based on topology edges + direction). Emit signal for PTZ pre-positioning (consumed by PTZService in 17.0). [APPLIES RULES: `code-quality`]
  - [x] 14.8 **Topology Editor UI:** Add topology configuration to Settings screen. Create `src/renderer/screens/Settings/TopologyEditor.tsx`. Visual editor: camera nodes + directional edges with transit time ranges. Add/edit/delete edges. Save to `topology_edges` table. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 14.9 **Topology IPC Handlers:** Create `src/main/ipc/topologyHandlers.ts` with channels: `topology:save`, `topology:get`, `topology:anomaly`. Register in main process. Update preload. [APPLIES RULES: `code-quality`]
  - [x] 14.10 **Health Endpoint Update:** Add `reid_loaded: bool` to sidecar health response. [APPLIES RULES: `mod-safety`]
  - [x] 14.11 **Re-ID Gallery Cleanup:** Add periodic cleanup in `ProcessManager.ts` to purge expired Re-ID gallery entries (>5 min inactive). [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 14.12 **Verification:** Person walks past CAM-2A (face visible) → appears at CAM-3 (back turned, no face) → Re-ID matches body appearance → same `global_person_id`. Person skips expected camera → topology anomaly alert. Transit time outside range → alert. [APPLIES RULES: `code-quality`]

---

- [x] **15.0 Floor Plan Visualization + Situation Room** [COMPLEXITY: Complex]
> **WHY:** Real-time property map with person dots provides instant situational awareness. Situation Room combines all intelligence into a single command dashboard.
> **Recommended Model:** `Implementer (DeepSeek V3.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`, `[ui-premium]`

  - [x] 15.1 **Floor Plan IPC Handlers:** Create `src/main/ipc/floorplanHandlers.ts` with channels: `floorplan:save`, `floorplan:get`, `floorplan:positions`. Register in main process. Update preload. [APPLIES RULES: `code-quality`]
  - [x] 15.2 **Floor Plan Position Calculator:** Add position estimation to `TopologyService.ts`. Based on last camera detection + elapsed time + topology graph → estimate person's current position on floor plan (interpolate between camera positions). Emit `floorplan:positions` updates at 1-2Hz. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 15.3 **Floor Plan Editor:** Create `src/renderer/screens/Settings/FloorPlanEditor.tsx`. Upload floor plan image. Drag-and-drop camera icons onto map. Set FOV direction per camera. Save to `floor_plan` table + `cameras` floor_x/y/fov/rotation columns. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 15.4 **Floor Plan Screen:** Create `src/renderer/screens/FloorPlan/FloorPlan.tsx`. Display uploaded floor plan image as canvas background. Camera icons at configured positions. Real-time person dots (color-coded: green=known, red=unknown, blue=unidentified body-only). Labels with person name or track ID. [APPLIES RULES: `ui-foundation`, `ui-premium`, `code-quality`]
  - [x] 15.5 **Movement Trails:** Add fading trail lines (last 5 min of movement) per person dot on floor plan. Animate position transitions smoothly between updates. [APPLIES RULES: `ui-premium`, `code-quality`]
  - [x] 15.6 **Floor Plan Interactions:** Click person dot → jump to camera feed showing that person. Click camera icon → open camera fullscreen view. Hover dot → tooltip with name, last seen time, presence state. [APPLIES RULES: `ui-interaction`, `code-quality`]
  - [x] 15.7 **Situation Room Screen:** Create `src/renderer/screens/SituationRoom/SituationRoom.tsx`. 4-panel layout: [APPLIES RULES: `ui-foundation`, `ui-premium`, `code-quality`]
    - Top-left: **AlertsPanel** — prioritized real-time alert list (CRITICAL → HIGH → LOW), auto-scrolling
    - Top-right: **FloorMapMini** — embedded floor plan with live person dots (reuse FloorPlan component in compact mode)
    - Bottom-left: **ActiveCameraFeed** — WebRTC feed of selected camera (click dot on map → switches feed)
    - Bottom-right: **PersonStatusPanel** — all known persons with presence state + **EventTimeline** — horizontal scrubber with event markers
  - [x] 15.8 **Situation Room Real-Time Updates:** Subscribe to all relevant IPC channels: `ai:objects`, `presence:update`, `journey:update`, `zone:event`, `sound:event`, `topology:anomaly`, `floorplan:positions`. Update all panels in real-time. [APPLIES RULES: `code-quality`]
  - [x] 15.9 **Verification:** Upload floor plan. Place 4 cameras. Person detected at gate → dot appears on map at CAM-2A position. Person walks to garden → dot moves to CAM-3 position with trail. Click dot → camera feed switches. Alerts appear in AlertsPanel. Situation Room shows unified view. [APPLIES RULES: `code-quality`]

---

- [x] **16.0 Gait Recognition + Multi-Layer Identity** [COMPLEXITY: Complex]
> **WHY:** 4-layer identity (face + body + gait + soft biometrics) provides the highest possible identification accuracy. Gait works from 2s of walking footage.
> **Recommended Model:** `Algorithm Specialist (GPT-5.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`

  - [x] 16.1 **Gait Model Integration:** Add GaitGL (or GaitSet) ONNX model to `python-sidecar/models/`. Create `python-sidecar/services/gait_recognition.py`. Load model with CUDA. `analyze_gait(frames[]) → {gait_embedding: float[], confidence}`. Requires ~30 frames (~2s at 15fps) of walking sequence. [APPLIES RULES: `code-quality`]
  - [x] 16.2 **Gait Router:** Create `python-sidecar/routers/gait.py` with `POST /gait/analyze` endpoint. Register in `main.py`. [APPLIES RULES: `code-quality`]
  - [x] 16.3 **Gait Profile Storage:** Persist gait embeddings per person in `gait_profiles` table (encrypted). Auto-update on high-quality walking sequences. [APPLIES RULES: `code-quality`]
  - [x] 16.4 **Walking Sequence Buffer:** Add frame accumulator in `DetectionPipeline.ts`. For each person track, buffer consecutive frames where person is walking (movement > threshold). When buffer reaches `gait_min_frames` (30) → send to `/gait/analyze`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 16.5 **Soft Biometrics Extraction:** Add to `python-sidecar/services/reid.py`: extract dominant clothing colors (HSV histogram) and estimate height (using bbox aspect ratio + camera calibration if available). Store as JSON in `reid_gallery.clothing_descriptor`. [APPLIES RULES: `code-quality`]
  - [x] 16.6 **Multi-Layer Fusion:** Extend `identity_fusion.py`. Full fusion: `score = w_face * face + w_body * body + w_gait * gait + w_soft * soft_match`. Default weights: face=0.5, body=0.25, gait=0.15, soft=0.1 (when all available). Degrade gracefully when layers missing. Log which layers contributed. [APPLIES RULES: `code-quality`]
  - [x] 16.7 **Health Endpoint Update:** Add `gait_loaded: bool` to sidecar health response. [APPLIES RULES: `mod-safety`]
  - [x] 16.8 **Verification:** Person walks past camera for 2+ seconds → gait embedding extracted and stored. Same person re-appears with face obscured → gait + body Re-ID identifies them. Multi-layer fusion score higher than single-layer. [APPLIES RULES: `code-quality`]

---

- [x] **17.0 Intelligent PTZ System** [COMPLEXITY: Complex]
> **WHY:** Transforms passive cameras into active pursuit tools. Auto-tracking follows subjects. Coordinated handoff pre-positions cameras — the defining capability of presidential-level security.
> **Recommended Model:** `Algorithm Specialist (GPT-5.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 17.1 **PTZ Abstraction Layer:** Create `src/main/services/PTZService.ts` with abstract `PTZController` interface: `move(direction, speed)`, `stop()`, `gotoPreset(id)`, `setPreset(id, name)`, `getPosition()`, `getCapabilities()`. Implement `TapoPTZController` using `TapoAPIService`. Implement `OnvifPTZController` as fallback. [APPLIES RULES: `code-quality`]
  - [x] 17.2 **Zoom-on-Demand:** Add `zoomToTarget(cameraId, bbox)` to PTZService. Calculate pan/tilt offset from frame center to bbox center. Send proportional move command. Auto-zoom based on person bbox size vs frame size. [APPLIES RULES: `code-quality`]
  - [x] 17.3 **Auto-Tracking Controller:** Add `startAutoTrack(cameraId, trackId)` and `stopAutoTrack(cameraId)` to PTZService. PID controller for smooth pan/tilt following. Dead zone (configurable, default 10% of frame center). Multi-person priority: unknown > known, nearest center > edge. Update at tracking frame rate. [APPLIES RULES: `code-quality`]
  - [x] 17.4 **Preset Patrol Scheduler:** Add patrol mode to PTZService. Cycle through presets from `ptz_presets` table with configurable dwell time per preset. Schedule-based activation (`ptz_patrol_schedules`). Interrupt on detection → auto-track → resume patrol when target leaves. [APPLIES RULES: `code-quality`]
  - [x] 17.5 **Coordinated Multi-Camera Handoff:** Add handoff logic to PTZService. Consume predictive handoff signals from TopologyService (14.7). When person predicted to arrive at next PTZ camera → pre-position that camera to expected entry point (nearest preset). [APPLIES RULES: `code-quality`]
  - [x] 17.6 **PTZ IPC Handlers Enhancement:** Update `src/main/ipc/ptzHandlers.ts` with new channels: `ptz:autotrack:start`, `ptz:autotrack:stop`, `ptz:patrol:start`, `ptz:patrol:stop`, `ptz:preset:save`, `ptz:preset:goto`, `ptz:preset:list`, `ptz:zoom:to`. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 17.7 **Preload Types:** Update preload with enhanced PTZ IPC channel types. [APPLIES RULES: `mod-safety`]
  - [x] 17.8 **PTZControls Enhancement:** Modify `src/renderer/components/PTZControls/PTZControls.tsx` to add: auto-track toggle button, patrol toggle button, patrol schedule indicator, tracking target indicator (which person is being tracked). [APPLIES RULES: `mod-safety`, `ui-interaction`]
  - [x] 17.9 **PTZ Settings Tab:** Create `src/renderer/screens/Settings/PTZConfig.tsx`. Per-camera: preset editor (save/delete presets with names), patrol schedule editor (time ranges + enable/disable), auto-track settings (dead zone, priority mode). [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 17.10 **Verification:** Click person bounding box → camera zooms to that person. Enable auto-track → camera smoothly follows moving person. Enable patrol → camera cycles through presets. Person detected during patrol → patrol interrupts, auto-track engages, patrol resumes after person leaves. Person at CAM-2A → CAM-3 pre-positions to "Garden Path" preset. [APPLIES RULES: `code-quality`]

---

### CROSS-CUTTING

---

- [x] **18.0 Navigation + Settings Expansion + Telegram Enhancement** [COMPLEXITY: Simple]
> **WHY:** Sidebar needs new navigation items. Settings needs new tabs. Telegram needs enhanced message formats. This connects all new features to the user.
> **Recommended Model:** `Implementer (DeepSeek V3.2)`
> **Rules to apply:** `[code-quality]`, `[mod-safety]`, `[ui-foundation]`, `[ui-interaction]`

  - [x] 18.1 **Sidebar Navigation Update:** Modify `src/renderer/components/Sidebar.tsx`. Add new navigation items: Zone Editor (`Shapes` icon), Analytics (`BarChart3` icon), Floor Plan (`Map` icon), Situation Room (`Shield` icon). Update `Screen` type union. Total: 8 nav items (dashboard, camera-view, event-log, person-directory, zone-editor, analytics, floor-plan, situation-room, settings). Consider grouping with section dividers. [APPLIES RULES: `mod-safety`, `ui-foundation`, `ui-interaction`]
  - [x] 18.2 **App.tsx Routing Update:** Modify `src/renderer/App.tsx` to add routing for all new screens: ZoneEditor, Analytics, FloorPlan, SituationRoom. Import and render new screen components. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 18.3 **Settings Tab Expansion:** Modify `src/renderer/screens/Settings/Settings.tsx` to add new tabs: AI Config (`Brain` icon), PTZ Config (`Compass` icon), Zones (`Shapes` icon), Recording (`HardDrive` icon), Topology (`Network` icon), LLM Config (`Bot` icon), Sound Detection (`Volume2` icon). [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 18.4 **AI Config Settings Tab:** Create `src/renderer/screens/Settings/AIConfig.tsx`. GPU status display, YOLO settings (enabled, confidence, classes), quality gate settings (yaw/pitch/blur thresholds, confirm frames, EMA alpha), night enhancement settings, auto-enrollment settings, adaptive threshold settings, Re-ID settings, liveness settings. All read/write via `settings:get`/`settings:set` IPC. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 18.5 **Recording Config Settings Tab:** Create `src/renderer/screens/Settings/RecordingConfig.tsx`. Recording mode selector, retention days, storage path picker, segment duration. Disk usage display. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 18.6 **Zone Defaults Settings Tab:** Create `src/renderer/screens/Settings/ZoneDefaults.tsx`. Default loiter threshold, default cooldown, zone color palette. [APPLIES RULES: `ui-foundation`, `code-quality`]
  - [x] 18.7 **LLM Config Settings Tab:** Create `src/renderer/screens/Settings/LLMConfig.tsx`. Ollama endpoint, model name, summary schedule time, Telegram delivery toggle. Ollama status indicator. "Generate Now" button. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 18.8 **Sound Detection Settings Tab:** Create `src/renderer/screens/Settings/SoundDetectionConfig.tsx`. Enable/disable, event type checkboxes, confidence threshold slider. [APPLIES RULES: `ui-foundation`, `ui-interaction`, `code-quality`]
  - [x] 18.9 **SystemInfo Enhancement:** Modify `src/renderer/screens/Settings/SystemInfo.tsx` to show: GPU name + VRAM usage, loaded AI models list, Ollama status, recording storage used, go2rtc stream status. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 18.10 **StatusBar Full Enhancement:** Final enhancement to `StatusBar.tsx`: GPU status indicator, recording indicator (per camera), Ollama status, total active tracks count. [APPLIES RULES: `mod-safety`, `ui-foundation`]
  - [x] 18.11 **Telegram Full Message Formats:** Final pass on `TelegramService.ts` to implement all PRD §6.1 message formats: Unknown Person Alert, Known Person Detection, Journey Complete, Behavioral Alert, Sound Alert, Daily Summary. Include camera group dedup, DND override for CRITICAL, and throttling rules from PRD §6.3. [APPLIES RULES: `mod-safety`, `code-quality`]
  - [x] 18.12 **Verification:** Navigate to all 9 screens via sidebar. All Settings tabs render and save/load values. Telegram messages match PRD §6.1 formats. StatusBar shows all indicators. [APPLIES RULES: `code-quality`]

---

## Primary Files Affected

### Renderer (React + TypeScript)

**New Screens:**
- `src/renderer/screens/ZoneEditor/ZoneEditor.tsx`
- `src/renderer/screens/Analytics/Analytics.tsx`
- `src/renderer/screens/FloorPlan/FloorPlan.tsx`
- `src/renderer/screens/SituationRoom/SituationRoom.tsx`

**New Components:**
- `src/renderer/components/DetectionOverlay/DetectionOverlay.tsx`
- `src/renderer/components/PresencePanel/PresencePanel.tsx`
- `src/renderer/components/PolygonDrawTool/PolygonDrawTool.tsx`
- `src/renderer/components/TripwireDrawTool/TripwireDrawTool.tsx`
- `src/renderer/components/RecordingIndicator/RecordingIndicator.tsx`
- `src/renderer/components/TimelineScrubber/TimelineScrubber.tsx`
- `src/renderer/components/analytics/HeatmapPanel.tsx`
- `src/renderer/components/analytics/ActivityGraph.tsx`
- `src/renderer/components/analytics/PresenceTimeline.tsx`
- `src/renderer/components/analytics/ZoneTrafficPanel.tsx`

**New Settings Tabs:**
- `src/renderer/screens/Settings/AIConfig.tsx`
- `src/renderer/screens/Settings/PTZConfig.tsx`
- `src/renderer/screens/Settings/RecordingConfig.tsx`
- `src/renderer/screens/Settings/ZoneDefaults.tsx`
- `src/renderer/screens/Settings/LLMConfig.tsx`
- `src/renderer/screens/Settings/SoundDetectionConfig.tsx`
- `src/renderer/screens/Settings/TopologyEditor.tsx`
- `src/renderer/screens/Settings/FloorPlanEditor.tsx`

**New Hooks:**
- `src/renderer/hooks/useWebRTCStream.ts`

**Modified:**
- `src/renderer/App.tsx` (routing)
- `src/renderer/components/Sidebar.tsx` (navigation)
- `src/renderer/screens/Dashboard/Dashboard.tsx` (presence panel)
- `src/renderer/screens/EventLog/EventLog.tsx` (new event types, daily summary)
- `src/renderer/screens/Settings/Settings.tsx` (new tabs)
- `src/renderer/screens/Settings/SystemInfo.tsx` (GPU, models)
- `src/renderer/components/CameraTile/CameraTile.tsx` (WebRTC, overlay)
- `src/renderer/screens/CameraFullscreenView/CameraFullscreenView.tsx` (WebRTC, overlay, zones, playback)
- `src/renderer/components/PTZControls/PTZControls.tsx` (auto-track, patrol)
- `src/renderer/components/FilterBar/FilterBar.tsx` (new event types)
- `src/renderer/components/PersonDetail/PersonDetail.tsx` (auto-enroll, negative gallery)
- `src/renderer/components/StatusBar/StatusBar.tsx` (GPU, recording, tracks)

### Main Process (TypeScript)

**New Services:**
- `src/main/services/ZoneService.ts`
- `src/main/services/JourneyService.ts`
- `src/main/services/PresenceService.ts`
- `src/main/services/TopologyService.ts`
- `src/main/services/RecordingService.ts`
- `src/main/services/AnalyticsService.ts`
- `src/main/services/SoundService.ts`
- `src/main/services/WebRTCService.ts`
- `src/main/services/OllamaService.ts`
- `src/main/services/PTZService.ts`

**New IPC Handlers:**
- `src/main/ipc/zoneHandlers.ts`
- `src/main/ipc/journeyHandlers.ts`
- `src/main/ipc/webrtcHandlers.ts`
- `src/main/ipc/recordingHandlers.ts`
- `src/main/ipc/analyticsHandlers.ts`
- `src/main/ipc/llmHandlers.ts`
- `src/main/ipc/topologyHandlers.ts`
- `src/main/ipc/floorplanHandlers.ts`

**New Database:**
- `src/main/database/migrations/v2.0.sql`

**Modified:**
- `src/main/services/DatabaseService.ts` (schema migration, new CRUD)
- `src/main/services/AIBridgeService.ts` (new endpoints)
- `src/main/services/DetectionPipeline.ts` (YOLO+ByteTrack+zones+Re-ID+gait+liveness)
- `src/main/services/EventProcessor.ts` (new event types, dedup, behaviors)
- `src/main/services/StreamManager.ts` (dual-stream)
- `src/main/services/Go2RtcService.ts` (4 logical cameras)
- `src/main/services/TelegramService.ts` (enhanced formats)
- `src/main/services/ProcessManager.ts` (Ollama, cleanup tasks)
- `src/main/ipc/aiHandlers.ts` (ai:objects, ai:tracks)
- `src/main/ipc/ptzHandlers.ts` (enhanced PTZ channels)
- `src/main/ipc/streamHandlers.ts` (WebRTC signaling)
- `src/main/ipc/personHandlers.ts` (negative gallery)
- `src/preload/index.ts` (all new IPC channel types)
- `src/shared/types.ts` (all new interfaces)

### Python Sidecar (FastAPI)

**New Services:**
- `python-sidecar/services/object_detection.py`
- `python-sidecar/services/tracker.py`
- `python-sidecar/services/quality_gate.py`
- `python-sidecar/services/confirmation_tracker.py`
- `python-sidecar/services/adaptive_threshold.py`
- `python-sidecar/services/auto_enrollment.py`
- `python-sidecar/services/negative_gallery.py`
- `python-sidecar/services/reid.py`
- `python-sidecar/services/identity_fusion.py`
- `python-sidecar/services/gait_recognition.py`
- `python-sidecar/services/liveness.py`
- `python-sidecar/services/sound_detection.py`

**New Routers:**
- `python-sidecar/routers/object_detection.py`
- `python-sidecar/routers/auto_enrollment.py`
- `python-sidecar/routers/negative_gallery.py`
- `python-sidecar/routers/zone_check.py`
- `python-sidecar/routers/reid.py`
- `python-sidecar/routers/gait.py`
- `python-sidecar/routers/liveness.py`
- `python-sidecar/routers/sound.py`

**Modified:**
- `python-sidecar/main.py` (register all new routers)
- `python-sidecar/requirements.txt` (ultralytics, torchreid, shapely, etc.)
- `python-sidecar/models/schemas.py` (new Pydantic models)
- `python-sidecar/services/model_loader.py` (CUDA fix, new models)
- `python-sidecar/services/face_detection.py` (CLAHE)
- `python-sidecar/services/face_recognition.py` (adaptive threshold, negative gallery check)
- `python-sidecar/routers/detection.py` (quality gate)
- `python-sidecar/routers/recognition.py` (adaptive threshold, confirmation)
- `python-sidecar/routers/health.py` (GPU info, model status)
- `python-sidecar/routers/config_router.py` (new settings)

### Configuration
- `go2rtc/go2rtc.yaml` (4 logical cameras, dual-stream)

### Documentation
- `APP_README.md` (updated architecture, 4 cameras, dual-stream)

---

## Execution Statistics

| Metric | Count |
|--------|-------|
| **High-level tasks** | 18 |
| **Total sub-tasks** | 172 |
| **New files to create** | ~55 |
| **Existing files to modify** | ~35 |
| **New Python sidecar services** | 12 |
| **New Python sidecar routers** | 8 |
| **New Main process services** | 10 |
| **New Main process IPC handlers** | 8 |
| **New Renderer screens** | 4 |
| **New Renderer components** | 10+ |
| **New Settings tabs** | 8 |
| **New SQLite tables** | 11 |
| **New IPC channels** | 40+ |
| **AI models to integrate** | 6 (YOLO, OSNet, GaitGL, MiniFASNet, YAMNet, Ollama) |

---

> **Next Step:** Run `/implement` to begin executing tasks sequentially, starting with Task 1.0 (DB Schema v2.0 Migration).
