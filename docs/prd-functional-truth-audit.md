# PRD: Functional Truth Audit — Screen-by-Screen Verification & Root-Cause Fixes

## 1. Overview

### Business Goal
Ensure every UI screen in Tapo CCTV Desktop is **provably functional or explicitly classified** with its failure root cause. Eliminate "looks implemented but doesn't work" ambiguity. Improve UX clarity so the user can self-diagnose what's working, what needs configuration, and what's pending.

### Detected Architecture
- **Primary Component:** Electron Renderer (React/TypeScript) + Electron Main Process (IPC handlers + Services)
- **Communication:** Renderer → `contextBridge` IPC → Main Process → SQLite (`better-sqlite3`) / Python FastAPI Sidecar
- **Guiding Principle:** Minimal fixes. No over-engineering. Fix broken wiring, add missing loads, surface runtime truth.

### Scope
- **In Scope:** Zone Editor, Analytics, Floor Plan, Situation Room, and all 13 Settings tabs
- **Out of Scope:** Dashboard, Event Log, Person Directory (already verified functional), new feature development, Python sidecar changes

---

## 2. Functional Truth Audit

### Root Cause Classification Key

| Code | Meaning |
|------|---------|
| **CONFIG** | Requires user configuration to produce data (not a bug) |
| **KEY_MISMATCH** | UI saves settings under keys the backend service doesn't read |
| **NO_LOAD** | UI doesn't load persisted values on mount (always shows defaults) |
| **NOT_IMPL** | UI panel is a placeholder with no real functionality |
| **NO_CONSUME** | Settings are persisted but no service reads them at runtime |
| **OK** | Fully wired and functional |
| **PARTIAL** | Some panels work, others don't |

---

### 2.1 Main Screens

#### 2.1.1 Zone Editor

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Camera list loads | Dropdown populated from `camera:list` | `useEffect` calls `camera.list()` on mount | **OK** |
| WebRTC live feed | Camera preview in drawing canvas | `useWebRTCStream(selectedCameraId)` renders `<video>` when connected | **OK** |
| Zone CRUD | Save/load/delete zones per camera | `zone:save`, `zone:list`, `zone:delete` all wired through `ZoneService` | **OK** |
| Polygon drawing | Click vertices, double-click to close | `PolygonDrawTool` component with `onChange` callback | **OK** |
| Tripwire drawing | Click start/end points | `TripwireDrawTool` component with `onChange` callback | **OK** |
| Zone defaults from Settings | New zones inherit Settings → Zones defaults | `EMPTY_DRAFT` is hardcoded; does NOT read `zone.*` settings | **NO_CONSUME** |

**Root Cause:** `ZoneEditor` uses hardcoded `EMPTY_DRAFT` instead of reading zone default settings from DB.

**Fix:** On new zone creation, read `zone.defaultAlertEnabled`, `zone.loiterThresholdSec`, etc. from `settings:get` and merge into draft.

**Definition of Done:**
- [ ] New zones inherit persisted zone default settings
- [ ] If no defaults saved, hardcoded fallbacks still work
- [ ] Zone CRUD round-trip verified (save → reload → edit → delete)

---

#### 2.1.2 Analytics

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Camera selector | Populated on mount | `camera.list()` called | **OK** |
| Date navigation | Prev/next day, "Today" button | Implemented with state management | **OK** |
| Heatmap panel | Grid cells colored by detection density | `analytics:heatmap` → `AnalyticsService.getHeatmapData()` → real SQL on `events.bbox` | **OK** (data-dependent) |
| Activity graph | Stacked bars per hour (known/unknown) | `analytics:activity` → `AnalyticsService.getActivityData()` → reads `analytics_rollup` | **OK** (rollup-dependent) |
| Presence timeline | Per-person colored segments | `analytics:presence` → `AnalyticsService.getPresenceTimeline()` → reads `presence_history` | **OK** (data-dependent) |
| Zone traffic | Per-zone enter/exit/loiter bars | `analytics:zoneTraffic` → `AnalyticsService.getZoneTrafficData()` → real SQL join | **OK** (data-dependent) |
| Empty states | Informative when no data | Each panel shows "No [X] data for this period" | **PARTIAL** — no guidance on WHY empty |

