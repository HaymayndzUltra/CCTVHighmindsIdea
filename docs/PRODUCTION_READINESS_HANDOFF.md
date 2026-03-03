# Production Readiness Handoff — Tapo CCTV Desktop v2.0

> **Purpose:** This document is a comprehensive handoff for a new AI session. It contains the full implementation summary of all 18 tasks, TWO rounds of deep production-readiness audits (original + second-pass), and ALL remaining issues that must be resolved before the system is production-ready.
>
> **CRITICAL INSTRUCTION FOR NEXT SESSION:**
> 1. **READ** this entire document first.
> 2. **VERIFY** every finding below by reading the actual source files cited. Confirm each issue still exists. Some may have been fixed since this audit was written. Mark each as CONFIRMED or RESOLVED.
> 3. **ONLY AFTER VERIFICATION**, fix all CONFIRMED issues in priority order (CRITICAL → HIGH → MEDIUM).
> 4. Do NOT assume any finding is correct without reading the cited file and line numbers yourself.
>
> **Audit History:**
> - **Round 1** (original session): Identified H-1 through H-8, M-1 through M-5
> - **Round 2** (second audit session): Found 28 additional issues the first audit missed, including CRITICAL bugs that break core functionality

---

## 1. Project Overview

**Application:** Tapo CCTV Desktop — an AI-driven desktop surveillance system for a residential compound with 4 Tapo cameras.

**Architecture:**
- **Electron** (React + TypeScript renderer, Node.js main process)
- **Python FastAPI sidecar** (AI inference: face detection, recognition, YOLO, Re-ID, gait, liveness, sound)
- **go2rtc** (WebRTC streaming proxy for low-latency camera display)
- **SQLite** (local database via better-sqlite3)

**Target Hardware:** Ryzen 9 7900, RTX 4090 (24GB VRAM), 32GB RAM

**Camera Layout (4 logical cameras):**
| Camera ID | Model | Type | Role |
|-----------|-------|------|------|
| CAM-1 | C520WS | PTZ | Gate camera |
| CAM-2A | C246D | Wide (fixed) | Garden wide-angle |
| CAM-2B | C246D | Tele (PTZ) | Garden telephoto |
| CAM-3 | C520WS | PTZ | House entrance |

**Key Files:**
- PRD: `docs/prd-tapo-cctv-desktop-v2.md`
- Task Plan: `tasks/tasks-prd-tapo-cctv-desktop-v2.md`
- DB Schema: `src/main/database/schema.sql` (v1.0) + `src/main/database/migrations/v2.0.sql`

---

## 2. Git History (All 18 Tasks — Chronological)

```
a9eba34 fix: correct Electron entry point path, remove type:module, add renderer fallback, copy schema.sql to dist, fix PostCSS/TailwindCSS v4 config, rebuild better-sqlite3 for Electron
93bf05e fix(sidecar): pin onnxruntime-gpu 1.23.2, add explicit CUDA EP options, enhance health endpoint with GPU metrics
6d796f1 feat(streaming): dual-stream architecture - go2rtc WebRTC display + 720p FFmpeg sub-stream for AI pipeline
9759776 fix(motion-detector): update frame dimensions to 720p for dual-stream sub-stream compatibility
3d6d07e feat(ai-core): Phase 2 Tasks 4.0-6.0 - YOLO+ByteTrack, Face Pipeline, Auto-Enrollment+Negative Gallery
2c61989 fix(lint): fix preserve-caught-error and unused-var issues in Phase 2 handlers
3df18aa feat(zones): implement zone detection system with loitering (Task 7.0)
0f605d7 feat(8.0): Cross-Camera Intelligence - backend services (8.1-8.6, 8.11)
3b268d7 feat(8.0): Cross-Camera Intelligence - frontend (8.7-8.10)
bd2e0db chore(8.0): mark all 8.0 sub-tasks complete in task list
1916c46 feat(webrtc): implement WebRTC streaming + real-time detection overlay (Task 9.0)
1801d89 feat(recording): implement DVR/NVR recording + timeline UI (Task 10.0)
706ecf6 feat(analytics): implement analytics dashboard with heatmap, activity, presence, zone traffic (Task 11.0)
ae67c81 feat(llm): implement Ollama LLM daily reports with prompt builder and Telegram delivery (Task 12.0)
50490d9 feat(liveness+sound): implement liveness detection and sound event classification (Task 13.0)
25b7de5 feat(reid+topology): implement cross-camera Re-ID + spatial topology anomaly detection (Task 14.0)
4a5671c feat(floorplan+sitroom): implement floor plan visualization + situation room dashboard (Task 15.0)
b081e4f feat(gait): implement gait recognition + 4-layer identity fusion (Task 16.0)
f6576e8 feat(ptz): implement intelligent PTZ system with auto-tracking, patrol, coordinated handoff (Task 17.0)
c553e73 feat(nav+settings): implement navigation expansion, settings tabs, App routing for all new screens (Task 18.0)
```

---

## 3. Complete Implementation Summary (All 18 Tasks)

### Phase 1 — Foundation (Tasks 1.0–3.0) ✅

**Task 1.0 — Database Schema v2.0 Migration**
- `src/main/database/schema.sql` — Base v1.0 schema (cameras, persons, face_embeddings, events, settings)
- `src/main/database/migrations/v2.0.sql` — 281-line migration adding: zones, negative_gallery, journeys, presence_history, topology_edges, recording_segments, reid_gallery, gait_profiles, ptz_presets, ptz_patrol_schedules, daily_summaries, analytics_rollup, floor_plan tables + new columns on existing tables
- `src/main/services/DatabaseService.ts` — Migration runner, CRUD for all entities, schema versioning
- `src/shared/types.ts` — All TypeScript interfaces for v2.0 entities

**Task 2.0 — CUDA/GPU Fix**
- `python-sidecar/requirements.txt` — Pinned `onnxruntime-gpu==1.23.2` with explicit CUDA EP options
- `python-sidecar/routers/health.py` — GPU metrics in health endpoint

**Task 3.0 — Dual-Stream Architecture**
- `go2rtc/go2rtc.yaml` — Configured main (1080p) + sub (720p) RTSP streams per camera
- `src/main/services/Go2RtcService.ts` — Stream URL generation for both streams
- `src/main/services/StreamManager.ts` — FFmpeg 720p sub-stream capture for AI pipeline
- `src/main/services/MotionDetector.ts` — Updated to 720p frame dimensions

