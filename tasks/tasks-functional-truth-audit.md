# Technical Execution Plan: Functional Truth Audit (FULL DEEP AUDIT)

Based on PRD: `docs/prd-functional-truth-audit.md`
**Deep source code audit performed:** 2026-03-04 — traced every wiring path end-to-end.

> **Actual DB Setting Keys** discovered in `DatabaseService.seedDefaultSettings()`:
> - Recording: `recording_mode`, `recording_retention_days`, `recording_storage_path`, `recording_segment_duration_min`
> - Sound: `sound_detection_enabled`, `sound_events`, `sound_confidence_threshold`
> - Zones: `zone_default_loiter_sec`, `zone_default_cooldown_sec`
> - AI/Detection: `yolo_confidence`, `detection_threshold`, `recognition_threshold`, `reid_enabled`, `gait_enabled`, `liveness_enabled`
> - Layout: `default_layout`, `mini_ptz_enabled` (**already consumed by Dashboard — NO FIX NEEDED**)

---

## ⚡ DEEP WIRING AUDIT — Source Code Truth Report

**Method:** Every service file, router, IPC handler, preload channel, and renderer call was traced line-by-line. NOT inferred from docs.

### ✅ CONFIRMED WORKING END-TO-END (code traced from trigger to output)

| # | Feature | Trigger → Output Chain | Evidence |
|---|---------|----------------------|----------|
| 1 | **YOLO + ByteTrack** | MotionDetector → DetectionPipeline → AIBridge.detectObjects() → `POST /detect_objects` → object_detection.py + tracker.py → tracked objects with track_id | `DetectionPipeline.ts:170-207`, `AIBridgeService.ts:379-409`, `object_detection.py:48` |
| 2 | **Face Detection** | DetectionPipeline (person found) → AIBridge.detectFaces() → `POST /detect` → detection.py → InsightFace + CLAHE | `DetectionPipeline.ts:305-308`, `AIBridgeService.ts:266-296`, `detection.py:48` |
| 3 | **Face Recognition** | DetectionPipeline → AIBridge.recognizeFace() → `POST /recognize` → recognition.py → cosine match | `DetectionPipeline.ts:310-337`, `AIBridgeService.ts:298-325`, `recognition.py:23` |
| 4 | **Re-ID Extraction** | DetectionPipeline → cropPerson → AIBridge.extractReID() → `POST /reid/extract` → reid.py → gallery add + cross-cam match | `DetectionPipeline.ts:220-253`, `AIBridgeService.ts:554-590`, `reid.py:29` |
| 5 | **Gait Analysis** | DetectionPipeline gait buffer (30 frames) → runGaitAnalysis() → `POST /gait/analyze` → gait.py | `DetectionPipeline.ts:256-298`, `DetectionPipeline.ts:483-540`, `gait.py:33` |
| 6 | **Zone Detection** | DetectionPipeline → zoneService.checkZones() + checkLoitering() (TypeScript native, ray-casting) | `DetectionPipeline.ts:341-361`, `ZoneService.ts:87-109` |
| 7 | **Event Processing** | DetectionPipeline → eventProcessor.processDetectionResult() → snapshot + DB + IPC + Telegram | `DetectionPipeline.ts:385`, `EventProcessor.ts:355-380` |
| 8 | **Journey Tracking** | EventProcessor (known face) → journeyService.processDetection() → topology validate → DB + IPC | `EventProcessor.ts:358-363`, `JourneyService.ts` |
| 9 | **Presence FSM** | EventProcessor (known face) → presenceService.processDetection() → FSM transition → DB + IPC + Telegram | `EventProcessor.ts:370-375`, `PresenceService.ts` |
| 10 | **Topology** | JourneyService/PresenceService → topologyService.isTransitTimeValid() + getExpectedNextCameras() | `TopologyService.ts:90-160` |
| 11 | **Telegram Alerts** | EventProcessor → telegramService.sendAlert() with throttling + bundling | `TelegramService.ts:158-183` |
| 12 | **Auto-Enrollment** | EventProcessor → AIBridge.autoEnroll() → `POST /auto_enroll` → auto_enrollment.py | `auto_enrollment.py:18` |
| 13 | **Negative Gallery** | personHandlers IPC → AIBridge.addNegative()/listNegatives()/deleteNegative() → `/negative/*` | `AIBridgeService.ts:443-505`, `negative_gallery.py:26-84` |
| 14 | **Embedding Sync** | index.ts startup + personHandlers → AIBridge.syncEmbeddingsToSidecar() → `POST /embeddings/sync` | `index.ts:285-314`, `AIBridgeService.ts:640-673`, `embeddings_sync.py:36` |
| 15 | **Sound Detection** | SoundService → FFmpeg audio → `POST /sound/classify` → sound.py → IPC event | `SoundService.ts:69-138`, `sound.py:39` |
| 16 | **Recording** | RecordingService → FFmpeg → segments DB → retention cleanup | `RecordingService.ts:66-148` |
| 17 | **Analytics Rollup** | AnalyticsService hourly timer → SQL aggregation → analytics_rollup table | `AnalyticsService.ts:58-126` |
| 18 | **Ollama Summaries** | OllamaService scheduler → buildDailySummaryPrompt() → `POST /api/generate` → DB + Telegram | `OllamaService.ts:113-149, 154-200` |
| 19 | **WebRTC Display** | WebRTCService → go2rtc signaling → renderer `<video>` | `WebRTCService.ts:57-80`, `Go2RtcService.ts` |
| 20 | **PTZ Control** | PTZService → TapoAPIService → camera HTTP API | `PTZService.ts:121-160`, `TapoAPIService.ts:78-80` |
| 21 | **PTZ Auto-Track** | DetectionPipeline → ptzService.updateTrackPosition() → PID controller → move | `DetectionPipeline.ts:389-398`, `PTZService.ts` |
| 22 | **Motion Detection** | StreamManager → MotionDetector.processFrame() → pixel diff → emit 'motionDetected' | `MotionDetector.ts:70-100` |
| 23 | **Stream Manager** | index.ts → streamManager.startStream() → FFmpeg 720p RGB24 → MotionDetector | `index.ts:256-281`, `StreamManager.ts:66-80` |
| 24 | **Telephoto Burst** | DetectionPipeline → triggerTeleBurst() (reads `burst_capture_enabled`) | `DetectionPipeline.ts:401-404, 635-638` |