**Root Cause:** All 4 analytics panels are fully wired with real SQL queries. The "looks broken" impression comes from **empty panels when there's no data**, with no explanation of prerequisites.

**Fix (UX only):**
1. Add prerequisite hints to each empty state:
   - Heatmap: *"Detection events with bounding boxes populate this view. Ensure AI pipeline is running."*
   - Activity: *"Hourly rollups aggregate detection data. Data appears after the first hour of pipeline operation."*
   - Presence: *"Presence timeline requires enrolled persons with active presence tracking."*
   - Zone Traffic: *"Define zones in the Zone Editor and run the AI pipeline to generate zone events."*
2. Add a small "pipeline status" indicator in the Analytics header (green dot = sidecar healthy + pipeline running).

**Definition of Done:**
- [ ] Each empty-state message includes actionable prerequisite hint
- [ ] Pipeline health indicator in Analytics header
- [ ] With real event data, all 4 panels render correctly

---

#### 2.1.3 Floor Plan

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Floor plan image display | Renders uploaded image | Reads from `floorplan:get` → displays `imagePath` | **OK** (config-dependent) |
| Camera icons | Positioned on map | Cameras with `floorX`/`floorY` rendered | **OK** |
| Person dots | Live tracked persons | Polls `floorplan:positions` every 2s, maps to camera positions | **OK** (pipeline-dependent) |
| SVG trails | Movement history per person | Trail accumulation with dedup logic | **OK** |
| Empty state | Guide to configure | "Go to Settings → Floor Plan" message | **OK** |
| Person/camera click handlers | Navigate to camera view | `console.log` only — no actual navigation | **NOT_IMPL** |

**Root Cause:** Click handlers log to console but don't trigger navigation to camera fullscreen view.

**Fix:** Wire `handlePersonClick` and `handleCameraClick` to emit a callback that `App.tsx` can use to open `CameraFullscreenView`.

**Definition of Done:**
- [ ] Clicking a person dot navigates to the camera they're on (fullscreen view)
- [ ] Clicking a camera icon navigates to that camera's fullscreen view
- [ ] Floor plan renders correctly with uploaded image and positioned cameras

---

#### 2.1.4 Situation Room

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Alerts panel | Real-time zone/topology/sound alerts | Subscribes to `zone:event`, `topology:anomaly`, `sound:event` IPC | **OK** (pipeline-dependent) |
| Floor map mini | Shows person positions on property map | **Hardcoded** camera positions at computed grid coords; does NOT use actual floor plan image or camera positions from DB | **NOT_IMPL** |
| Active feed | Live camera stream | Placeholder text: *"WebRTC stream renders here"* — **no actual video** | **NOT_IMPL** |
| Person status | Per-person presence state | Polls `presence:list`, renders state badges | **OK** (data-dependent) |
| Active tracks counter | Number of tracked objects | Subscribes to `ai:objects` | **OK** |

**Root Causes:**
1. **Active Feed:** No WebRTC stream integration. Panel is a static placeholder.
2. **Floor Map Mini:** Does not read `floorplan:get` data. Camera positions are hardcoded in a `['CAM-1', 'CAM-2A', 'CAM-2B', 'CAM-3']` array with computed positions.

**Fixes:**
1. **Active Feed:** Integrate `useWebRTCStream` hook for the `selectedCamera`. Allow camera selection by clicking alerts or person entries.
2. **Floor Map Mini:** Load floor plan image + camera positions from `floorplan:get`. If no floor plan configured, show existing grid fallback with a hint.

**Definition of Done:**
- [ ] Active Feed panel renders a real WebRTC stream for the selected camera
- [ ] Clicking an alert or person status entry selects the relevant camera
- [ ] Floor Map Mini displays the actual floor plan image (if configured) with real camera positions
- [ ] Falls back gracefully to grid layout with "Configure floor plan" hint if not set up
- [ ] Alerts and Person Status continue working as-is