### Phase 2 — Core AI (Tasks 4.0–6.0) ✅

**Task 4.0 — YOLO + ByteTrack Object Detection & Tracking**
- `python-sidecar/services/object_detection.py` — YOLOv8s with CUDA, ByteTrack integration
- `python-sidecar/routers/object_detection.py` — POST /detect_objects endpoint
- `src/main/services/DetectionPipeline.ts` — Full pipeline: motion → YOLO → ByteTrack → face detection → recognition
- `src/main/services/AIBridgeService.ts` — `detectObjects()` method

**Task 5.0 — Face Pipeline Enhancement**
- Quality gate (blur, size, angle thresholds)
- CLAHE preprocessing for low-light improvement
- `python-sidecar/services/adaptive_threshold.py` — Per-person adaptive recognition thresholds

**Task 6.0 — Auto-Enrollment + Negative Gallery**
- `python-sidecar/routers/auto_enrollment.py` — POST /auto_enroll endpoint
- `python-sidecar/routers/negative_gallery.py` — CRUD endpoints
- `python-sidecar/services/auto_enrollment.py` — Quality-gated auto-enrollment logic
- `src/main/ipc/personHandlers.ts` — Negative gallery IPC handlers

### Phase 3 — Intelligence Layer (Tasks 7.0–8.0) ✅

**Task 7.0 — Zone Detection System + Loitering**
- `src/main/services/ZoneService.ts` — CRUD, ray-casting point-in-polygon, zone enter/exit events, tripwire crossing detection, loitering with per-track timers/movement radius/cooldown
- `python-sidecar/routers/zone_check.py` — POST /zone_check with Shapely polygon containment
- `src/main/ipc/zoneHandlers.ts` — zone:save/list/get/update/delete IPC
- `src/renderer/screens/ZoneEditor/ZoneEditor.tsx` — Full zone editor with camera selector, 4 zone types
- `src/renderer/components/PolygonDrawTool/PolygonDrawTool.tsx` — SVG polygon drawing
- `src/renderer/components/TripwireDrawTool/TripwireDrawTool.tsx` — Directional line drawing
- `src/renderer/screens/CameraFullscreenView/CameraFullscreenView.tsx` — Zone overlay with toggle
- `src/main/services/DetectionPipeline.ts` — Zone checks after ByteTrack
- `src/main/services/EventProcessor.ts` — Zone event processing, Telegram alerts for RESTRICTED zones + loitering

**Task 8.0 — Cross-Camera Intelligence**
- `src/main/services/TopologyService.ts` — Edge cache (30s TTL), getExpectedNextCameras, isTransitTimeValid, getCameraGroupId, getGroupMembers, getBlindSpotMaxSec
- `src/main/services/JourneyService.ts` — Full lifecycle (start→update→complete→expire), topology transit matching, blind_spot_max_sec expiry, Telegram journey alerts
- `src/main/services/PresenceService.ts` — 5-state FSM (UNKNOWN→AT_GATE→ARRIVING→HOME→DEPARTING→AWAY), 30-min timeout→AWAY, Telegram presence alerts
- `src/main/services/EventProcessor.ts` — Camera group dedup (5s window, best-confidence snapshot), journey+presence integration
- `src/main/services/DetectionPipeline.ts` — Telephoto burst capture (wide→tele, 5 frames, best quality)
- `src/main/services/TelegramService.ts` — Journey context, presenceState/isGroupDedup, sendPresenceAlert, sendJourneyAlert
- `src/main/ipc/journeyHandlers.ts` — journey:list, journey:active, presence:list, presence:history
- `src/renderer/components/PresencePanel/PresencePanel.tsx` — Horizontal scroll strip with per-person cards
- `src/renderer/screens/Dashboard.tsx` — PresencePanel below CameraGrid
- `src/renderer/components/FilterBar.tsx` — Event type dropdown (8 types)
- `src/renderer/components/EventTable.tsx` — Type column with color-coded badges
- `src/renderer/components/EventDetail.tsx` — Journey/zone context badges

### Phase 4 — Advanced Features (Tasks 9.0–13.0) ✅

**Task 9.0 — WebRTC Streaming + Detection Overlay**
- `src/main/services/WebRTCService.ts` — Per-camera WebRTC signaling proxy to go2rtc
- `src/renderer/hooks/useWebRTCStream.ts` — RTCPeerConnection hook with fallback to canvas
- `src/renderer/components/DetectionOverlay/DetectionOverlay.tsx` — SVG bounding boxes, color-coded by class, track trails, smooth interpolation
- `src/renderer/components/DetectionOverlay/OverlayContextMenu.tsx` — Right-click: Enroll Face, Mark False Positive, Track Person
- CameraTile + CameraFullscreenView migrated to WebRTC with automatic canvas fallback

**Task 10.0 — DVR/NVR Recording + Timeline UI**
- `src/main/services/RecordingService.ts` — FFmpeg-based MP4 recording, segment management, retention cleanup
- `src/main/ipc/recordingHandlers.ts` — recording:start/stop/status/segments/playback/disk-usage
- `src/renderer/components/RecordingIndicator/RecordingIndicator.tsx` — Recording status badge
- `src/renderer/components/TimelineScrubber/TimelineScrubber.tsx` — 24h timeline with event markers + recording segments
- CameraFullscreenView — Playback mode with controls

**Task 11.0 — Analytics Dashboard**
- `src/main/services/AnalyticsService.ts` — Hourly rollup aggregation, heatmap data generation
- `src/main/ipc/analyticsHandlers.ts` — analytics:heatmap/activity/presence/zoneTraffic
- `src/renderer/screens/Analytics/Analytics.tsx` — 4-panel dashboard with date range selector
- `src/renderer/components/analytics/HeatmapPanel.tsx` — SVG grid heatmap
- `src/renderer/components/analytics/ActivityGraph.tsx` — Stacked bar chart
- `src/renderer/components/analytics/PresenceTimeline.tsx` — Per-person horizontal bars
- `src/renderer/components/analytics/ZoneTrafficPanel.tsx` — Zone enter/exit/loiter bars

**Task 12.0 — LLM Daily Reports (Ollama)**
- `src/main/services/OllamaService.ts` — Ollama lifecycle, prompt builder, scheduled daily summary generation
- `src/main/ipc/llmHandlers.ts` — llm:summary/status
- `src/main/services/TelegramService.ts` — `sendTextMessage()` for LLM summary delivery
- EventLog — Daily Summary card when viewing specific date