### 🔴 DEAD CODE — Built But NEVER Called From Pipeline

| # | Feature | What Exists | What's Missing | Impact |
|---|---------|------------|----------------|--------|
| D1 | **Liveness Detection** | `python-sidecar/services/liveness.py` (MiniFASNet ONNX + heuristic), `POST /liveness` router, DB columns (`liveness_score`, `is_live`), DB settings (`liveness_enabled`, `liveness_threshold`), UI toggle in AIConfig | **AIBridgeService has NO function to call `/liveness`.** DetectionPipeline NEVER calls liveness check. | Anti-spoofing is completely non-functional. Setting toggle is cosmetic only. |
| D2 | **Identity Fusion** | `python-sidecar/services/identity_fusion.py` (4-layer weighted fusion), DB columns (`identity_method`, `identity_fusion_score`) | **NO router endpoint** for identity fusion in any Python router file. DetectionPipeline NEVER calls fusion. Python service is orphaned. | Multi-modal fusion (face+body+gait+soft) is completely non-functional. |
| D3 | **Python Zone Check** | `python-sidecar/routers/zone_check.py` (`POST /zone_check`), `AIBridgeService.zoneCheck()` function | **NEVER called** — `DetectionPipeline` uses `ZoneService.ts` (TypeScript native ray-casting) instead | Duplicate implementation. Python zone_check is dead code. No impact — TS version works. |
| D4 | **Python Persons CRUD** | `python-sidecar/routers/persons.py` (`GET /persons`, `PUT /person/{id}`, `DELETE /person/{id}`) | **NEVER called from Electron** — person management is handled entirely by `DatabaseService.ts` + `personHandlers.ts` IPC | Duplicate implementation. No impact. |

### 🟡 BROKEN WIRING — Code Exists But Settings Silently Ignored