---

### 2.2 Settings Tabs

#### 2.2.1 Telegram Config

| Aspect | Verdict | Notes |
|--------|---------|-------|
| Load saved token/chatId | **OK** | Reads from `settings:get` |
| Save | **OK** | Writes via `settings:set` |
| Test button | **OK** | `telegram:test` IPC wired |

**No fixes needed.**

---

#### 2.2.2 Retention Config

| Aspect | Verdict | Notes |
|--------|---------|-------|
| Load/save retention days | **OK** | Standard `settings:get/set` pattern |
| Purge buttons | **OK** | `privacy:purge-all-faces`, `privacy:purge-old-events` wired |

**No fixes needed.**

---

#### 2.2.3 Camera Management

| Aspect | Verdict | Notes |
|--------|---------|-------|
| List cameras | **OK** | `camera:list` |
| Edit camera settings | **OK** | `camera:update` |

**No fixes needed.**

---

#### 2.2.4 PTZ Config

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Camera list (PTZ only) | Filter to PTZ cameras | Filters `hasPtz === true` | **OK** |
| PTZ status display | Shows capabilities, tracking state | Calls `ptz:command` with action `'status'` | **OK** |
| Auto-track toggle | Start/stop auto-tracking | `ptz:command` with `'autotrack:start'`/`'autotrack:stop'` | **OK** |
| Patrol toggle | Start/stop preset patrol | `ptz:command` with `'patrol:start'`/`'patrol:stop'` | **OK** |
| Preset list | List and go-to presets | `ptz:presets` + `ptz:command` with `'go_to_preset'` | **OK** |

**No fixes needed.** Runtime-dependent on camera hardware.

---

#### 2.2.5 AI Config — **NO_CONSUME**

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load settings on mount | Read `ai.*` keys from DB | `useEffect` reads `ai.detectionConfidence`, etc. | **OK** |
| Save settings | Write `ai.*` keys to DB | Iterates entries, calls `settings:set` | **OK** |
| Pipeline consumes settings | DetectionPipeline reads `ai.detectionConfidence` at runtime | **NOT VERIFIED** — Pipeline likely reads different keys or hardcodes values | **NO_CONSUME** |

**Root Cause:** Settings are persisted under `ai.*` prefix but `DetectionPipeline`, `ProcessManager`, and sidecar config may not read these keys. The AI pipeline likely uses hardcoded thresholds or different setting key names.

**Fix:**
1. Audit `DetectionPipeline.ts` and `config.py` for the actual setting keys consumed.
2. Either: (a) map the `ai.*` UI keys to the keys the pipeline reads, or (b) update the pipeline to read `ai.*` keys.
3. Add a "Sidecar Health" status indicator showing current inference device, loaded models, and GPU status (reading from `/health` endpoint).

**Definition of Done:**
- [ ] AI Config UI keys match what DetectionPipeline and sidecar actually read
- [ ] Changing detection confidence in Settings actually affects pipeline behavior
- [ ] Sidecar health status displayed (inference device, GPU, loaded models)

---

#### 2.2.6 Recording Config — **KEY_MISMATCH**

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load settings | Read recording config from DB | Reads `recording.defaultMode`, `recording.segmentDurationSec`, etc. | **PARTIAL** |
| Save settings | Persist recording config | Writes `recording.defaultMode`, `recording.segmentDurationSec`, etc. | **OK** (saves) |
| RecordingService reads | Service reads matching keys | Service reads `recording_mode`, `recording_segment_duration_min`, `recording_retention_days` | **KEY_MISMATCH** |

**Root Cause:** The UI writes settings under keys like `recording.defaultMode` but `RecordingService` reads keys like `recording_mode` (underscore format, no prefix nesting). The two never connect.

**Key mapping discrepancies:**

| UI writes | Service reads | Match? |
|-----------|--------------|--------|
| `recording.defaultMode` | `recording_mode` | ❌ |
| `recording.segmentDurationSec` | `recording_segment_duration_min` | ❌ (also unit mismatch: sec vs min) |
| `recording.preRecordSec` | *(not found)* | ❌ |
| `recording.postRecordSec` | *(not found)* | ❌ |
| `recording.maxStorageGb` | *(not found)* | ❌ |
| `recording.outputFormat` | *(not found)* | ❌ |