**Task 13.0 — Liveness Detection + Sound Events**
- `python-sidecar/services/liveness.py` — MiniFASNet ONNX + heuristic fallback (Laplacian + color histogram)
- `python-sidecar/routers/liveness.py` — POST /liveness
- `python-sidecar/services/sound_detection.py` — YAMNet ONNX/TFLite + security class filtering
- `python-sidecar/routers/sound.py` — POST /sound/classify
- `src/main/services/SoundService.ts` — FFmpeg audio extraction, buffering, sidecar classification
- DetectionPipeline — Liveness check on face crops (when liveness_enabled)
- EventProcessor — Sound/liveness event types, CRITICAL Telegram alerts

### Phase 5 — Presidential-Level (Tasks 14.0–17.0) ✅

**Task 14.0 — Cross-Camera Re-ID + Spatial Topology**
- `python-sidecar/services/reid.py` — OSNet-AIN ONNX + heuristic fallback, in-memory gallery, cross-camera matching, clothing colors, height estimation
- `python-sidecar/routers/reid.py` — POST /reid/extract, POST /reid/match, GET /reid/gallery/stats
- `python-sidecar/services/identity_fusion.py` — 4-layer weighted fusion: face=0.5, body=0.25, gait=0.15, soft=0.10
- `src/main/services/TopologyService.ts` — Anomaly detection (skip_detected, transit_violation, disappearance), predictNextCamera(), recordDetection(), floor plan position estimation
- `src/main/services/DetectionPipeline.ts` — Re-ID extraction after YOLO+ByteTrack, globalPersonId/reidMatched/reidSimilarity
- `src/main/ipc/topologyHandlers.ts` — topology:get/save/anomaly
- `src/renderer/screens/Settings/TopologyEditor.tsx` — Visual edge editor
- `src/main/services/ProcessManager.ts` — Re-ID gallery cleanup (1-min interval)
- Health endpoint — reid_loaded, liveness_loaded, sound_loaded, gait_loaded

**Task 15.0 — Floor Plan + Situation Room**
- `src/main/ipc/floorplanHandlers.ts` — floorplan:get/save/positions
- `src/renderer/screens/Settings/FloorPlanEditor.tsx` — Upload image, drag cameras
- `src/renderer/screens/FloorPlan/FloorPlan.tsx` — Live person dots, SVG trails, camera icons, hover tooltips
- `src/renderer/screens/SituationRoom/SituationRoom.tsx` — 4-panel command dashboard: Alerts, Floor Map, Active Feed, Person Status

**Task 16.0 — Gait Recognition + Multi-Layer Identity**
- `python-sidecar/services/gait_recognition.py` — GaitGL ONNX + heuristic (FFT stride, aspect ratio dynamics)
- `python-sidecar/routers/gait.py` — POST /gait/analyze
- `src/main/services/DetectionPipeline.ts` — Gait buffer accumulation (30 frames), runGaitAnalysis()
- `python-sidecar/services/identity_fusion.py` — Activated full 4-layer weights

**Task 17.0 — Intelligent PTZ System**
- `src/main/services/PTZService.ts` — Abstraction layer wrapping TapoAPIService, zoomToTarget(), PID auto-tracking, preset patrol with interrupt/resume, coordinated multi-camera handoff via topology predictions
- `src/main/ipc/ptzHandlers.ts` — ptz:autotrack:start/stop, ptz:patrol:start/stop, ptz:zoom:to, ptz:status
- `src/renderer/screens/Settings/PTZConfig.tsx` — Per-camera PTZ config UI

### Cross-Cutting (Task 18.0) ⚠️

**Task 18.0 — Navigation + Settings Expansion** ⚠️ PARTIALLY COMPLETE
- `src/renderer/components/Sidebar.tsx` — 8 nav items with section dividers ✅
- `src/renderer/App.tsx` — Routing for Analytics, FloorPlan, SituationRoom, ZoneEditor ✅
- `src/renderer/screens/Settings/Settings.tsx` — 8 tabs rendered, but only 8 tab components exist out of 13 planned ⚠️
- **MISSING:** AIConfig.tsx (18.4), RecordingConfig.tsx (18.5), ZoneDefaults.tsx (18.6), LLMConfig.tsx (18.7), SoundDetectionConfig.tsx (18.8) — these 5 sub-tasks were marked [x] in the task plan but the files were never created

---

## 4. Audit Findings — ALL Issues Requiring Resolution

> **INSTRUCTION:** For each issue below, the next session MUST:
> 1. Read the cited file(s) and line numbers
> 2. Confirm the issue still exists (mark CONFIRMED or RESOLVED)
> 3. Only then implement the fix
>
> Issues are numbered with their audit round prefix: `R1-` = Round 1 (original), `R2-` = Round 2 (second audit).

---

### 🔴 CRITICAL Priority (App is actively broken — fix these FIRST)

#### R2-C1: AIBridgeService Frame Dimensions MISMATCH — Corrupts ALL AI Detection
- **File:** `src/main/services/AIBridgeService.ts` (lines 13-14)
- **Verify:** Check `const FRAME_WIDTH = 1920` and `const FRAME_HEIGHT = 1080` on lines 13-14
- **Cross-ref:** `src/main/services/StreamManager.ts` (lines 36-37) uses `1280` × `720`
- **Issue:** StreamManager captures frames at 720p (1280×720) but AIBridgeService's `frameBufferToBase64()` assumes 1080p (1920×1080). When a raw 720p RGB buffer is passed to `sharp`, it tries to interpret it as 1080p data → corrupted JPEG output or crash. The fallback dimension heuristic at lines 183-184 will also calculate wrong dimensions for a 720p buffer.
- **Impact:** EVERY frame sent to the Python sidecar for YOLO/face detection is potentially corrupted. This likely causes face enrollment failures (corrupted images sent to `/enroll`).
- **Fix:** Change lines 13-14 to `const FRAME_WIDTH = 1280; const FRAME_HEIGHT = 720;`

#### R2-C2: CAM-3 IP Address Mismatch Between go2rtc.yaml and DB Seed
- **File:** `go2rtc/go2rtc.yaml` (lines 34-38) — uses `192.168.100.228`
- **File:** `src/main/services/DatabaseService.ts` (line 299) — seeds `192.168.100.215`
- **Verify:** Compare the IP addresses in both files for CAM-3
- **Issue:** go2rtc connects to the camera at `.228` but the database says `.215`. TapoAPIService (used for PTZ control, camera info) reads from the DB and connects to `.215`, while go2rtc streams from `.228`. If the real camera is at `.228`, then PTZ will fail; if it's at `.215`, streaming will fail.
- **Impact:** This is likely why cameras stopped working — one of these IPs is wrong.
- **Fix:** Determine the correct IP and update BOTH files to match.