| # | Feature | What's Broken | Root Cause | Impact |
|---|---------|--------------|------------|--------|
| B1 | **yolo_confidence setting** | UI saves `yolo_confidence` (or `ai.detectionConfidence`). DetectionPipeline calls `AIBridge.detectObjects()` but **passes NO confidence threshold**. Python sidecar uses hardcoded default (0.4). | `DetectionPipeline.ts` never reads `yolo_confidence` setting. `detectObjects()` in AIBridgeService sends no threshold param. | User changes YOLO confidence in Settings → nothing happens. |
| B2 | **recognition_threshold setting** | UI saves `recognition_threshold`. But `AIBridge.recognizeFace()` **hardcodes threshold to 0.6** (line 315: `threshold: threshold ?? 0.6`). DetectionPipeline passes no threshold arg. | Hardcoded default in AIBridgeService. Pipeline never reads DB setting. | User changes face recognition threshold → nothing happens. |
| B3 | **gait_enabled setting** | DB seeds `gait_enabled: 'false'`. DetectionPipeline does gait buffer accumulation on ALL person tracks. **NEVER checks `gait_enabled`**. | Missing `getSetting('gait_enabled')` check before gait accumulation (around line 256). | Gait runs unconditionally even when user disables it. Wastes compute. |
| B4 | **Recording config keys** | UI writes `recording.defaultMode` but RecordingService reads `recording_mode` | Key format mismatch (dot vs underscore). See Task 1.0 below. | Recording settings ignored. |
| B5 | **Sound config keys** | UI writes `sound.enabled` but SoundService reads `sound_detection_enabled`. Also NO_LOAD on mount. | Key format mismatch + missing useEffect. See Task 2.0 below. | Sound settings ignored. |
| B6 | **Zone defaults** | ZoneDefaults saves but never loads on mount. ZoneEditor uses hardcoded `EMPTY_DRAFT`. | Missing useEffect + no consumption. See Task 3.0 below. | Zone defaults ignored. |
| B7 | **AI Config keys** | UI writes `ai.detectionConfidence` but pipeline reads `yolo_confidence` (and even then doesn't use it — see B1) | Multiple layers of disconnect. See Task 5.0 below. | All AI settings ignored. |

### IPC Wiring Verification

| Layer | Count | Status |
|-------|-------|--------|
| **IPC Handler Groups** registered in `index.ts` | 16 | ✅ All registered |
| **Preload Namespaces** in `preload/index.ts` | 21 | ✅ All exposed |
| **Services Started** in `index.ts` | go2rtc, streamManager, sidecar, detectionPipeline, journeyService, presenceService, topologyService, soundService, recording, analyticsRollup, summaryScheduler, expiryCleanup, embeddingsSync, telegramService | ✅ All started |
| **Services Shutdown** in `window-all-closed` | detectionPipeline, topologyService, expiryCleanup, soundService, recordings, retentionCleanup, analyticsRollup, summaryScheduler, streamManager, telegramService, sidecar, go2rtc, database | ✅ All stopped |

### Python Sidecar Endpoint Verification

| AIBridgeService Function | Calls Endpoint | Sidecar Router | Match? |
|-------------------------|---------------|----------------|--------|
| `detectFaces()` | `POST /detect` | `detection.py:48` | ✅ |
| `recognizeFace()` | `POST /recognize` | `recognition.py:23` | ✅ |
| `detectObjects()` | `POST /detect_objects` | `object_detection.py:48` | ✅ |
| `enrollPerson()` | `POST /enroll` | `enrollment.py:20` | ✅ |
| `autoEnroll()` | `POST /auto_enroll` | `auto_enrollment.py:18` | ✅ |
| `addNegative()` | `POST /negative/add` | `negative_gallery.py:26` | ✅ |
| `listNegatives()` | `GET /negative/list` | `negative_gallery.py:57` | ✅ |
| `deleteNegative()` | `DELETE /negative/{id}` | `negative_gallery.py:83` | ✅ |
| `extractReID()` | `POST /reid/extract` | `reid.py:29` | ✅ |
| `matchReID()` | `POST /reid/match` | `reid.py:91` | ✅ |
| `syncEmbeddingsToSidecar()` | `POST /embeddings/sync` | `embeddings_sync.py:36` | ✅ |
| `checkHealth()` | `GET /health` | `health.py:23` | ✅ |
| `updateSidecarConfig()` | `POST /config` | `config_router.py:19` | ✅ |
| `zoneCheck()` | `POST /zone_check` | `zone_check.py:106` | ✅ but **never called** (D3) |
| `runGaitAnalysis()` (in Pipeline) | `POST /gait/analyze` | `gait.py:33` | ✅ |
| SoundService direct fetch | `POST /sound/classify` | `sound.py:39` | ✅ |
| — | `POST /liveness` | `liveness.py:29` | ✅ exists but **never called** (D1) |

### UI Screen Verification

| Screen | Renders? | IPC Calls Work? | Data Flow Complete? | Issues |
|--------|----------|----------------|-------------------|--------|
| **Dashboard** | ✅ | camera:list, settings:get, system:status push | ✅ | None |
| **Camera Fullscreen** | ✅ | webrtc:start, recording:segments, zone:list | ✅ | None |
| **Event Log** | ✅ | event:list, event:new subscription | ✅ | None |
| **Person Directory** | ✅ | person:list/enroll/delete/toggle/negative-* | ✅ | None |
| **Zone Editor** | ✅ | zone:save/list/delete, camera:list | ⚠️ | Zone defaults not inherited (B6) |
| **Analytics** | ✅ | analytics:heatmap/activity/presence/zoneTraffic | ⚠️ | Empty state UX poor (Task 6.0) |
| **Floor Plan** | ✅ | floorplan:get/positions | ⚠️ | Click navigation = console.log only (Task 7.0) |
| **Situation Room** | ⚠️ | zone:event, topology:anomaly, presence:list | ❌ | Active Feed = placeholder, Floor Map = hardcoded (Task 4.0) |
| **Settings** | ✅ | settings:get/set | ⚠️ | Multiple key mismatches (Tasks 1-5, 8) |

## Primary Files Affected

### Renderer (Settings)
- `src/renderer/screens/Settings/RecordingConfig.tsx`
- `src/renderer/screens/Settings/SoundDetectionConfig.tsx`
- `src/renderer/screens/Settings/ZoneDefaults.tsx`
- `src/renderer/screens/Settings/AIConfig.tsx`
- `src/renderer/screens/Settings/LLMConfig.tsx`

### Renderer (Screens)
- `src/renderer/screens/SituationRoom/SituationRoom.tsx`
- `src/renderer/screens/FloorPlan/FloorPlan.tsx`
- `src/renderer/screens/Analytics/Analytics.tsx`
- `src/renderer/components/analytics/HeatmapPanel.tsx`
- `src/renderer/components/analytics/ActivityGraph.tsx`
- `src/renderer/components/analytics/PresenceTimeline.tsx`
- `src/renderer/components/analytics/ZoneTrafficPanel.tsx`

### Renderer (Navigation)
- `src/renderer/App.tsx`

### Main Process (Screens)
- `src/renderer/screens/ZoneEditor/ZoneEditor.tsx`

---

## Detailed Execution Plan

---

### Task 1.0 — P0: Fix Recording Config Key Mismatch [COMPLEXITY: Simple]

> **WHY:** User configures recording mode/settings in UI but RecordingService reads different DB keys. Settings are silently ignored.

**Files:** `src/renderer/screens/Settings/RecordingConfig.tsx`

- [ ] 1.1 **Align setting keys to match DB seed keys.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Change UI to read/write the actual keys from `seedDefaultSettings()`:
    - `recording.defaultMode` → `recording_mode`
    - `recording.segmentDurationSec` → `recording_segment_duration_min` (convert sec→min in UI: `value / 60` on save, `value * 60` on load)
    - `recording.maxStorageGb` → keep as `recording.maxStorageGb` but add note "(not yet consumed by service)"
    - `recording.preRecordSec` → keep but mark as future
    - `recording.postRecordSec` → keep but mark as future
    - `recording.outputFormat` → keep but mark as future
  - Update the `useEffect` load to read from `recording_mode`, `recording_segment_duration_min`, `recording_retention_days`, `recording_storage_path`
  - Update `handleSave` to write to the correct keys with correct units

- [ ] 1.2 **Add `useEffect` load for all available keys.** [APPLIES RULES: `3-code-quality-checklist`]
  - Load: `recording_mode`, `recording_segment_duration_min` (×60 → display as sec), `recording_retention_days`, `recording_storage_path`
  - For keys with no DB seed (`preRecordSec`, `postRecordSec`, `maxStorageGb`, `outputFormat`): save under `recording_*` underscore format for future service consumption

- [ ] 1.3 **Add visual indicators for "not yet consumed" settings.** [APPLIES RULES: `ui-interaction-a11y-perf`]
  - Add a subtle `(planned)` label next to Pre-Record, Post-Record, Max Storage, Output Format fields
  - These save correctly but RecordingService doesn't read them yet

- [ ] 1.T **VERIFICATION — Recording Config round-trip test**
  > **How to test:** Run `npm run dev`. Open Settings → Recording.
  > 1. Change "Default Recording Mode" to **Continuous**. Click Save.
  > 2. Close and reopen Settings → Recording tab.
  >
  > **Expected in UI:** Mode dropdown shows "Continuous" (not "Motion-Triggered").
  >
  > **Expected in terminal (Electron main process):**
  > ```
  > [IPC][settings:set] key=recording_mode value=continuous
  > ```
  > If you see `recording_mode` (not `recording.defaultMode`) in terminal → keys are aligned.
  >
  > **Also verify:** Change segment duration to 600 sec, save. Check terminal:
  > ```
  > [IPC][settings:set] key=recording_segment_duration_min value=10
  > ```
  > (600 sec ÷ 60 = 10 min). If both pass → **TASK 1.0 DONE**.

---

### Task 2.0 — P0: Fix Sound Detection Config (No Load + Key Mismatch) [COMPLEXITY: Simple]

> **WHY:** Sound settings never load saved values (always shows defaults) and saves under wrong keys that SoundService ignores.

**Files:** `src/renderer/screens/Settings/SoundDetectionConfig.tsx`

- [ ] 2.1 **Add `useEffect` to load persisted values on mount.** [APPLIES RULES: `3-code-quality-checklist`]
  - Read `sound_detection_enabled` → map to `enabled` checkbox
  - Read `sound_confidence_threshold` → map to confidence slider
  - Read `sound_events` → parse comma-separated string, map to individual checkbox states
    - e.g. `"glass_break,gunshot,scream"` → `glassBreakEnabled=true, gunshotEnabled=true, screamEnabled=true, dogBarkEnabled=false, hornEnabled=false`
  - For `cooldownSec` and `alertOnDetection`: read from `sound_cooldown_sec` and `sound_alert_on_detection` (new keys, saved for future use)

- [ ] 2.2 **Align save keys to match SoundService.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - `sound.enabled` → `sound_detection_enabled`
  - `sound.confidenceThreshold` → `sound_confidence_threshold`
  - Build `sound_events` string from enabled checkboxes: join enabled class names with comma
  - `sound.cooldownSec` → `sound_cooldown_sec`
  - `sound.alertOnDetection` → `sound_alert_on_detection`

- [ ] 2.T **VERIFICATION — Sound Config load + save round-trip**
  > **How to test:** Run `npm run dev`. Open Settings → Sound.
  > 1. **Uncheck** "Enable sound detection (YAMNet)". **Uncheck** "Dog Bark". Click Save.
  > 2. Navigate away (e.g., to Dashboard), then back to Settings → Sound.
  >
  > **Expected in UI:**
  > - "Enable sound detection" checkbox is **unchecked**
  > - "Dog Bark" checkbox is **unchecked**
  > - Other checkboxes (Glass Break, Gunshot, Scream) remain **checked**
  >
  > **Expected in terminal:**
  > ```
  > [IPC][settings:set] key=sound_detection_enabled value=false
  > [IPC][settings:set] key=sound_events value=glass_break,gunshot,scream
  > ```
  > Note: `dog_bark` is NOT in the `sound_events` list.
  >
  > If UI state persists across navigation AND terminal shows correct keys → **TASK 2.0 DONE**.

---

### Task 3.0 — P0: Fix Zone Defaults (No Load + ZoneEditor No Consume) [COMPLEXITY: Simple]

> **WHY:** Zone default settings never load on mount (always hardcoded), and ZoneEditor ignores saved defaults when creating new zones.

**Files:** `src/renderer/screens/Settings/ZoneDefaults.tsx`, `src/renderer/screens/ZoneEditor/ZoneEditor.tsx`

- [ ] 3.1 **Add `useEffect` to ZoneDefaults to load persisted values on mount.** [APPLIES RULES: `3-code-quality-checklist`]
  - Read from actual DB keys:
    - `zone_default_loiter_sec` → `loiterThresholdSec`
    - `zone_default_cooldown_sec` → `loiterCooldownSec`
  - For color and radius keys: use `zone_default_movement_radius`, `zone_color_restricted`, etc. (save under these keys for consistency)
  - Fallback to `DEFAULT_SETTINGS` if keys not found

- [ ] 3.2 **Align ZoneDefaults save to use correct DB keys.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - `zone.loiterThresholdSec` → `zone_default_loiter_sec`
  - `zone.loiterCooldownSec` → `zone_default_cooldown_sec`
  - `zone.loiterMovementRadius` → `zone_default_movement_radius`
  - `zone.defaultAlertEnabled` → `zone_default_alert_enabled`
  - Colors: `zone_color_restricted`, `zone_color_monitored`, `zone_color_counting`, `zone_color_tripwire`

- [ ] 3.3 **Make ZoneEditor read zone defaults when creating a new zone.** [APPLIES RULES: `3-code-quality-checklist`]
  - In `handleNewZone()`, before setting draft state, read:
    - `zone_default_loiter_sec`, `zone_default_cooldown_sec`, `zone_default_movement_radius`, `zone_default_alert_enabled`
  - Merge into the draft (override `EMPTY_DRAFT` values)
  - Use async read with fallback to `EMPTY_DRAFT` constants if settings unavailable

- [ ] 3.T **VERIFICATION — Zone defaults persist + consumed by editor**
  > **How to test:** Run `npm run dev`.
  > 1. Open Settings → Zones. Change "Loiter Threshold" to **45**. Click Save.
  > 2. Close and reopen Settings → Zones.
  >
  > **Expected in UI:** Loiter Threshold shows **45** (not 15).
  >
  > **Expected in terminal:**
  > ```ide (ENTER/EXIT).
  - **Heuristic fallback:** Frame-edge detection when no line is configured.
  > [IPC][settings:set] key=zone_default_loiter_sec value=45
  > ```
  >
  > 3. Now open **Zone Editor**. Select a camera. Click **"Restricted"** to add new zone.
  > 4. Look at the properties panel on the left.
  >
  > **Expected:** "Loiter threshold (sec)" field shows **45** (inherited from saved default, not hardcoded 15).
  >
  > If both persist AND ZoneEditor inherits → **TASK 3.0 DONE**.

---

### Task 4.0 — P1: Fix Situation Room (Active Feed + Floor Map) [COMPLEXITY: Complex]

> **WHY:** Two of four Situation Room panels are non-functional. Active Feed is a placeholder. Floor Map uses hardcoded camera positions instead of actual floor plan data.

**Files:** `src/renderer/screens/SituationRoom/SituationRoom.tsx`

- [ ] 4.1 **Replace Active Feed placeholder with real WebRTC stream.** [APPLIES RULES: `4-code-modification-safety-protocol`, `ui-interaction-a11y-perf`]
  - Import `useWebRTCStream` hook
  - When `selectedCamera` is set, call `useWebRTCStream(selectedCamera)` and render `<video>` element
  - When no camera selected, show current "Select a camera" message
  - Add camera selection: clicking an alert sets `selectedCamera` to `alert.cameraId`, clicking a person entry sets it to `person.lastCameraId`
  - Handle null/disconnected states gracefully (show "Connecting..." or "Disconnected")

- [ ] 4.2 **Replace hardcoded Floor Map with real floor plan data.** [APPLIES RULES: `3-code-quality-checklist`]
  - On mount, call `window.electronAPI.floorplan.get()` to load floor plan config
  - If floor plan image exists: render `<img>` with camera markers at their stored `floorX/floorY` positions
  - If no floor plan configured: show current SVG grid fallback BUT add hint text: "Configure in Settings → Floor Plan"
  - Overlay person position dots from existing `positions` state using camera floorX/floorY as base coords (same approach as FloorPlan.tsx)

- [ ] 4.3 **Wire alert/person clicks to camera selection.** [APPLIES RULES: `ui-interaction-a11y-perf`]
  - Clicking an alert row → `setSelectedCamera(alert.cameraId)`
  - Clicking a person status row → `setSelectedCamera(person.lastCameraId)`
  - Clicking a camera icon on floor map → `setSelectedCamera(cameraId)`
  - Visual: highlight selected camera on floor map

- [ ] 4.T **VERIFICATION — Situation Room panels functional**
  > **How to test:** Run `npm run dev`. Ensure at least one camera is configured and go2rtc is running.
  > 1. Open **Situation Room**.
  >
  > **Floor Map panel check:**
  > - If floor plan is configured (Settings → Floor Plan): you should see the floor plan image with camera dots at correct positions.
  > - If NOT configured: you should see the grid fallback with text "Configure in Settings → Floor Plan".
  >
  > **Active Feed panel check:**
  > 2. The panel initially shows "Select a camera or click a person on the map".
  > 3. Click a camera icon on the floor map (or if alerts are flowing, click an alert).
  >
  > **Expected in terminal:**
  > ```
  > [WebRTC] Starting stream for CAM-1
  > ```
  >
  > **Expected in UI:** The Active Feed panel shows a **live video stream** from the selected camera (not placeholder text).
  >
  > 4. Click a different camera → stream switches.
  >
  > **Also verify:** Alerts panel and Person Status panel continue working as before (no regression).
  >
  > If Active Feed shows live video AND Floor Map uses real data → **TASK 4.0 DONE**.

---

### Task 5.0 — P1: Fix AI Config → Pipeline Key Alignment + Health Display [COMPLEXITY: Complex]

> **WHY:** AI settings save under `ai.*` prefix but pipeline reads keys like `yolo_confidence`, `detection_threshold`, `reid_enabled`. User tunes thresholds but pipeline ignores them.

**Files:** `src/renderer/screens/Settings/AIConfig.tsx`

> **Actual DB keys consumed by pipeline** (from `seedDefaultSettings` + `DetectionPipeline.ts`):
> | UI field | Must read/write DB key |
> |----------|----------------------|
> | YOLO Detection Confidence | `yolo_confidence` |
> | Face Recognition Confidence | `recognition_threshold` |
> | Re-ID Enabled | `reid_enabled` |
> | Re-ID Threshold | `reid_face_weight` |
> | Gait Enabled | `gait_enabled` |
> | Liveness Enabled | `liveness_enabled` |
> | Max Concurrent Inference | `max_concurrent_inference` (new, not yet consumed) |
> | Inference Device | `gpu_enabled` (maps "cuda"→"true", "cpu"→"false") |

- [ ] 5.1 **Align AIConfig read/write keys to match actual DB keys.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Replace `ai.detectionConfidence` → `yolo_confidence`
  - Replace `ai.faceConfidence` → `recognition_threshold`
  - Replace `ai.reidEnabled` → `reid_enabled`
  - Replace `ai.reidThreshold` → `reid_face_weight`
  - Replace `ai.gaitEnabled` → `gait_enabled`
  - Replace `ai.livenessEnabled` → `liveness_enabled`
  - Replace `ai.inferenceDevice` → `gpu_enabled` (map: `cuda` ↔ `true`, `cpu` ↔ `false`)
  - `ai.maxConcurrentInference` → save as `max_concurrent_inference` (mark as "planned")

- [ ] 5.2 **Add sidecar health status card.** [APPLIES RULES: `ui-foundation-design-system`]
  - On mount, call `window.electronAPI.system.getStatus()` to get AI service status + GPU state
  - Display a status card at top of AI Config:
    - AI Service: `Healthy` / `Starting` / `Unhealthy` / `Stopped` (with color-coded dot)
    - GPU: `Enabled` / `Disabled (CPU mode)`
  - Refresh on save (in case user toggled GPU)

- [ ] 5.3 **Add a pipeline config log line in DetectionPipeline for verification.** [APPLIES RULES: `3-code-quality-checklist`]
  - In `DetectionPipeline.start()`, after `this.isRunning = true`, log:
    ```
    console.log(`[DetectionPipeline] Config: yolo_confidence=${getSetting('yolo_confidence')}, recognition_threshold=${getSetting('recognition_threshold')}, reid=${getSetting('reid_enabled')}`);
    ```
  - This is for verification only — confirms pipeline reads updated values

- [ ] 5.T **VERIFICATION — AI Config alignment + health display**
  > **How to test:** Run `npm run dev`.
  > 1. Open Settings → AI.
  >
  > **Health card check:**
  > - At top of AI Config, you should see a status line like:
  >   `AI Service: Healthy | GPU: Enabled`
  >   (or `Stopped` / `Disabled` depending on state)
  >
  > 2. Change "YOLO Detection Confidence" to **0.8**. Click Save.
  >
  > **Expected in terminal:**
  > ```
  > [IPC][settings:set] key=yolo_confidence value=0.8
  > ```
  > (NOT `ai.detectionConfidence`)
  >
  > 3. If DetectionPipeline is running (cameras streaming), check for config log on next pipeline cycle:
  > ```
  > [DetectionPipeline] Config: yolo_confidence=0.8, recognition_threshold=...
  > ```
  >
  > If health card renders AND terminal shows correct key AND pipeline reads new value → **TASK 5.0 DONE**.

---

### Task 6.0 — P2: Analytics Empty State UX + Pipeline Status [COMPLEXITY: Simple]

> **WHY:** Empty analytics panels look broken. Users can't distinguish "no data yet" from "something is broken". Adding hints + pipeline status eliminates confusion.

**Files:**
- `src/renderer/components/analytics/HeatmapPanel.tsx`
- `src/renderer/components/analytics/ActivityGraph.tsx`
- `src/renderer/components/analytics/PresenceTimeline.tsx`
- `src/renderer/components/analytics/ZoneTrafficPanel.tsx`
- `src/renderer/screens/Analytics/Analytics.tsx`

- [ ] 6.1 **Add prerequisite hint text to each panel's empty state.** [APPLIES RULES: `ui-interaction-a11y-perf`]
  - **HeatmapPanel:** "No detection data for this period" → add subtext: *"Detections with bounding boxes populate this view. Ensure the AI pipeline is running with cameras streaming."*
  - **ActivityGraph:** "No activity data for this period" → add subtext: *"Hourly rollups aggregate detection counts. Data appears after the first hour of AI pipeline operation."*
  - **PresenceTimeline:** "No presence data for this period" → add subtext: *"Enroll persons in Person Directory and enable presence tracking to see timeline segments."*
  - **ZoneTrafficPanel:** "No zone traffic data for this period" → add subtext: *"Define zones in the Zone Editor and run the AI pipeline to generate zone entry/exit events."*

- [ ] 6.2 **Add pipeline health indicator in Analytics header.** [APPLIES RULES: `ui-foundation-design-system`]
  - In `Analytics.tsx` header, next to the date navigation, add a small status dot:
    - Call `window.electronAPI.system.getStatus()` on mount
    - Green dot + "AI Running" if `aiServiceStatus === 'healthy'`
    - Red dot + "AI Offline" if unhealthy/stopped
    - Amber dot + "AI Starting" if starting

- [ ] 6.T **VERIFICATION — Analytics empty states + pipeline indicator**
  > **How to test:** Run `npm run dev`. Open **Analytics** screen.
  >
  > **Pipeline indicator check:**
  > - In the header bar (next to date selector), you should see either:
  >   - 🟢 "AI Running" (if sidecar is healthy)
  >   - 🔴 "AI Offline" (if sidecar is not running)
  >
  > **Empty state check:**
  > - Navigate to a date with no events (e.g., far future date).
  > - Each of the 4 panels should show:
  >   1. **Heatmap:** "No detection data for this period" + prerequisite hint
  >   2. **Activity:** "No activity data for this period" + prerequisite hint
  >   3. **Presence:** "No presence data for this period" + prerequisite hint
  >   4. **Zone Traffic:** "No zone traffic data for this period" + prerequisite hint
  >
  > If all 4 panels show helpful hints AND pipeline dot is visible → **TASK 6.0 DONE**.

---

### Task 7.0 — P2: Floor Plan Click Navigation [COMPLEXITY: Simple]

> **WHY:** Clicking persons/cameras on floor plan logs to console but doesn't navigate anywhere. User expects to jump to camera fullscreen view.

**Files:** `src/renderer/screens/FloorPlan/FloorPlan.tsx`, `src/renderer/App.tsx`

- [ ] 7.1 **Add navigation callback prop to FloorPlan.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Add `onOpenFullscreen?: (camera: { cameraId: string; label: string; model: string; hasPtz: boolean }) => void` prop
  - In `handleCameraClick`, call `onOpenFullscreen` with the camera info
  - In `handlePersonClick`, find the camera the person is on and call `onOpenFullscreen`

- [ ] 7.2 **Wire FloorPlan in App.tsx to pass `onOpenFullscreen` callback.** [APPLIES RULES: `3-code-quality-checklist`]
  - In `App.tsx`, the `floor-plan` case, pass `handleOpenFullscreen` (already exists for Dashboard) to FloorPlan:
    ```tsx
    <FloorPlan onOpenFullscreen={handleOpenFullscreen} />
    ```
  - FloorPlan needs to look up full camera info (label, model, hasPtz) from its loaded camera list

- [ ] 7.T **VERIFICATION — Floor Plan click navigation**
  > **How to test:** Run `npm run dev`. Ensure floor plan is configured (Settings → Floor Plan with image + cameras positioned).
  > 1. Open **Floor Plan** screen.
  > 2. Click a **camera icon** on the map.
  >
  > **Expected:** App navigates to that camera's **fullscreen view** (same view as double-clicking a camera tile on Dashboard).
  >
  > **Expected in terminal:**
  > ```
  > [FloorPlan] Navigating to fullscreen: CAM-1
  > ```
  >
  > 3. Click the **Back** button in fullscreen view → returns to Floor Plan.
  >
  > If navigation works both ways → **TASK 7.0 DONE**.

---

### Task 8.0 — P2: LLM Config Status + Test Connection [COMPLEXITY: Simple]

> **WHY:** No way to verify Ollama is reachable. Users configure endpoint blindly with no feedback.

**Files:** `src/renderer/screens/Settings/LLMConfig.tsx`

- [ ] 8.1 **Add Ollama status display on mount.** [APPLIES RULES: `ui-foundation-design-system`]
  - On mount, call `window.electronAPI.llm.status()` (already wired in preload)
  - Display status card at top:
    - Status: `Running` (green) / `Stopped` (gray) / `Error` (red)
    - Model: loaded model name or "None"
  - Handle case where `llm:status` IPC handler may not exist (graceful fallback)

- [ ] 8.2 **Add "Test Connection" button.** [APPLIES RULES: `ui-interaction-a11y-perf`]
  - Button next to Save button
  - On click: call `window.electronAPI.llm.status()` with current settings
  - Show result: "Connection successful — Ollama running, model: llama3" or "Connection failed: [error]"
  - Disable button during test (loading spinner)

- [ ] 8.3 **Verify `llm:status` IPC handler exists in main process.** [APPLIES RULES: `3-code-quality-checklist`]
  - Check `llmHandlers.ts` has a handler for `'llm:status'`
  - If missing, add one that queries OllamaService status
  - Must return: `{ status, modelLoaded, modelName, lastError }`

- [ ] 8.T **VERIFICATION — LLM status + test connection**
  > **How to test:** Run `npm run dev`. Open Settings → LLM.
  >
  > **Status card check:**
  > - At top of LLM Config, you should see:
  >   - If Ollama is running: `Status: Running | Model: llama3` (or whatever model)
  >   - If Ollama is NOT running: `Status: Stopped` or `Status: Error`
  >
  > **Test Connection check:**
  > 1. Click "Test Connection" button.
  > 2. If Ollama is running → green success message: "Connected — model loaded"
  > 3. If Ollama is NOT running → red error message: "Connection failed"
  >
  > **Expected in terminal:**
  > ```
  > [IPC][llm:status] Checking Ollama status...
  > ```
  >
  > If status card renders AND test button provides feedback → **TASK 8.0 DONE**.

---

---

### Task 9.0 — P0: Wire Liveness Detection Into Pipeline [COMPLEXITY: Medium] [DEEP AUDIT: D1]

> **WHY:** Liveness detection (anti-spoofing) is FULLY implemented in the Python sidecar (`liveness.py` + `POST /liveness`) with DB columns (`liveness_score`, `is_live`) and a UI toggle (`liveness_enabled`). But **no Electron code ever calls it**. The entire feature is dead code.

**Files:** `src/main/services/AIBridgeService.ts`, `src/main/services/DetectionPipeline.ts`, `src/main/services/EventProcessor.ts`

- [ ] 9.1 **Add `checkLiveness()` function in AIBridgeService.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Add function that calls `POST /liveness` with `crop_base64` parameter
  - Return: `{ is_live: boolean, score: number, method: string }`
  - Graceful fallback when sidecar unavailable

- [ ] 9.2 **Call liveness check in DetectionPipeline after face detection.** [APPLIES RULES: `3-code-quality-checklist`]
  - After face detection (step 3), for each detected face:
    - Read `getSetting('liveness_enabled')` — skip if not `'true'`
    - Extract face crop as base64
    - Call `AIBridge.checkLiveness(cropBase64)`
    - Store result on the face object (add `isLive`, `livenessScore` fields)
  - Only run liveness on **unknown** faces (known persons are trusted) to reduce compute

- [ ] 9.3 **Store liveness results in event record.** [APPLIES RULES: `3-code-quality-checklist`]
  - In `EventProcessor.processDetectionResult()`, when creating the event DB record:
    - Write `liveness_score` and `is_live` columns (already exist in schema)
  - If `is_live === false`, add `[SPOOF]` prefix to Telegram alert

- [ ] 9.T **VERIFICATION — Liveness wired end-to-end**
  > **How to test:** Run `npm run dev`. Enable liveness in Settings → AI.
  > Hold up a photo of a person to the camera.
  >
  > **Expected in terminal:**
  > ```
  > [DetectionPipeline] Liveness check: is_live=false, score=0.28
  > ```
  >
  > **Expected in DB:** Event record has `liveness_score` and `is_live` populated.
  > If liveness results appear in logs AND DB → **TASK 9.0 DONE**.

---

### Task 10.0 — P1: Wire Identity Fusion + Create Router [COMPLEXITY: Complex] [DEEP AUDIT: D2]

> **WHY:** `identity_fusion.py` implements 4-layer weighted fusion (face 50% + body 25% + gait 15% + soft 10%) but has **NO router endpoint** and **is never called**. DB columns `identity_method` and `identity_fusion_score` exist but are always NULL.

**Files:** `python-sidecar/routers/identity_fusion.py` (NEW), `python-sidecar/main.py`, `src/main/services/AIBridgeService.ts`, `src/main/services/DetectionPipeline.ts`

- [ ] 10.1 **Create `/identity/fuse` router in Python sidecar.** [APPLIES RULES: `3-code-quality-checklist`]
  - New file: `python-sidecar/routers/identity_fusion.py`
  - Endpoint: `POST /identity/fuse`
  - Request body: `{ face_similarity, body_similarity, gait_similarity, soft_similarity }` (all optional floats)
  - Calls `identity_fusion.fuse_identity(FusionInput(...))` → returns `FusionResult`
  - Register router in `main.py`

- [ ] 10.2 **Add `fuseIdentity()` function in AIBridgeService.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Function that calls `POST /identity/fuse` with available similarity scores
  - Returns: `{ fused_score, confidence_level, identity_method, layers_used }`

- [ ] 10.3 **Call identity fusion in DetectionPipeline after all biometric layers complete.** [APPLIES RULES: `3-code-quality-checklist`]
  - After face recognition + Re-ID extraction + gait analysis complete for a person track:
    - Collect available scores: `face_similarity` (from recognizeFace), `body_similarity` (from Re-ID match), `gait_similarity` (from gait analysis, if available)
    - Call `AIBridge.fuseIdentity()` with available scores
    - Use fused score to determine final identity (instead of face-only)
  - Store `identity_method` and `identity_fusion_score` on the tracked object

- [ ] 10.4 **Write fusion results to event record.** [APPLIES RULES: `3-code-quality-checklist`]
  - In EventProcessor, write `identity_method` and `identity_fusion_score` to event DB record

- [ ] 10.T **VERIFICATION — Identity fusion produces combined scores**
  > Run the app with cameras. Check terminal for:
  > ```
  > [DetectionPipeline] Identity fusion: score=0.72, method=face+body, confidence=high
  > ```
  > Check DB: event records have `identity_fusion_score` populated.
  > If multi-layer scores appear → **TASK 10.0 DONE**.

---

### Task 11.0 — P0: Wire yolo_confidence + recognition_threshold to Pipeline [COMPLEXITY: Simple] [DEEP AUDIT: B1, B2]

> **WHY:** User changes YOLO confidence or face recognition threshold in Settings → nothing happens. Pipeline uses hardcoded defaults.

**Files:** `src/main/services/DetectionPipeline.ts`, `src/main/services/AIBridgeService.ts`

- [ ] 11.1 **Pass `yolo_confidence` to `detectObjects()` call.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - In DetectionPipeline, before calling `detectObjects()`:
    ```ts
    const yoloConf = parseFloat(getSetting('yolo_confidence') || '0.4');
    ```
  - Add `confidence_threshold` param to `detectObjects()` in AIBridgeService
  - Pass it in the JSON body to the sidecar (`POST /detect_objects`)
  - Python sidecar `object_detection.py` endpoint already accepts `confidence_threshold` in request body — verify and wire

- [ ] 11.2 **Pass `recognition_threshold` to `recognizeFace()` call.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - In DetectionPipeline, before calling `recognizeFace()`:
    ```ts
    const recThreshold = parseFloat(getSetting('recognition_threshold') || '0.45');
    ```
  - Pass as `threshold` param to `recognizeFace(embedding, recThreshold)`
  - Remove the hardcoded `0.6` fallback in AIBridgeService line 315

- [ ] 11.T **VERIFICATION — Thresholds consumed by pipeline**
  > Change YOLO confidence to 0.8 in Settings → AI.
  > Expected in terminal: fewer detections (higher threshold = stricter).
  > Change recognition threshold to 0.3 → more false matches.
  > If behavior changes with setting → **TASK 11.0 DONE**.

---

### Task 12.0 — P1: Respect `gait_enabled` Setting [COMPLEXITY: Simple] [DEEP AUDIT: B3]

> **WHY:** `gait_enabled` is seeded as `'false'` but DetectionPipeline accumulates gait buffers unconditionally. Wastes memory and compute.

**Files:** `src/main/services/DetectionPipeline.ts`

- [ ] 12.1 **Add `gait_enabled` check before gait buffer accumulation.** [APPLIES RULES: `4-code-modification-safety-protocol`]
  - Around line 256 (Step 2b: Gait buffer accumulation), add:
    ```ts
    let isGaitEnabled = false;
    try {
      isGaitEnabled = getSetting('gait_enabled') === 'true';
    } catch {
      isGaitEnabled = false;
    }
    if (isGaitEnabled && personObjects.length > 0) {
    ```
  - This wraps the entire gait buffer block in the setting check

- [ ] 12.T **VERIFICATION — Gait respects setting**
  > With `gait_enabled=false` (default): no gait analysis logs should appear.
  > Set `gait_enabled=true` in Settings → AI: gait analysis logs should appear.
  > If behavior matches setting → **TASK 12.0 DONE**.

---

## Execution Order

All tasks are independent. Recommended execution order by priority:

```
Phase 1 (P0 — critical key mismatches + dead wiring):
  Task 1.0 → Task 2.0 → Task 3.0 → Task 9.0 → Task 11.0

Phase 2 (P1 — high impact visual + feature wiring):
  Task 4.0 → Task 5.0 → Task 10.0 → Task 12.0

Phase 3 (P2 — UX polish):
  Task 6.0 → Task 7.0 → Task 8.0
```

## Summary Statistics

| Category | Count |
|----------|-------|
| **Confirmed Working E2E** | 24 features |
| **Dead Code (built, never called)** | 4 features (D1-D4) |
| **Broken Settings Wiring** | 7 issues (B1-B7) |
| **UI Issues (PRD findings)** | 8 tasks (1.0-8.0) |
| **New Tasks from Deep Audit** | 4 tasks (9.0-12.0) |
| **Total Fix Tasks** | 12 |

## Regression Checklist (run after ALL tasks)

After completing all tasks, verify these core flows still work:

- [ ] Dashboard camera grid renders with all 4 cameras
- [ ] WebRTC streams connect on Dashboard (no extra RTSP sessions opened)
- [ ] Settings → Telegram test still works
- [ ] Person enrollment still works
- [ ] Zone Editor save/load zones still works
- [ ] Event Log still shows events
- [ ] Detection pipeline still runs (check PERF logs in terminal)
- [ ] Liveness check runs on unknown faces (if enabled)
- [ ] Gait analysis only runs when `gait_enabled=true`
- [ ] YOLO confidence change in Settings affects detection count
- [ ] No TypeScript compilation errors: `npx tsc --noEmit`
- [ ] No Python import errors: `cd python-sidecar && python -c "from main import app"`