**Fix:** Align UI setting keys to match what `RecordingService` actually reads. Change the UI to write/read:
- `recording_mode` instead of `recording.defaultMode`
- `recording_segment_duration_min` (convert sec→min) instead of `recording.segmentDurationSec`
- `recording_retention_days` instead of N/A
- For keys the service doesn't consume yet (pre/post record, max storage, format), either wire them into the service or remove from UI with "coming soon" label.

**Definition of Done:**
- [ ] RecordingConfig UI reads/writes the same keys RecordingService consumes
- [ ] Unit conversions handled correctly (sec↔min)
- [ ] Unimplemented settings clearly marked or removed
- [ ] Changing recording mode in Settings affects actual recording behavior

---

#### 2.2.7 Zone Defaults — **NO_LOAD**

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load defaults on mount | Read `zone.*` from DB | **No `useEffect` for loading** — always shows hardcoded `DEFAULT_SETTINGS` | **NO_LOAD** |
| Save defaults | Write `zone.*` to DB | Works — iterates entries, calls `settings:set` | **OK** |
| ZoneEditor consumes | New zones use saved defaults | `EMPTY_DRAFT` hardcoded, ignores `zone.*` settings | **NO_CONSUME** |

**Root Cause:** Missing `useEffect` to load persisted zone defaults on component mount. Also, `ZoneEditor` doesn't read these defaults.

**Fix:**
1. Add `useEffect` to `ZoneDefaults.tsx` that reads `zone.*` keys from `settings:get` on mount.
2. In `ZoneEditor.tsx`, when creating a new zone (`handleNewZone`), read `zone.*` settings and merge into draft.

**Definition of Done:**
- [ ] ZoneDefaults loads persisted values on mount (not just hardcoded defaults)
- [ ] Saving and reopening the tab shows the saved values
- [ ] New zones in ZoneEditor inherit the saved default settings

---

#### 2.2.8 Sound Detection Config — **KEY_MISMATCH + NO_LOAD**

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load on mount | Read `sound.*` from DB | **No `useEffect` for loading** — always shows hardcoded defaults | **NO_LOAD** |
| Save | Write `sound.*` to DB | Works | **OK** |
| SoundService reads | Service reads matching keys | Reads `sound_detection_enabled`, `sound_confidence_threshold`, `sound_event_types` | **KEY_MISMATCH** |

**Key mapping discrepancies:**

| UI writes | Service reads | Match? |
|-----------|--------------|--------|
| `sound.enabled` | `sound_detection_enabled` | ❌ |
| `sound.confidenceThreshold` | `sound_confidence_threshold` | ❌ |
| `sound.glassBreakEnabled` etc. | `sound_event_types` (comma-separated list) | ❌ (format mismatch) |
| `sound.cooldownSec` | *(not found)* | ❌ |
| `sound.alertOnDetection` | *(not found)* | ❌ |

**Fix:**
1. Add `useEffect` to load persisted values on mount.
2. Align keys: write `sound_detection_enabled`, `sound_confidence_threshold`, and `sound_event_types` (as comma-separated string built from the checkbox states).
3. For keys the service doesn't read yet (cooldown, alert toggle), wire or label as "coming soon".

**Definition of Done:**
- [ ] SoundDetectionConfig loads persisted values on mount
- [ ] Setting keys match what SoundService reads
- [ ] Enabling/disabling sound classes builds the correct `sound_event_types` string
- [ ] Toggling sound detection ON/OFF actually affects SoundService behavior

---

#### 2.2.9 LLM Config

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load on mount | Read `ollama.*` from DB | `useEffect` loads 6 keys | **OK** |
| Save | Write `ollama.*` to DB | Works | **OK** |
| Connection test | Verify Ollama is reachable | **Not implemented** — no test button | **PARTIAL** |
| Status indicator | Show Ollama running/model loaded | **Not implemented** — `llm:status` IPC exists in preload but not used in UI | **NOT_IMPL** |