#### R2-C3: Sound Detection Class-Index Mapping is BROKEN
- **File:** `python-sidecar/services/sound_detection.py` (lines 148-158)
- **Verify:** Read lines 148-158 — look for comments saying "In a real implementation" and "simplified without full class map"
- **Issue:** The `classify_audio()` function takes the global max score across ALL YAMNet output classes and assigns it to EVERY target security class. A "dog bark" detection would score identically to a "gunshot." The code explicitly admits this with inline comments: `# In a real implementation, we'd map idx to class names` and `# This would be replaced with proper YAMNet class index mapping`.
- **Impact:** Even if the YAMNet model file existed, sound classification would return meaningless results.
- **Fix:** Implement proper YAMNet AudioSet ontology class-to-index mapping.

#### R2-C4: SoundService Never Started — Dead Code
- **File:** `src/main/index.ts` (lines 213-287)
- **Verify:** Search for `startSoundService`, `startAudioCapture`, or `SoundService` in the `app.whenReady()` block
- **Issue:** No call to `startSoundService()` or `startAudioCapture()` exists anywhere in the app startup. The SoundService file exists, IPC handlers are registered, but the actual FFmpeg audio extraction + classification loop is never initiated.
- **Impact:** Sound detection is 100% non-functional at runtime.

#### R2-C5: RecordingService Never Started — Dead Code
- **File:** `src/main/index.ts` (lines 213-287)
- **Verify:** Search for `startRecording`, `startRetentionCleanup`, or `RecordingService` in the `app.whenReady()` block
- **Issue:** No call to `startRecording()` for any camera. RecordingService exists, IPC handlers are registered, but FFmpeg recording processes are never spawned.
- **Impact:** Recording is 100% non-functional at runtime. Timeline scrubber will show nothing.

#### R2-C6: AnalyticsService Rollup Never Started — Dead Code
- **File:** `src/main/index.ts` (lines 213-287)
- **Verify:** Search for `startRollup`, `AnalyticsService`, or `analytics` in the `app.whenReady()` block
- **Issue:** The hourly rollup aggregation job is never started. Analytics dashboard queries pre-aggregated data from `analytics_rollup` table, but that table is never populated.
- **Impact:** Analytics dashboard (heatmap, activity, presence timeline, zone traffic) will show empty data.

#### R2-C7: OllamaService Never Started — Dead Code
- **File:** `src/main/index.ts` (lines 213-287)
- **Verify:** Search for `OllamaService`, `ollama`, or `llm` start calls in the `app.whenReady()` block
- **Issue:** Ollama process lifecycle and scheduled daily summary generation are never initiated.
- **Impact:** LLM daily reports will never be generated or sent via Telegram.

#### R2-C8: Hardcoded Camera Credentials in go2rtc.yaml — Security Risk
- **File:** `go2rtc/go2rtc.yaml` (lines 8, 17-18, 37)
- **Verify:** Read the file and check for plaintext passwords
- **Issue:** Real passwords are hardcoded in plaintext in a git-tracked config file:
  - Line 8: `tapo://Magandaako03291993@192.168.100.213`
  - Lines 17-18: `rtsp://Rehj2026:Rehj2026@192.168.100.214:554/stream1`
- **Impact:** Anyone with repo access can see camera credentials. Config is also static — changing cameras in Settings UI has no effect on go2rtc.
- **Fix:** Either generate go2rtc.yaml dynamically from DB camera configs at startup, or move credentials to environment variables.

#### R2-C9: go2rtc Config is STATIC — Not Synced with Database
- **File:** `go2rtc/go2rtc.yaml` vs `src/main/services/Go2RtcService.ts` (lines 30-35)
- **Verify:** Check `CAMERA_STREAM_MAP` in Go2RtcService.ts — it's a hardcoded Record
- **Issue:** go2rtc.yaml is a static file with hardcoded camera IPs and credentials. `Go2RtcService.ts` also has a hardcoded `CAMERA_STREAM_MAP` that only maps 4 specific camera IDs. Changing camera config in the Settings UI writes to the DB but go2rtc still connects to the old hardcoded addresses.
- **Impact:** Camera management in Settings is effectively non-functional for the streaming layer.

---

### 🟠 HIGH Priority (Features broken or incomplete — fix after CRITICAL)

#### R1-H1: `personRowToResponse()` Missing v2.0 Fields
- **File:** `src/main/ipc/personHandlers.ts` (lines 28-39)
- **Verify:** Read the `personRowToResponse()` function — check if it includes `presence_state`, `last_seen_camera_id`, `last_seen_at`, `auto_enroll_count`, `auto_enroll_enabled`, `adaptive_threshold`, `global_person_id`
- **Issue:** Returns only v1.0 fields (id, name, label, enabled, telegramNotify, embeddingsCount, createdAt, updatedAt). All v2.0 fields missing.
- **Impact:** PersonDirectory and PresencePanel show incomplete/stale data.
- **Fix:** Map all v2.0 columns from `PersonRow` to the response object.

#### R1-H2: Event Data Missing v2.0 Fields in `eventHandlers.ts`
- **File:** `src/main/ipc/eventHandlers.ts` (lines 29-44)
- **Verify:** Read the row mapping in lines 29-44 — check if `event_type`, `zone_id`, `track_id`, `journey_id`, `behavior_type`, `sound_event_type`, `sound_confidence`, `identity_method`, `identity_fusion_score`, `global_person_id`, `liveness_score`, `is_live` are included
- **Issue:** Returns only v1.0 event fields. All v2.0 fields missing.
- **Impact:** Event log type badges, zone/journey context, and event type filtering will all render as `undefined`.
- **Fix:** Add all v2.0 columns to the event row mapping.

#### R1-H3: Migration Script Not Idempotent
- **File:** `src/main/database/migrations/v2.0.sql` (lines 12-51)
- **Verify:** Check if `ALTER TABLE ... ADD COLUMN` statements have `IF NOT EXISTS` guards (SQLite does NOT support this natively — needs a workaround)
- **Issue:** If migration runs twice (reinstall without clearing DB), "duplicate column" errors crash the app.
- **Fix:** Add schema_version early-exit guard at top of migration, or wrap each ALTER in a try/catch in the migration runner.