**Root Cause:** `llm:status` IPC channel is wired in preload but the LLMConfig UI doesn't call it.

**Fix:**
1. Add a "Test Connection" button that calls `window.electronAPI.llm.status()`.
2. Display Ollama status (running/stopped, model loaded, model name) as a status card at the top of the config.

**Definition of Done:**
- [ ] LLM status displayed (running/stopped, model name, GPU/CPU)
- [ ] "Test Connection" button verifies Ollama endpoint is reachable
- [ ] Status updates on save (re-checks with new endpoint)

---

#### 2.2.10 Topology Editor

| Aspect | Verdict | Notes |
|--------|---------|-------|
| Load edges | **OK** | `topology:get` → renders edge list |
| Add/remove/edit edges | **OK** | Local state management with save |
| Save | **OK** | `topology:save` → `TopologyService` |
| Empty state | **OK** | Dashed border with guidance text |

**No fixes needed.**

---

#### 2.2.11 Floor Plan Editor

| Aspect | Verdict | Notes |
|--------|---------|-------|
| Image upload | **OK** | FileReader → data URL → preview |
| Camera positioning | **OK** | Click-to-place with percentage coords |
| Save | **OK** | `floorplan:save` with cameras array |
| Load existing | **OK** | `floorplan:get` on mount |
| Empty state | **OK** | Upload prompt |

**No fixes needed.**

---

#### 2.2.12 Layout Preferences

| Aspect | Expected | Actual | Verdict |
|--------|----------|--------|---------|
| Load on mount | Read `default_layout`, `mini_ptz_enabled` | `useEffect` reads both | **OK** |
| Save | Write to DB | Works with change detection | **OK** |
| Dashboard consumes | CameraGrid uses `default_layout` | **NOT VERIFIED** — Dashboard/CameraGrid may not read this setting | **NO_CONSUME** |

**Root Cause:** Settings persist correctly but `Dashboard.tsx` / `CameraGrid.tsx` likely don't read `default_layout` to determine grid layout.

**Fix:** Verify if `CameraGrid` reads `default_layout`. If not, wire it: read the setting on mount and apply it to the grid layout.

**Definition of Done:**
- [ ] Changing layout preference in Settings → Layout actually changes Dashboard grid
- [ ] Mini PTZ toggle actually shows/hides PTZ overlay on camera tiles

---

#### 2.2.13 System Info

| Aspect | Verdict | Notes |
|--------|---------|-------|
| AI service status | **OK** | `system:status` → `getSidecarStatus()` |
| GPU status | **OK** | Reads `gpu_enabled` setting |
| Camera count | **OK** | `getCamerasConnectedCount()` |
| Event count | **OK** | `getEventsCount()` |
| DB file size | **OK** | `getDatabaseFileSize()` |
| Refresh | **OK** | Manual refresh button |

**No fixes needed.**

---

## 3. Technical Specifications

### 3.1 Fix Priority Matrix

| Priority | Fix | Files | Effort |
|----------|-----|-------|--------|
| **P0** | Recording Config key mismatch | `RecordingConfig.tsx` | S |
| **P0** | Sound Config key mismatch + no load | `SoundDetectionConfig.tsx` | S |
| **P0** | Zone Defaults no load + ZoneEditor no consume | `ZoneDefaults.tsx`, `ZoneEditor.tsx` | S |
| **P1** | Situation Room Active Feed (WebRTC) | `SituationRoom.tsx` | M |
| **P1** | Situation Room Floor Map (real data) | `SituationRoom.tsx` | M |
| **P1** | AI Config → pipeline key alignment | `AIConfig.tsx`, `DetectionPipeline.ts` | M |
| **P1** | Layout → Dashboard consumption | `CameraGrid.tsx` or `Dashboard.tsx` | S |
| **P2** | Analytics empty state hints | 4 analytics panel components | S |
| **P2** | Floor Plan click navigation | `FloorPlan.tsx`, `App.tsx` | S |
| **P2** | LLM Config status + test button | `LLMConfig.tsx` | S |