#### R2-H4: 5 Settings Tabs from Task 18.0 are MISSING — Never Created
- **File:** `src/renderer/screens/Settings/` directory
- **Verify:** List files in `src/renderer/screens/Settings/` — check for existence of: `AIConfig.tsx`, `RecordingConfig.tsx`, `ZoneDefaults.tsx`, `LLMConfig.tsx`, `SoundDetectionConfig.tsx`
- **Issue:** Task 18.4-18.8 specified creating these 5 Settings tabs. None of them exist. The `Settings.tsx` file imports `Brain` icon but never uses it. The `SettingsTab` type includes `'recording'` but the switch case has no handler for it.
- **Impact:** Users cannot configure AI settings, recording mode, zone defaults, LLM settings, or sound detection settings through the UI.
- **Fix:** Create all 5 missing Settings tab components and wire them into `Settings.tsx`.

#### R1-H5: Gait Analysis Results Not Persisted
- **File:** `src/main/services/DetectionPipeline.ts` (~line 465)
- **Verify:** Search for `/gait/analyze` call — check if the response embedding is stored via `DatabaseService.createGaitProfile()` or if it's only logged
- **Issue:** Gait embeddings extracted but only logged to console — never stored in `gait_profiles` table. 4-layer identity fusion cannot include gait scores.
- **Fix:** Store embedding via `createGaitProfile()` and include gait similarity in fusion.

#### R1-H6: PTZ Auto-Track Never Receives Position Updates
- **File:** `src/main/services/DetectionPipeline.ts` + `src/main/services/PTZService.ts`
- **Verify:** Search DetectionPipeline for any call to `ptzService.updateTrackPosition()` or `PTZService`
- **Issue:** `updateTrackPosition()` is defined in PTZService but never called from DetectionPipeline. PID auto-tracking controller receives no data.
- **Fix:** Wire DetectionPipeline to call `ptzService.updateTrackPosition()` for person tracks on cameras with active auto-tracking.

#### R1-H7: Patrol State Race Condition
- **File:** `src/main/services/PTZService.ts` (~line 447)
- **Verify:** Read `advancePatrol()` — check if the dwell `setTimeout` callback checks patrol active state before proceeding
- **Issue:** If `stopPatrol()` is called during `advancePatrol()`, the dwell timer may still fire.
- **Fix:** Add `isActive` guard inside the setTimeout callback.

#### R2-H8: 3 TODOs in CameraFullscreenView — Features Non-Functional
- **File:** `src/renderer/screens/CameraFullscreenView/CameraFullscreenView.tsx`
- **Verify:** Search file for `// TODO:` comments
- **Issue:** Three unimplemented features:
  - Line ~133: `// TODO: Find matching segment, load via recording:playback, set playbackVideoRef.src` — Playback scrubbing does nothing
  - Line ~229: `// TODO: Open person detail popup when person detail modal is available` — Clicking detection boxes does nothing
  - Line ~255: `// TODO: Dispatch enrollment, false positive, or PTZ tracking actions` — Context menu actions do nothing
- **Fix:** Implement all three TODO items.

#### R2-H9: ZoneEditor Shows Placeholder Instead of Live Camera Feed
- **File:** `src/renderer/screens/ZoneEditor/ZoneEditor.tsx` (lines 410-413)
- **Verify:** Read lines 410-415 — look for comments about "placeholder"
- **Issue:** Users see a static hexagon icon instead of the actual camera feed. They cannot draw zones on real video.
- **Fix:** Embed WebRTC camera feed or canvas frame in the ZoneEditor drawing area.

#### R2-H10: SituationRoom FloorMap is Placeholder Text
- **File:** `src/renderer/screens/SituationRoom/SituationRoom.tsx` (line ~259)
- **Verify:** Search for "placeholder" or "Mini floor plan" comment
- **Issue:** Shows position count text instead of embedded FloorPlan visualization component.
- **Fix:** Embed the actual FloorPlan component in compact mode.

#### R2-H11: electron-builder Does NOT Include go2rtc in Packaged Build
- **File:** `package.json` (electron-builder config section)
- **Verify:** Check `build.extraResources` — see if `go2rtc` directory is included
- **Issue:** `extraResources` includes `python-sidecar` but NOT `go2rtc/go2rtc.exe` or `go2rtc/go2rtc.yaml`.
- **Impact:** A packaged/distributed build will have NO streaming capability.
- **Fix:** Add `"go2rtc"` to the `extraResources` array.

#### R2-H12: No ONNX Model Files in Repository + No Download Mechanism
- **File:** `python-sidecar/models/` directory
- **Verify:** List files in `python-sidecar/models/` — check for `.onnx` files
- **Issue:** Only `__init__.py`, `.gitkeep`, and `schemas.py` exist. Missing model files:
  - `gaitgl.onnx` — Gait recognition falls back to weak FFT heuristic
  - `minifasnet.onnx` — Liveness falls back to weak Laplacian heuristic
  - `osnet_ain_x1_0.onnx` — Re-ID falls back to weak color histogram
  - `yamnet.onnx` / `yamnet.tflite` — Sound detection completely unavailable
- **Note:** InsightFace `buffalo_l` and YOLOv8s auto-download, so face detection and object detection work.
- **Fix:** Either bundle models, create a download script, or document manual download steps prominently.

#### R1-H13: Task Plan High-Level List Out of Sync (Cosmetic)
- **File:** `tasks/tasks-prd-tapo-cctv-desktop-v2.md` (lines 71-86)
- **Verify:** Check if Tasks 4.0, 5.0, 6.0, 8.0 are still marked `[ ]`
- **Fix:** Update lines 71, 74, 77, 85 to `[x]`.

---

### 🟡 MEDIUM Priority (Degraded but not broken — fix last)

#### R1-M1: Unbounded Gait Buffer Memory Leak
- **File:** `src/main/services/DetectionPipeline.ts`
- **Issue:** `gaitBuffers` Map never cleaned up for disappeared tracks. Memory grows indefinitely.
- **Fix:** Add periodic cleanup matching Re-ID gallery cleanup interval in ProcessManager.

#### R1-M2: Hardcoded Sidecar URL in DetectionPipeline
- **File:** `src/main/services/DetectionPipeline.ts` (~line 448)
- **Issue:** `const baseUrl = 'http://127.0.0.1:8520'` hardcoded instead of using `AIBridgeService.getBaseUrl()`.
- **Fix:** Replace with `AIBridgeService.getBaseUrl()`.

#### R1-M3: Missing Error Boundary in FloorPlan Screen
- **File:** `src/renderer/screens/FloorPlan/FloorPlan.tsx`
- **Issue:** No React ErrorBoundary. Failed floor plan image load crashes the entire screen.
- **Fix:** Wrap in ErrorBoundary component.

#### R1-M4: SituationRoom Poll Interval Too Aggressive
- **File:** `src/renderer/screens/SituationRoom/SituationRoom.tsx` (~line 53)
- **Issue:** 3-second polling for presence + positions. Excessive IPC load.
- **Fix:** Use 5-second interval or event-driven subscriptions.

#### R1-M5: Topology Edge ID Generation Logic Inverted
- **File:** `src/main/ipc/topologyHandlers.ts` (~line 58)
- **Issue:** `edge.id.startsWith('edge-') ? crypto.randomUUID() : edge.id` — replaces IDs incorrectly.
- **Fix:** Change to `!edge.id || edge.id.startsWith('edge-') || edge.id.startsWith('new-')`.

#### R2-M6: `torchreid>=0.2.5` in requirements.txt Pulls ~2GB PyTorch
- **File:** `python-sidecar/requirements.txt` (line 21)
- **Issue:** PyTorch is a massive dependency that may not be used (Re-ID uses ONNX or heuristic fallback).
- **Fix:** Remove if not actually imported at runtime, or make it optional.

#### R2-M7: `electron` in `dependencies` Instead of `devDependencies`
- **File:** `package.json`
- **Issue:** Electron should be in devDependencies; electron-builder handles it for packaging.
- **Fix:** Move to devDependencies.

#### R2-M8: Zero Test Coverage
- **Issue:** No unit tests, integration tests, or E2E tests exist anywhere in the project.
- **Fix:** Add at least smoke tests for critical paths (enrollment, detection pipeline, event creation).

#### R2-M9: Hardcoded Localhost Ports Across 9+ Files
- **Issue:** Ports 8520 (sidecar), 8554 (RTSP), 1984 (go2rtc API) hardcoded across many files. Not configurable without code changes.
- **Fix:** Centralize port configuration in settings or environment variables.

---

## 5. File Inventory — All Files Created/Modified

### Python Sidecar (`python-sidecar/`)

**Services (10):**
- `services/face_detection.py` — InsightFace detection
- `services/face_recognition.py` — InsightFace recognition
- `services/model_loader.py` — ONNX model loading
- `services/enrollment.py` — Face enrollment
- `services/auto_enrollment.py` — Quality-gated auto-enrollment
- `services/object_detection.py` — YOLOv8s + ByteTrack
- `services/adaptive_threshold.py` — Per-person adaptive thresholds
- `services/reid.py` — OSNet-AIN Re-ID + heuristic fallback
- `services/gait_recognition.py` — GaitGL + heuristic fallback
- `services/identity_fusion.py` — 4-layer weighted fusion
- `services/liveness.py` — MiniFASNet + heuristic fallback
- `services/sound_detection.py` — YAMNet + security class filtering

**Routers (13):**
- `routers/health.py`, `routers/detection.py`, `routers/recognition.py`
- `routers/enrollment.py`, `routers/persons.py`, `routers/config_router.py`
- `routers/auto_enrollment.py`, `routers/negative_gallery.py`
- `routers/object_detection.py`, `routers/zone_check.py`
- `routers/reid.py`, `routers/gait.py`
- `routers/liveness.py`, `routers/sound.py`

### Electron Main Process (`src/main/`)

**Services (16):**
- `services/DatabaseService.ts` — All CRUD, migrations, seeding
- `services/DetectionPipeline.ts` — Full AI orchestration pipeline
- `services/EventProcessor.ts` — Event creation, Telegram, journey/presence integration
- `services/AIBridgeService.ts` — Python sidecar HTTP client
- `services/StreamManager.ts` — FFmpeg sub-stream capture
- `services/Go2RtcService.ts` — go2rtc stream URL management
- `services/MotionDetector.ts` — Pixel-diff motion detection (720p)
- `services/ProcessManager.ts` — Sidecar + go2rtc lifecycle
- `services/TelegramService.ts` — Telegram bot integration
- `services/CryptoService.ts` — AES-256-GCM encryption
- `services/TapoAPIService.ts` — Tapo camera ONVIF/API
- `services/ZoneService.ts` — Zone CRUD + zone event engine
- `services/TopologyService.ts` — Topology + anomaly detection
- `services/JourneyService.ts` — Journey tracking lifecycle
- `services/PresenceService.ts` — 5-state presence FSM
- `services/WebRTCService.ts` — WebRTC signaling proxy
- `services/RecordingService.ts` — DVR/NVR FFmpeg recording
- `services/AnalyticsService.ts` — Hourly rollup aggregation
- `services/OllamaService.ts` — LLM daily summary generation
- `services/SoundService.ts` — Audio capture + classification
- `services/PTZService.ts` — PID auto-tracking, patrol, handoff

**IPC Handlers (14):**
- `ipc/aiHandlers.ts`, `ipc/cameraHandlers.ts`, `ipc/eventHandlers.ts`
- `ipc/lineHandlers.ts`, `ipc/personHandlers.ts`, `ipc/ptzHandlers.ts`
- `ipc/settingsHandlers.ts`, `ipc/streamHandlers.ts`, `ipc/telegramHandlers.ts`
- `ipc/zoneHandlers.ts`, `ipc/journeyHandlers.ts`
- `ipc/recordingHandlers.ts`, `ipc/analyticsHandlers.ts`, `ipc/llmHandlers.ts`
- `ipc/topologyHandlers.ts`, `ipc/floorplanHandlers.ts`

### Renderer (`src/renderer/`)

**Screens (9):**
- `screens/Dashboard.tsx` — Camera grid + presence panel
- `screens/CameraFullscreenView/CameraFullscreenView.tsx` — WebRTC + zone overlay + detection overlay + timeline + playback
- `screens/EventLog/EventLog.tsx` — Event list + filters + daily summary
- `screens/PersonDirectory/PersonDirectory.tsx` — Person management
- `screens/Settings/Settings.tsx` — 8 tabs
- `screens/ZoneEditor/ZoneEditor.tsx` — Zone management UI
- `screens/Analytics/Analytics.tsx` — 4-panel analytics dashboard
- `screens/FloorPlan/FloorPlan.tsx` — Live floor map
- `screens/SituationRoom/SituationRoom.tsx` — Command dashboard