**Effort: S = < 30 min, M = 30-90 min, L = > 90 min**

### 3.2 Data Flow Diagrams

#### Settings Key Flow (Current — Broken)
```
RecordingConfig.tsx                RecordingService.ts
─────────────────                  ─────────────────
writes: recording.defaultMode  →  reads: recording_mode         ← MISS
writes: recording.segmentDurationSec → reads: recording_segment_duration_min ← MISS + UNIT
```

#### Settings Key Flow (Fixed)
```
RecordingConfig.tsx                RecordingService.ts
─────────────────                  ─────────────────
writes: recording_mode         →  reads: recording_mode          ← MATCH
writes: recording_segment_duration_min → reads: recording_segment_duration_min ← MATCH
```

#### Situation Room Active Feed (Current → Fixed)
```
CURRENT:
  SituationRoom.tsx → selectedCamera → placeholder text ("WebRTC stream renders here")

FIXED:
  SituationRoom.tsx → selectedCamera → useWebRTCStream(selectedCamera) → <video> element
  Alert click / Person click → setSelectedCamera(cameraId) → stream updates
```

### 3.3 Inter-Service Communication

No new IPC channels needed. All fixes use existing wired channels:
- `settings:get` / `settings:set` (key alignment only)
- `floorplan:get` / `floorplan:positions` (already wired, unused by SitRoom)
- `webrtc:start` / `webrtc:signal` (already wired, unused by SitRoom)
- `llm:status` (already wired in preload, unused by LLMConfig UI)

### 3.4 Regression Risks

| Risk | Mitigation |
|------|------------|
| Changing setting keys breaks existing saved data | Migration: read old key → write new key → delete old key on first load |
| WebRTC in SitRoom opens extra RTSP sessions | Respect C246D 2-session limit; use same stream negotiation as Dashboard |
| Zone default loading adds latency to ZoneEditor | Async load with fallback to hardcoded defaults if read fails |
| Layout preference change breaks Dashboard | Fallback to `2x2` if setting value is invalid |

### 3.5 Security & Authentication

No changes. All data remains local-only (SQLite + IPC). No new external API calls.

---

## 4. Out of Scope

- **New feature screens** (no new screens or navigation changes beyond Floor Plan click wiring)
- **Python sidecar changes** (all fixes are Electron-side)
- **Dashboard / Event Log / Person Directory** (already functional)
- **Camera stream architecture changes** (existing dual-stream preserved)
- **DB schema changes** (all fixes use existing `settings` table key-value store)
- **Recording pipeline implementation** (RecordingService logic stays as-is; only key alignment)

---

## 5. Acceptance Criteria Summary

### Per-Screen Checklist

| Screen | Acceptance Criteria |
|--------|-------------------|
| **Zone Editor** | New zones inherit saved defaults; full CRUD works with WebRTC feed |
| **Analytics** | All 4 panels show data when events exist; empty states have prerequisite hints; pipeline status visible |
| **Floor Plan** | Person/camera clicks navigate to fullscreen; existing rendering preserved |
| **Situation Room** | Active Feed shows real WebRTC stream; Floor Map uses actual floor plan data; Alerts + Person Status work |
| **Settings → AI** | Saved values consumed by pipeline; sidecar health visible |
| **Settings → Recording** | Keys match RecordingService; mode changes take effect |
| **Settings → Zones** | Values load on mount; ZoneEditor uses saved defaults |
| **Settings → Sound** | Values load on mount; keys match SoundService |
| **Settings → LLM** | Status indicator + test connection button |
| **Settings → Layout** | Layout preference applied to Dashboard grid |

### Global Acceptance Criteria
- [ ] No new TypeScript compilation errors
- [ ] No broken IPC contracts (preload ↔ handlers)
- [ ] Existing camera stream/session limits respected (C246D 2-session limit)
- [ ] Settings migration handles old→new key format gracefully
- [ ] All empty states include actionable guidance text

---

**Next Step:** Run `/plan` to generate the granular technical task list from this PRD.