**Settings Sub-screens (8 exist, 5 MISSING):**
- ✅ `Settings/TelegramConfig.tsx`, `Settings/RetentionConfig.tsx`
- ✅ `Settings/CameraManagement.tsx`, `Settings/LayoutPreferences.tsx`
- ✅ `Settings/SystemInfo.tsx`, `Settings/TopologyEditor.tsx`
- ✅ `Settings/FloorPlanEditor.tsx`, `Settings/PTZConfig.tsx`
- ❌ `Settings/AIConfig.tsx` — **MISSING** (Task 18.4)
- ❌ `Settings/RecordingConfig.tsx` — **MISSING** (Task 18.5)
- ❌ `Settings/ZoneDefaults.tsx` — **MISSING** (Task 18.6)
- ❌ `Settings/LLMConfig.tsx` — **MISSING** (Task 18.7)
- ❌ `Settings/SoundDetectionConfig.tsx` — **MISSING** (Task 18.8)

**Key Components:**
- `components/DetectionOverlay/DetectionOverlay.tsx` — SVG bounding boxes + trails
- `components/DetectionOverlay/OverlayContextMenu.tsx` — Right-click actions
- `components/PolygonDrawTool/PolygonDrawTool.tsx` — Zone polygon drawing
- `components/TripwireDrawTool/TripwireDrawTool.tsx` — Tripwire line drawing
- `components/PresencePanel/PresencePanel.tsx` — Presence state cards
- `components/RecordingIndicator/RecordingIndicator.tsx` — Recording badge
- `components/TimelineScrubber/TimelineScrubber.tsx` — 24h timeline
- `components/analytics/HeatmapPanel.tsx` — Detection density heatmap
- `components/analytics/ActivityGraph.tsx` — Stacked bar chart
- `components/analytics/PresenceTimeline.tsx` — Per-person state bars
- `components/analytics/ZoneTrafficPanel.tsx` — Zone traffic bars

**Hooks:**
- `hooks/useStreamFrame.ts` — Legacy canvas frame hook
- `hooks/useWebRTCStream.ts` — WebRTC peer connection hook

### Shared
- `src/shared/types.ts` — All TypeScript interfaces + ElectronAPI
- `src/preload/index.ts` — Context bridge with all IPC channels

---

## 6. Database Schema Summary (v2.0)

**Original Tables (v1.0):** cameras, persons, face_embeddings, events, settings

**New Tables (v2.0 migration):**
- `zones` — Zone definitions with geometry (polygon/tripwire)
- `negative_gallery` — False positive rejection entries
- `journeys` — Cross-camera journey tracking
- `presence_history` — Presence state change log
- `topology_edges` — Camera-to-camera connections with transit times
- `recording_segments` — DVR segment metadata
- `reid_gallery` — Re-ID body embeddings per track
- `gait_profiles` — Gait recognition embeddings
- `ptz_presets` — PTZ camera preset positions
- `ptz_patrol_schedules` — Patrol schedule definitions
- `daily_summaries` — LLM-generated daily reports
- `analytics_rollup` — Hourly aggregated metrics
- `floor_plan` — Floor plan image + camera positions

**New Columns on Existing Tables:**
- `cameras` — camera_group_id, camera_role, sub_stream_url, recording_mode, ptz_capabilities
- `persons` — global_person_id, presence_state, auto_enroll_count, auto_enroll_quality_avg, recognition_threshold, tags
- `face_embeddings` — quality_score, is_auto_enrolled, lighting_condition
- `events` — event_type, zone_id, track_id, behavior_type, sound_event_type, sound_confidence, global_person_id, identity_method, identity_fusion_score, journey_id, reid_match_score

---

## 7. Python Sidecar Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health + GPU metrics + model status |
| POST | /detect | Face detection (InsightFace) |
| POST | /recognize | Face recognition |
| POST | /enroll | Manual face enrollment |
| POST | /auto_enroll | Quality-gated auto-enrollment |
| GET/POST/DELETE | /persons/* | Person management |
| GET/POST/DELETE | /negative_gallery/* | Negative gallery CRUD |
| POST | /detect_objects | YOLO + ByteTrack object detection |
| POST | /zone_check | Point-in-polygon zone detection |
| POST | /reid/extract | Body Re-ID embedding extraction |
| POST | /reid/match | Cross-camera Re-ID matching |
| GET | /reid/gallery/stats | Re-ID gallery statistics |
| POST | /gait/analyze | Gait recognition (30+ frames) |
| POST | /liveness | Anti-spoofing liveness check |
| POST | /sound/classify | Audio event classification |
| POST | /config | Runtime configuration update |

---

## 8. IPC Channel Map

**Stream:** stream:start, stream:stop, stream:frame, webrtc:start, webrtc:signal, webrtc:stop
**Recording:** recording:start/stop/status/segments/playback/disk-usage
**Sound:** sound:event (push)
**LLM:** llm:summary, llm:status
**Analytics:** analytics:heatmap/activity/presence/zoneTraffic
**PTZ:** ptz:move/stop/goto-preset/set-preset/get-position/get-capabilities/autotrack:start/stop/patrol:start/stop/zoom:to/status
**AI Detection:** ai:detection (push), ai:objects (push), ai:start/stop/status
**Events:** event:list, event:new (push)
**Persons:** person:enroll/list/delete/toggle, negative:add/list/delete
**Cameras:** camera:list/get/update
**Settings:** settings:get/update
**Telegram:** telegram:config/test/toggle
**Zones:** zone:save/list/get/update/delete, zone:event (push)
**Line Crossing:** line:save/get
**System:** system:status (push)
**Privacy:** privacy:purge-old-events
**Journey:** journey:list/active, journey:update (push)
**Presence:** presence:list/history, presence:update (push)
**Topology:** topology:get/save, topology:anomaly (push)
**Floor Plan:** floorplan:get/save/positions

---

## 9. Action Items for Next Session

> **WORKFLOW:** VERIFY → FIX → TEST. Do not skip verification.

### Step 0 — VERIFY ALL FINDINGS (Do This First)
Read each file cited in Section 4. For every issue:
- Open the file and check the exact lines referenced
- Confirm the issue still exists or mark it RESOLVED
- Report verification results before starting any fixes

### Step 1 — Fix CRITICAL Issues (R2-C1 through R2-C9)
These must be fixed first because the app is actively broken:

| # | Issue | File(s) | One-Line Fix |
|---|-------|---------|--------------|
| 1 | R2-C1 | `AIBridgeService.ts:13-14` | Change 1920×1080 → 1280×720 |
| 2 | R2-C2 | `go2rtc.yaml` + `DatabaseService.ts:299` | Sync CAM-3 IP (verify real IP first!) |
| 3 | R2-C3 | `sound_detection.py:148-158` | Implement proper YAMNet class mapping |
| 4 | R2-C4 | `index.ts` | Add `startAudioCapture()` call |
| 5 | R2-C5 | `index.ts` | Add `startRecording()` call |
| 6 | R2-C6 | `index.ts` | Add `analyticsService.startRollup()` call |
| 7 | R2-C7 | `index.ts` | Add `ollamaService.start()` call |
| 8 | R2-C8 | `go2rtc.yaml` | Remove hardcoded passwords, generate config from DB |
| 9 | R2-C9 | `Go2RtcService.ts:30-35` | Make go2rtc config dynamic from DB |

### Step 2 — Fix HIGH Issues (R1-H1 through R2-H13)
These are integration gaps that prevent features from working:

| # | Issue | File(s) | One-Line Fix |
|---|-------|---------|--------------|
| 10 | R1-H1 | `personHandlers.ts:28-39` | Add v2.0 fields to personRowToResponse() |
| 11 | R1-H2 | `eventHandlers.ts:29-44` | Add v2.0 fields to event row mapping |
| 12 | R1-H3 | `v2.0.sql` | Add idempotency guard |
| 13 | R2-H4 | `Settings/` directory | Create 5 missing Settings tabs |
| 14 | R1-H5 | `DetectionPipeline.ts:~465` | Persist gait embeddings to DB |
| 15 | R1-H6 | `DetectionPipeline.ts` | Wire PTZService.updateTrackPosition() |
| 16 | R1-H7 | `PTZService.ts:~447` | Add isActive guard in patrol timer |
| 17 | R2-H8 | `CameraFullscreenView.tsx` | Implement 3 TODOs |
| 18 | R2-H9 | `ZoneEditor.tsx:410-413` | Add live camera feed |
| 19 | R2-H10 | `SituationRoom.tsx:~259` | Embed FloorPlan component |
| 20 | R2-H11 | `package.json` | Add go2rtc to extraResources |
| 21 | R2-H12 | `python-sidecar/models/` | Add model download script or docs |
| 22 | R1-H13 | `tasks-prd-tapo-cctv-desktop-v2.md` | Mark tasks 4.0,5.0,6.0,8.0 as [x] |

### Step 3 — Fix MEDIUM Issues (R1-M1 through R2-M9)
| # | Issue | One-Line Fix |
|---|-------|--------------|
| 23 | R1-M1 | Add gait buffer cleanup in ProcessManager |
| 24 | R1-M2 | Replace hardcoded sidecar URL with AIBridgeService.getBaseUrl() |
| 25 | R1-M3 | Add React ErrorBoundary to FloorPlan screen |
| 26 | R1-M4 | Increase SituationRoom poll to 5s or event-driven |
| 27 | R1-M5 | Fix topology edge ID generation logic |
| 28 | R2-M6 | Remove torchreid if unused |
| 29 | R2-M7 | Move electron to devDependencies |
| 30 | R2-M8 | Add basic test coverage |
| 31 | R2-M9 | Centralize port configuration |

### Step 4 — Verification After Fixes
1. Run `npx tsc --noEmit` — TypeScript must compile clean
2. Run `npm run dev` — App must launch without crashes
3. Test camera streams — all 4 cameras must show video via WebRTC
4. Test enrollment — upload photo → face detected → person created
5. Test detection pipeline — YOLO boxes appear on camera feed
6. Test event creation — detection creates event in event log with v2.0 fields
7. Test recording — start recording → MP4 segments created
8. Test zone — draw polygon → person enters → zone_enter event
9. Test journey — Gate → Garden → House tracking
10. Test presence — UNKNOWN → AT_GATE → ARRIVING → HOME transitions

---

## 10. Technical Context for New Session

### Build & Run Commands
```bash
# Development
npm run dev           # Start Electron + Vite dev server

# Build
npm run build         # Build all (renderer + main)
npm run build:main    # Build main process (includes migration copy)

# Python sidecar
cd python-sidecar && pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8520

# TypeScript check
npx tsc --noEmit
```

### Key Configuration
- Sidecar runs on `http://127.0.0.1:8520`
- go2rtc runs on `http://127.0.0.1:1984`
- SQLite DB at `{userData}/tapo-cctv.db`
- Recordings at `{userData}/recordings/`
- ONNX models expected in `python-sidecar/models/`:
  - `buffalo_l/` (InsightFace face detection/recognition — **auto-downloads**)
  - `yolov8s.pt` (object detection — **auto-downloads**)
  - `osnet_ain_x1_0.onnx` (Re-ID — **MISSING, uses heuristic fallback**)
  - `gaitgl.onnx` (gait recognition — **MISSING, uses heuristic fallback**)
  - `minifasnet.onnx` (liveness detection — **MISSING, uses heuristic fallback**)
  - `yamnet.onnx` or `yamnet.tflite` (sound classification — **MISSING, completely unavailable**)

### Fallback Strategy
All AI models have heuristic fallbacks when ONNX models are unavailable:
- **Re-ID:** Falls back to color histogram matching (weak under lighting changes)
- **Gait:** Falls back to FFT stride + aspect ratio dynamics (max confidence 0.6)
- **Liveness:** Falls back to Laplacian variance + color spread (beatable with good photo)
- **Sound:** Unavailable without model (reports model_loaded=false) + class mapping broken even if model present (R2-C3)

---

## 11. Issue Count Summary

| Priority | Round 1 | Round 2 | Total |
|----------|---------|---------|-------|
| 🔴 CRITICAL | 0 | 9 | **9** |
| 🟠 HIGH | 8 | 5 | **13** |
| 🟡 MEDIUM | 5 | 4 | **9** |
| **Total** | **13** | **18** | **31** |

---

*Generated by TWO production-readiness audit sessions. All 18 tasks implemented. 9 CRITICAL, 13 HIGH, and 9 MEDIUM issues identified. The next session must VERIFY all findings first, then fix in priority order.*
