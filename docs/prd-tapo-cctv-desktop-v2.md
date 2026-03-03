# PRD: Tapo CCTV Desktop — v2.0 (Presidential-Level Upgrade)

> **Version:** 2.0
> **Status:** Draft
> **Created:** 2026-03-03
> **Based on:** PRD v1.0 + Feature Upgrade Analysis (FaceTracker → Tapo CCTV Desktop)
> **Author:** Product Manager (AI-assisted)
> **Next Step:** `/plan` to generate technical task list

---

## 1. Overview

### 1.1 Business Goal

Upgrade the existing Tapo CCTV Desktop application from a basic monitoring tool with simple face recognition into a **presidential-level intelligent surveillance system**. This upgrade ports FaceTracker (GuardianAI)'s proven AI capabilities — YOLOv8s object detection, ByteTrack multi-object tracking, face quality gates, zone detection, presence/journey intelligence — and extends far beyond with cross-camera Re-ID, behavioral anomaly detection, gait recognition, PTZ auto-tracking, floor plan visualization, and a unified Situation Room dashboard.

### 1.2 Problem Statement

PRD v1.0 delivered a functional CCTV desktop app with basic face recognition and entry/exit logging. However, it has critical limitations:

- **No object detection** — relies on pixel-diff motion, causing false positives from shadows/rain/wind
- **No tracking** — each detection is independent; no persistent track IDs across frames
- **CUDA broken** — GPU acceleration fails, forcing CPU-only inference (5-10x slower)
- **No intelligence layer** — no presence tracking, journey correlation, or behavioral analysis
- **Per-camera isolation** — cameras operate as independent islands with no cross-camera awareness
- **Heavy IPC pipeline** — 6.2MB raw RGB24 frames per IPC transfer; wastes bandwidth and CPU

This upgrade transforms the system from "a collection of independent cameras with face recognition" into "a unified surveillance platform with continuous cross-camera tracking, predictive intelligence, and active camera control."

### 1.3 Upgrade Scope

| Phase | Name | Priority | Estimated Effort |
|-------|------|----------|-----------------|
| **Phase 1** | Foundation Fixes | CRITICAL | 1-2 days |
| **Phase 2** | Core AI (Port FaceTracker) | HIGH | 3-5 days |
| **Phase 3** | Intelligence Layer (Port FaceTracker) | HIGH | 3-5 days |
| **Phase 4** | Advanced Features (Beyond FaceTracker) | MEDIUM | 5-10 days |
| **Phase 5** | Presidential-Level Tracking | FUTURE | 10-20 days |

**Total estimated effort:** 22-42 days

### 1.4 Detected Architecture

| Layer | Implementation Target | Technology | Upgrade Impact |
|-------|----------------------|------------|---------------|
| **UI Layer** | Electron Renderer | React 19 + TypeScript + TailwindCSS | New screens: Zone Editor, Analytics, Floor Plan, Situation Room |
| **Application Core** | Electron Main Process | TypeScript (Node.js) | New services: PTZ orchestration, recording, presence/journey state machines, WebRTC |
| **AI Microservice** | Python FastAPI Sidecar | Python + InsightFace + YOLOv8s + CUDA | Major expansion: object detection, tracking, zones, Re-ID, gait, LLM, sound |
| **Data Layer** | SQLite | better-sqlite3 | New tables: zones, tracks, journeys, presence, recordings, topology, analytics |
| **Streaming** | go2rtc | go2rtc + WebRTC (new) + FFmpeg (AI sub-stream) | WebRTC for display; sub-stream for AI processing |

### 1.5 Key Constraints (Inherited from v1.0 + Updated)

- **Single-user local application** — no server, no multi-user, no web access
- **All processing local** — no cloud APIs; LLM via local Ollama only
- **Same LAN** — all cameras on 192.168.100.x network
- **Privacy-first** — face/body embeddings encrypted (AES-256) at rest; no data leaves machine except Telegram alerts
- **High-end hardware target** — Ryzen 9 7900, RTX 4090 (24GB VRAM), 32GB RAM
- **PTZ upgrade assumed** — CAM-1 and CAM-3 will be upgraded to PTZ-capable cameras (Tapo C520WS)
- **4 logical cameras** — CAM-2 (C246D dual-lens) treated as CAM-2A (wide) + CAM-2B (telephoto) with group deduplication

### 1.6 What Carries Forward from v1.0

All v1.0 functionality is **preserved and enhanced**. Specifically:

- Dashboard with selectable grid layouts (1×1, 2×2, 3×1, custom) — now supports 4 logical cameras
- Camera fullscreen view with PTZ controls — enhanced with zone editor overlay
- Person Directory with enrollment (upload, capture, event) — enhanced with auto-enrollment and negative gallery
- Event Log with filters — enhanced with journey/presence events and behavioral alerts
- Telegram notifications — enhanced with per-person rules and daily LLM summaries
- Settings — expanded with new AI, PTZ, zone, recording, and analytics configuration
- SQLite data layer with encrypted face embeddings — expanded schema
- Python AI sidecar — massively expanded with new models and services

---

## 2. Camera Hardware

### 2.1 Camera Inventory (Post-Upgrade)

| Logical ID | Physical Camera | Location | IP | Model | PTZ | Lens | Role |
|-----------|----------------|----------|-----|-------|-----|------|------|
| **CAM-1** | Camera 1 | SALA (Indoor) | 192.168.100.213 | Tapo C520WS (upgraded) | ✅ Pan/Tilt | Single | Indoor monitoring |
| **CAM-2A** | Camera 2, Lens 1 | Front Gate (Wide) | 192.168.100.214 | Tapo C246D HW1.0 | ❌ Fixed | Wide-angle | Gate area coverage |
| **CAM-2B** | Camera 2, Lens 2 | Front Gate (Tele) | 192.168.100.214 | Tapo C246D HW1.0 | ✅ Pan/Tilt/Zoom | Telephoto | High-res face capture |
| **CAM-3** | Camera 3 | Garden → Gate | 192.168.100.215 | Tapo C520WS (upgraded) | ✅ Pan/Tilt | Single | Garden/path monitoring |

### 2.2 Camera Groups (Deduplication)

| Group ID | Cameras | Rationale |
|----------|---------|-----------|
| `GATE_GROUP` | CAM-2A, CAM-2B | Same physical location (dual-lens C246D); suppress duplicate alerts |

### 2.3 Camera Topology (Spatial Graph)

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

**Topology Configuration:**

```json
{
  "edges": [
    { "from": "CAM-2A", "to": "CAM-3",  "transit_sec": [8, 20],  "direction": "inbound" },
    { "from": "CAM-3",  "to": "CAM-1",  "transit_sec": [10, 25], "direction": "inbound" },
    { "from": "CAM-1",  "to": "CAM-3",  "transit_sec": [10, 25], "direction": "outbound" },
    { "from": "CAM-3",  "to": "CAM-2A", "transit_sec": [8, 20],  "direction": "outbound" }
  ],
  "blind_spot_max_sec": 60,
  "camera_groups": {
    "GATE_GROUP": ["CAM-2A", "CAM-2B"]
  }
}
```

### 2.4 Communication Protocols

| Protocol | Purpose | Cameras |
|----------|---------|---------|
| **RTSP** (main stream) | 1080p display via WebRTC | All |
| **RTSP** (sub-stream) | 720p AI processing via FFmpeg | All |
| **Tapo API** | PTZ control, siren, spotlight, SD card, firmware | All |
| **ONVIF** | Fallback/supplement where Tapo API is limited | All |
| **WebRTC** (via go2rtc) | Low-latency display in renderer | All |

---

## 3. Functional Specifications

### 3.1 User Stories — Phase 1: Foundation Fixes

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-1.1 | As a user, I want the AI to use my RTX 4090 GPU so that face detection and recognition happen in real-time on all cameras simultaneously. | CUDA Execution Provider loads successfully; GPU name logged on startup; inference <50ms/frame on GPU; no `cublasLt64_12.dll` errors |
| US-1.2 | As a user, I want the AI to process a lower-resolution sub-stream so that AI processing doesn't bottleneck display performance. | Main stream (1080p) → display via WebRTC; sub-stream (720p) → AI sidecar; configurable per camera; ~4x bandwidth reduction for AI path |

### 3.2 User Stories — Phase 2: Core AI

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-2.1 | As a user, I want the system to detect and track persons, vehicles, and animals with persistent IDs so I know WHAT moved and can follow the SAME object across frames. | YOLOv8s detects person/vehicle/animal classes; ByteTrack assigns persistent track IDs per camera; track IDs survive brief occlusions; face recognition only triggers on person-class detections |
| US-2.2 | As a user, I want the system to only alert on clear, front-facing faces so I don't get spam alerts from blurry/sideways detections. | Quality gate checks: yaw ≤40°, pitch ≤30°, blur score ≥60, detection confidence ≥0.72; multi-frame confirmation (3 consecutive recognitions); weighted voting with EMA smoothing |
| US-2.3 | As a user, I want better face detection at night so the system works reliably in low-light conditions. | CLAHE preprocessing auto-activates when mean luminance <80; configurable threshold; visible improvement in night detection rate |
| US-2.4 | As a user, I want the system to automatically capture new reference images of known persons in good conditions so recognition improves over time. | Auto-enroll triggers when: match similarity ≥0.55, face quality ≥80, max 5 auto-enrolled per person; auto-expire after 30 days; toggle in Settings |
| US-2.5 | As a user, I want to mark false positive detections so the system learns to reject them in the future. | Right-click detection → "Mark as False Positive"; stores crop in negative gallery per person; future matches against negative gallery are rejected; manage in Person Directory |

### 3.3 User Stories — Phase 3: Intelligence Layer

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-3.1 | As a user, I want to draw polygon zones on camera views with different behaviors (RESTRICTED, MONITORED, COUNTING, TRIPWIRE) so I can define areas of interest. | Zone editor overlay on camera view; draw/edit/delete polygon zones; zone types: RESTRICTED (alert on entry), MONITORED (log all), COUNTING (in/out count), TRIPWIRE (directional line with track correlation); save per camera; visual feedback |
| US-3.2 | As a user, I want alerts when someone lingers in a zone too long so I'm notified of potential loitering. | Loitering threshold configurable per zone (default 15s); cooldown 180s; must stay within 80px movement radius; requires ByteTrack tracking + zone system |
| US-3.3 | As a user, I want the system to track a person's movement across cameras so I can see their journey through my property. | Journey starts when face recognized at any camera; updates when same face appears at next expected camera within topology transit window; generates journey events: "Angelo: Gate → Garden → House in 45s" |
| US-3.4 | As a user, I want to see each known person's presence state (HOME/AWAY/ARRIVING/DEPARTING) so I know who's home at a glance. | 5-state FSM per person: HOME, AT_GATE, AWAY, ARRIVING, DEPARTING; state transitions based on camera detections + topology; "not seen for 30 min" → AWAY; presence panel in Dashboard |
| US-3.5 | As a user, I want the telephoto camera to automatically capture a burst of high-res frames when the wide-angle camera detects someone at the gate, for better face images. | CAM-2A detection triggers CAM-2B burst capture (5 frames); best-quality frame selected for Telegram alert; configurable burst count and selection criteria |
| US-3.6 | As a user, I want duplicate alerts suppressed when both lenses of CAM-2 detect the same person simultaneously. | Camera group `GATE_GROUP` deduplicates events within 5-second window; single alert with best-quality snapshot from either lens |

### 3.4 User Stories — Phase 4: Advanced Features

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-4.1 | As a user, I want to see real-time bounding boxes, track trails, person names, and confidence scores overlaid on the video in the UI. | Renderer draws SVG/Canvas overlays on video; interactive: click box to view person, right-click for actions (enroll, negative gallery); smooth interpolation between detection frames; toggle overlay visibility |
| US-4.2 | As a user, I want low-latency video display using WebRTC instead of raw frame IPC so the app uses less CPU and bandwidth. | go2rtc serves WebRTC to renderer `<video>` element; H.264 hardware decode on GPU; <100ms display latency; AI sub-stream path remains separate (FFmpeg decode for AI sidecar) |
| US-4.3 | As a user, I want continuous recording with an event-tagged timeline so I can scrub through footage and jump to events. | go2rtc records to MP4/HLS segments; 24/7 or event-triggered mode; timeline scrubber UI with event markers; click event → jump to timestamp; configurable retention per camera |
| US-4.4 | As a user, I want an analytics dashboard showing detection heatmaps, activity graphs, presence timelines, and zone traffic. | New "Analytics" screen in sidebar; heatmap (per camera), activity graph (detections/hour/day), person presence timeline (home/away over time), zone traffic (in/out counts); date range filter; chart library (recharts or nivo) |
| US-4.5 | As a user, I want an AI-generated daily security summary so I get a natural-language report of the day's events. | Local LLM (Ollama, 7B model) generates daily summary; includes: detection count, person arrivals/departures, anomalies, recommendations; configurable summary time; viewable in Event Log + optional Telegram delivery |
| US-4.6 | As a user, I want the system to detect if a face is from a real person or a photo/screen so I'm protected against spoofing. | Anti-spoofing model (MiniFASNet or equivalent); liveness score per detection; flag spoofing attempts in Event Log; configurable sensitivity |
| US-4.7 | As a user, I want the system to detect sound events (glass breaking, gunshots, screaming, dog barking) from camera audio streams. | YAMNet audio classifier on camera audio; configurable event types; sound events appear in Event Log; Telegram alerts for critical sounds (glass break, gunshot, scream) |
| US-4.8 | As a user, I want each person to have a dynamically adjusted recognition threshold based on their enrollment quality. | Per-person adaptive threshold based on enrollment embedding clustering; diverse reference photos → lower threshold; few photos → higher threshold; range: 0.45-0.65; minimum margin 0.08 between best and second-best match |

### 3.5 User Stories — Phase 5: Presidential-Level Tracking

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-5.1 | As a user, I want the system to track the same person across cameras even when their face isn't visible (back turned, masked, hat). | Body Re-ID model (OSNet-AIN) extracts appearance embedding from YOLO person crops; cross-camera matching with global track ID; fuse face (0.7) + body (0.3) when both available; gallery: last 5 minutes per track |
| US-5.2 | As a user, I want the system to understand my property's camera layout and detect anomalies like someone appearing at an unexpected camera or taking too long between cameras. | Spatial topology graph configurable in Settings; predictive handoff ("pre-warm next camera"); anomaly alerts: skip detection, transit time violation, disappearance after entry; uses topology edges + transit time ranges |
| US-5.3 | As a user, I want a real-time floor plan map showing where each tracked person is located with identity labels and movement trails. | Upload floor plan image; place cameras on map; real-time dots for tracked persons (color-coded: green=known, red=unknown, blue=unidentified); movement trails (last 5 min); click dot → jump to camera feed; animate position transitions |
| US-5.4 | As a user, I want multi-layer identity confirmation using face + body + gait + soft biometrics for the highest possible identification accuracy. | Primary: face recognition (99.5%); Secondary: body Re-ID (88-95%); Tertiary: gait recognition (85-92%, requires 2s walking footage); Soft: height + clothing color; weighted fusion score |
| US-5.5 | As a user, I want the system to detect suspicious behaviors (loitering, pacing, running, tailgating, camera tampering, crowd formation, wrong-direction, time anomaly). | Behavioral classifiers: loitering (zone+time), running (velocity), time anomaly (unusual hour), camera tampering (frame analysis), pacing (trajectory loops), tailgating (multi-person zone entry), wrong direction (topology); configurable per behavior; alerts in Event Log + Telegram |
| US-5.6 | As a user, I want a unified "Situation Room" dashboard combining all intelligence (alerts, floor map, camera feeds, person status, event timeline) in one screen. | New "Situation Room" screen; 4-panel layout: alerts list, floor map with live dots, active camera feed (click dot → feed), person status panel + event timeline; real-time updates; designed for continuous monitoring |
| US-5.7 | As a user, I want intelligent PTZ control including auto-tracking, preset patrol, zoom-on-demand, and coordinated multi-camera handoff. | PTZ abstraction layer (Tapo + ONVIF); auto-tracking (PID controller, dead zone, multi-person priority); preset patrol (configurable schedules, interrupt on detection); zoom-on-demand (click detection box → camera zooms); coordinated handoff (Re-ID + topology → pre-position next camera) |

### 3.6 Updated Screen Map

| Screen | Purpose | New in v2.0? |
|--------|---------|-------------|
| **Dashboard** | Camera grid (4 cameras) + presence panel + status bar | Enhanced |
| **Camera View** | Enlarged stream + PTZ + zone editor + detection overlay | Enhanced |
| **Event Log** | Filterable event table (detections + journeys + behaviors + sounds) | Enhanced |
| **Person Directory** | Person CRUD + enrollment + auto-enrollment + negative gallery | Enhanced |
| **Zone Editor** | Draw/edit polygon zones + tripwires per camera | **NEW** |
| **Analytics** | Heatmaps, activity graphs, presence timelines, zone traffic | **NEW** |
| **Floor Plan** | Real-time property map with person dots + trails | **NEW** |
| **Situation Room** | Unified command dashboard (alerts + map + feed + status + timeline) | **NEW** |
| **Settings** | All configuration (expanded: AI, PTZ, zones, recording, topology, LLM) | Enhanced |

### 3.7 Updated UI Component Hierarchy

```
App Shell (sidebar nav + content area)
├── Dashboard
│   ├── LayoutSelector (1×1 | 2×2 | 2×2+ | custom)
│   ├── CameraGrid
│   │   └── CameraTile[] (WebRTC stream + status + detection overlay + mini PTZ)
│   ├── PresencePanel (per-person HOME/AWAY/ARRIVING/DEPARTING)
│   └── StatusBar (cameras, AI service, GPU, recording status)
├── CameraView (fullscreen)
│   ├── VideoPlayer (WebRTC 1080p)
│   ├── DetectionOverlay (SVG bounding boxes + labels + trails + interactive)
│   ├── ZoneEditorOverlay (draw/edit polygon zones + tripwires)
│   ├── PTZControls (joystick + presets + patrol toggle + auto-track toggle)
│   └── RecordingIndicator
├── EventLog
│   ├── FilterBar (camera, person, type, behavior, date range, known/unknown)
│   ├── EventTable (identity, direction, journey, behavior, camera, timestamp, snapshot)
│   ├── EventDetail (expanded: clip, journey trail, behavioral context)
│   └── DailySummary (LLM-generated report)
├── PersonDirectory
│   ├── PersonList (name, thumbnail, status, presence, image count, threshold)
│   ├── PersonDetail (gallery, auto-enrolled images, negative gallery, enable/disable, adaptive threshold)
│   └── EnrollmentModal (upload | capture | select from event)
├── ZoneEditor (per-camera)
│   ├── CameraPreview (static frame or live)
│   ├── PolygonDrawTool (draw/edit/delete zones)
│   ├── TripwireDrawTool (draw directional lines)
│   ├── ZoneProperties (type, name, color, alerts, loiter threshold)
│   └── ZoneList (all zones for camera)
├── Analytics
│   ├── DateRangeSelector
│   ├── HeatmapPanel (per-camera detection heatmap)
│   ├── ActivityGraph (detections per hour/day, stacked by camera)
│   ├── PresenceTimeline (per-person home/away over time)
│   └── ZoneTrafficPanel (in/out counts per zone per day)
├── FloorPlan
│   ├── FloorPlanCanvas (uploaded image + camera icons + person dots + trails)
│   ├── PersonDot[] (color-coded, labeled, animated)
│   ├── TrailLine[] (fading movement history)
│   ├── CameraIcon[] (clickable → jump to feed)
│   └── FloorPlanEditor (place cameras, set FOV, upload image)
├── SituationRoom
│   ├── AlertsPanel (prioritized alert list, real-time)
│   ├── FloorMapMini (embedded floor plan with live dots)
│   ├── ActiveCameraFeed (click dot → shows feed with overlay)
│   ├── PersonStatusPanel (all known persons + presence state + last seen)
│   └── EventTimeline (horizontal scrubber with event markers)
└── Settings
    ├── CameraManagement (IP, model, label, stream URLs, PTZ config)
    ├── TopologyEditor (camera connections, transit times)
    ├── AIConfig (GPU, models, thresholds, quality gate, auto-enrollment, adaptive thresholds)
    ├── PTZConfig (presets, patrol schedules, auto-track settings, dead zone)
    ├── ZoneDefaults (default loiter threshold, zone colors)
    ├── RecordingConfig (mode, retention, storage path)
    ├── TelegramConfig (token, chat ID, test, global toggle, per-person rules, DND)
    ├── LLMConfig (Ollama endpoint, model, summary schedule)
    ├── SoundDetectionConfig (enabled events, sensitivity)
    ├── RetentionConfig (period, auto-purge, purge all)
    ├── LayoutPreferences (default layout, mini PTZ toggle)
    └── SystemInfo (GPU, VRAM, AI models loaded, recording storage used)
```

---

## 4. Technical Specifications

### 4.1 Application Core — Electron Main Process Services

#### Existing Services (Enhanced)

| Service | File | v1.0 Role | v2.0 Enhancements |
|---------|------|-----------|-------------------|
| **StreamManager** | `services/StreamManager.ts` | FFmpeg RTSP decode, frame routing | Dual-stream management (main→WebRTC, sub→AI); go2rtc proxy configuration; 4 logical camera support |
| **DetectionPipeline** | `services/DetectionPipeline.ts` | Motion → face detection → recognition | Object detection (YOLO) → tracking (ByteTrack) → face recognition (on person crops only) → quality gate → zone check → behavior analysis |
| **EventProcessor** | `services/EventProcessor.ts` | Centroid tracking, line-crossing | Enhanced with zone events, journey events, presence transitions, behavioral alerts, sound events |
| **TelegramService** | `services/TelegramService.ts` | Alert formatting, throttling | Per-person rules, daily LLM summary delivery, camera group dedup, enhanced formatting with journey context |
| **DatabaseService** | `services/DatabaseService.ts` | SQLite CRUD | Expanded schema (zones, tracks, journeys, presence, recordings, topology, analytics) |
| **AIBridgeService** | `services/AIBridgeService.ts` | HTTP to sidecar (detect, recognize, enroll) | New endpoints: detect_objects, zone_check, reid, gait, sound, liveness, llm_summary |
| **ProcessManager** | `services/ProcessManager.ts` | Python sidecar lifecycle | Also manages Ollama process; go2rtc process; health checks for all |

#### New Services

| Service | File | Role |
|---------|------|------|
| **PTZService** | `services/PTZService.ts` | PTZ abstraction layer (Tapo + ONVIF); auto-tracking controller (PID); preset patrol scheduler; zoom-on-demand; coordinated multi-camera handoff |
| **PresenceService** | `services/PresenceService.ts` | Per-person 5-state FSM (HOME/AT_GATE/AWAY/ARRIVING/DEPARTING); timeout-based transitions; emits presence change events |
| **JourneyService** | `services/JourneyService.ts` | Cross-camera journey correlation using topology graph; journey start/update/complete lifecycle; journey event generation |
| **ZoneService** | `services/ZoneService.ts` | Zone CRUD; point-in-polygon checks; loitering timer management; zone event generation |
| **RecordingService** | `services/RecordingService.ts` | go2rtc recording control; segment management; retention/cleanup; timeline index |
| **TopologyService** | `services/TopologyService.ts` | Camera connectivity graph; transit time validation; anomaly detection (skip, delay, disappearance); predictive handoff |
| **AnalyticsService** | `services/AnalyticsService.ts` | Aggregates detection data for heatmaps, activity graphs, presence timelines, zone traffic; periodic rollup |
| **SoundService** | `services/SoundService.ts` | Routes audio frames to AI sidecar; processes sound event results; generates alerts |
| **WebRTCService** | `services/WebRTCService.ts` | Manages go2rtc WebRTC signaling for renderer; stream lifecycle; fallback to raw frame IPC if WebRTC fails |
| **OllamaService** | `services/OllamaService.ts` | Manages Ollama process lifecycle; daily summary generation; LLM prompt construction from event data |

### 4.2 IPC Contract (Main ↔ Renderer) — Updated

#### Inherited from v1.0 (preserved)

All v1.0 IPC channels remain unchanged. See PRD v1.0 Section 4.2.

#### New IPC Channels

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| **Streaming** | | | |
| `webrtc:signal` | Renderer ↔ Main | `{ cameraId, sdp/ice }` | WebRTC signaling for go2rtc |
| `webrtc:start` | Renderer → Main | `{ cameraId }` | Start WebRTC stream |
| `webrtc:stop` | Renderer → Main | `{ cameraId }` | Stop WebRTC stream |
| **Detection & Tracking** | | | |
| `ai:objects` | Main → Renderer | `{ cameraId, objects: TrackedObject[], timestamp }` | YOLO + ByteTrack results for overlay |
| `ai:tracks` | Main → Renderer | `{ cameraId, tracks: TrackTrail[] }` | Track trail data for visualization |
| **Zones** | | | |
| `zone:save` | Renderer → Main | `{ cameraId, zones: Zone[] }` | Save zone configuration |
| `zone:get` | Renderer → Main | `{ cameraId }` → `Zone[]` | Get zones for camera |
| `zone:event` | Main → Renderer | `{ zoneId, type, personId?, trackId, timestamp }` | Real-time zone event |
| **Presence & Journey** | | | |
| `presence:update` | Main → Renderer | `{ personId, state, previousState, timestamp }` | Presence state change |
| `presence:list` | Renderer → Main | `{}` → `PresenceState[]` | Get all current presence states |
| `journey:update` | Main → Renderer | `{ journeyId, personId, path: JourneyStep[], status }` | Journey progress update |
| `journey:list` | Renderer → Main | `{ filters }` → `Journey[]` | Query journeys |
| **PTZ** | | | |
| `ptz:autotrack:start` | Renderer → Main | `{ cameraId, trackId }` | Start auto-tracking a person |
| `ptz:autotrack:stop` | Renderer → Main | `{ cameraId }` | Stop auto-tracking |
| `ptz:patrol:start` | Renderer → Main | `{ cameraId }` | Start patrol mode |
| `ptz:patrol:stop` | Renderer → Main | `{ cameraId }` | Stop patrol mode |
| `ptz:preset:save` | Renderer → Main | `{ cameraId, presetId, name }` | Save current position as preset |
| `ptz:preset:goto` | Renderer → Main | `{ cameraId, presetId }` | Go to preset |
| `ptz:preset:list` | Renderer → Main | `{ cameraId }` → `Preset[]` | List presets |
| `ptz:zoom:to` | Renderer → Main | `{ cameraId, bbox }` | Zoom to bounding box (zoom-on-demand) |
| **Recording** | | | |
| `recording:start` | Renderer → Main | `{ cameraId, mode }` | Start recording |
| `recording:stop` | Renderer → Main | `{ cameraId }` | Stop recording |
| `recording:status` | Main → Renderer | `{ cameraId, recording, mode, diskUsage }` | Recording status |
| `recording:segments` | Renderer → Main | `{ cameraId, timeRange }` → `Segment[]` | Query recording segments |
| `recording:playback` | Renderer → Main | `{ cameraId, timestamp }` → `{ streamUrl }` | Start playback at timestamp |
| **Analytics** | | | |
| `analytics:heatmap` | Renderer → Main | `{ cameraId, timeRange }` → `HeatmapData` | Get detection heatmap |
| `analytics:activity` | Renderer → Main | `{ timeRange, groupBy }` → `ActivityData` | Get activity graph data |
| `analytics:presence` | Renderer → Main | `{ personId, timeRange }` → `PresenceTimeline` | Get presence timeline |
| `analytics:zoneTraffic` | Renderer → Main | `{ zoneId, timeRange }` → `TrafficData` | Get zone traffic data |
| **Floor Plan** | | | |
| `floorplan:save` | Renderer → Main | `{ imagePath, cameras: CameraPlacement[] }` | Save floor plan config |
| `floorplan:get` | Renderer → Main | `{}` → `FloorPlanConfig` | Get floor plan config |
| `floorplan:positions` | Main → Renderer | `{ persons: PersonPosition[] }` | Real-time person positions on map |
| **Topology** | | | |
| `topology:save` | Renderer → Main | `{ edges: TopologyEdge[], blindSpotMaxSec }` | Save topology config |
| `topology:get` | Renderer → Main | `{}` → `TopologyConfig` | Get topology config |
| `topology:anomaly` | Main → Renderer | `{ type, details, timestamp }` | Topology anomaly alert |
| **Sound** | | | |
| `sound:event` | Main → Renderer | `{ cameraId, eventType, confidence, timestamp }` | Sound event detected |
| **LLM** | | | |
| `llm:summary` | Renderer → Main | `{ date }` → `{ summary: string }` | Get/generate daily summary |
| `llm:status` | Main → Renderer | `{ ollamaRunning, modelLoaded, modelName }` | Ollama service status |
| **Liveness** | | | |
| `liveness:result` | Main → Renderer | `{ cameraId, faceIdx, isLive, score }` | Liveness check result |

### 4.3 AI Microservice — Python FastAPI Sidecar (Expanded)

#### Existing Endpoints (Enhanced)

| Endpoint | Method | Changes in v2.0 |
|----------|--------|-----------------|
| `/health` | GET | Add: `yolo_loaded`, `reid_loaded`, `gait_loaded`, `sound_loaded`, `ollama_status` |
| `/detect` | POST | Add: quality gate scores (yaw, pitch, blur, det_score); night enhancement auto-applied; liveness score |
| `/recognize` | POST | Add: adaptive per-person threshold; negative gallery check; multi-frame confirmation state |
| `/enroll` | POST | Add: auto-enrollment source type; quality validation |
| `/person/{id}` | DELETE/PUT | Unchanged |
| `/persons` | GET | Add: `adaptive_threshold`, `auto_enrolled_count`, `negative_count` per person |
| `/config` | POST | Expanded: YOLO config, quality gate thresholds, auto-enrollment toggles, night enhancement, liveness |

#### New Endpoints

| Endpoint | Method | Request Body | Response Body | Purpose |
|----------|--------|-------------|---------------|---------|
| `/detect_objects` | POST | `{ camera_id, frame_base64, timestamp }` | `{ objects: [{ class, bbox, confidence, track_id }] }` | YOLO object detection + ByteTrack tracking |
| `/track_state` | GET | `?camera_id=X` | `{ tracks: [{ track_id, class, bbox, velocity, trail }] }` | Get current tracking state per camera |
| `/zone_check` | POST | `{ camera_id, objects, zones }` | `{ events: [{ zone_id, track_id, event_type }] }` | Check objects against zone definitions |
| `/reid/extract` | POST | `{ camera_id, person_crop_base64 }` | `{ embedding: float[256], quality: float }` | Extract body Re-ID embedding from person crop |
| `/reid/match` | POST | `{ embedding, gallery }` | `{ matched, global_person_id, confidence }` | Match Re-ID embedding against gallery |
| `/gait/analyze` | POST | `{ camera_id, track_id, frames_base64[] }` | `{ gait_embedding: float[], confidence }` | Extract gait features from walking sequence |
| `/liveness` | POST | `{ face_crop_base64 }` | `{ is_live: bool, score: float, method }` | Anti-spoofing liveness check |
| `/sound/classify` | POST | `{ audio_base64, duration_ms }` | `{ events: [{ class, confidence, start_ms, end_ms }] }` | YAMNet audio event classification |
| `/negative/add` | POST | `{ person_id, crop_base64 }` | `{ success, negative_id }` | Add crop to person's negative gallery |
| `/negative/list` | GET | `?person_id=X` | `{ negatives: [{ id, thumbnail_base64 }] }` | List negative gallery entries |
| `/negative/{id}` | DELETE | — | `{ success }` | Remove negative gallery entry |
| `/auto_enroll` | POST | `{ person_id, crop_base64, quality_score, similarity }` | `{ success, auto_enrolled_count }` | Runtime auto-enrollment |
| `/llm/summary` | POST | `{ events_json, date }` | `{ summary: string }` | Generate daily summary via Ollama |

#### AI Models Inventory

| Model | Purpose | Runtime | VRAM (est.) | Inference Speed (RTX 4090) |
|-------|---------|---------|-------------|---------------------------|
| InsightFace buffalo_l (RetinaFace) | Face detection | ONNX + CUDA | ~500MB | <50ms/frame |
| InsightFace buffalo_l (ArcFace) | Face recognition (512-dim) | ONNX + CUDA | ~300MB | <20ms/embedding |
| YOLOv8s | Object detection (person/vehicle/animal) | PyTorch + CUDA | ~200MB | <15ms/frame |
| ByteTrack | Multi-object tracking | CPU (lightweight) | ~0MB | <2ms/frame |
| OSNet-AIN | Body Re-ID (256-dim) | ONNX + CUDA | ~100MB | ~2ms/crop |
| GaitGL (or GaitSet) | Gait recognition | ONNX + CUDA | ~200MB | ~15ms/sequence |
| MiniFASNet | Liveness/anti-spoofing | ONNX + CUDA | ~50MB | ~5ms/crop |
| YAMNet | Audio event classification | TFLite / ONNX | ~50MB | ~10ms/segment |
| Ollama (Llama 3.2 7B or similar) | Daily report generation | Ollama (CUDA) | ~4-6GB | ~5-10s/report |
| **Total estimated VRAM** | | | **~6-8GB** | (well within 24GB RTX 4090) |

### 4.4 Enhanced Detection Pipeline (End-to-End Flow)

```
Camera (RTSP)
    │
    ├── Main Stream (1080p) ──► go2rtc ──► WebRTC ──► Renderer <video>
    │
    └── Sub-Stream (720p) ──► FFmpeg decode ──► AI Pipeline
                                                    │
                                                    ▼
                                        ┌─────────────────────┐
                                        │   YOLO Object Det.   │
                                        │   (person/vehicle/   │
                                        │    animal classes)    │
                                        └──────────┬──────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │   ByteTrack Tracker  │
                                        │  (persistent IDs     │
                                        │   per camera)        │
                                        └──────────┬──────────┘
                                                   │
                              ┌─────────────────────┼─────────────────────┐
                              │                     │                     │
                              ▼                     ▼                     ▼
                    ┌──────────────┐    ┌──────────────────┐   ┌──────────────┐
                    │ Zone Check   │    │ Person Crops      │   │ Audio Stream │
                    │ (point-in-   │    │ (face + body)     │   │ (YAMNet)     │
                    │  polygon)    │    │                    │   │              │
                    └──────┬───────┘    └────────┬─────────┘   └──────┬───────┘
                           │                     │                     │
                           │            ┌────────┴────────┐           │
                           │            │                 │           │
                           │            ▼                 ▼           │
                           │  ┌──────────────┐  ┌──────────────┐     │
                           │  │ Face Pipeline │  │ Body Re-ID   │     │
                           │  │ CLAHE → Det → │  │ (OSNet-AIN)  │     │
                           │  │ Quality Gate →│  │              │     │
                           │  │ Recognition → │  └──────┬───────┘     │
                           │  │ Liveness      │         │             │
                           │  └──────┬───────┘         │             │
                           │         │                  │             │
                           ▼         ▼                  ▼             ▼
                    ┌─────────────────────────────────────────────────────┐
                    │                  Event Processor                     │
                    │  • Identity fusion (face 0.7 + body 0.3)           │
                    │  • Camera group dedup                              │
                    │  • Zone events (enter/exit/loiter)                  │
                    │  • Behavioral analysis (loiter/run/time anomaly)   │
                    │  • Journey correlation (via topology)               │
                    │  • Presence state machine update                    │
                    │  • Sound event correlation                          │
                    └──────────┬──────────────────────────────┬──────────┘
                               │                              │
                    ┌──────────▼──────────┐       ┌──────────▼──────────┐
                    │    Renderer (IPC)    │       │   TelegramService   │
                    │  • Overlay data     │       │  • Alerts           │
                    │  • Events           │       │  • Daily summary    │
                    │  • Presence panel   │       │  • Camera group     │
                    │  • Floor plan dots  │       │    dedup applied    │
                    └─────────────────────┘       └─────────────────────┘
```

---

## 5. Data Specifications

### 5.1 SQLite Schema — v2.0 (Expanded)

#### Inherited Tables (Enhanced)

```sql
-- Camera configuration (ENHANCED: 4 logical cameras, PTZ capabilities, dual-stream)
CREATE TABLE cameras (
    id TEXT PRIMARY KEY,              -- 'CAM-1', 'CAM-2A', 'CAM-2B', 'CAM-3'
    label TEXT NOT NULL,              -- 'SALA', 'Front Gate (Wide)', etc.
    ip_address TEXT NOT NULL,
    model TEXT,                       -- 'Tapo C520WS', 'Tapo C246D HW1.0'
    type TEXT,                        -- 'indoor', 'outdoor'
    rtsp_main_url TEXT,              -- Main stream: 'rtsp://....:554/stream1' (1080p, display)
    rtsp_sub_url TEXT,               -- Sub stream: 'rtsp://....:554/stream2' (720p, AI)
    has_ptz BOOLEAN DEFAULT 0,
    ptz_type TEXT,                    -- 'tapo', 'onvif', NULL
    camera_group_id TEXT,            -- e.g., 'GATE_GROUP' for CAM-2A/CAM-2B dedup
    line_crossing_config TEXT,        -- JSON (legacy, replaced by zones in v2.0)
    heuristic_direction TEXT,         -- 'ENTER', 'EXIT', 'INSIDE', or NULL
    motion_sensitivity INTEGER DEFAULT 50,
    enabled BOOLEAN DEFAULT 1,
    -- Floor plan placement
    floor_x REAL,                    -- X coordinate on floor plan (0.0-1.0 normalized)
    floor_y REAL,                    -- Y coordinate on floor plan (0.0-1.0 normalized)
    floor_fov_deg REAL,              -- Field of view angle in degrees (for visualization)
    floor_rotation_deg REAL,         -- Camera facing direction on floor plan
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Known persons (ENHANCED: presence state, adaptive threshold)
CREATE TABLE persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    label TEXT,
    enabled BOOLEAN DEFAULT 1,
    telegram_notify TEXT DEFAULT 'silent_log',  -- 'immediate', 'silent_log', 'daily_summary'
    presence_state TEXT DEFAULT 'UNKNOWN',       -- 'HOME', 'AT_GATE', 'AWAY', 'ARRIVING', 'DEPARTING', 'UNKNOWN'
    presence_updated_at DATETIME,
    last_seen_camera_id TEXT,
    last_seen_at DATETIME,
    adaptive_threshold REAL,                     -- per-person recognition threshold (0.45-0.65)
    auto_enroll_enabled BOOLEAN DEFAULT 1,
    auto_enroll_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Face embeddings (ENHANCED: auto-enrollment metadata, quality score)
CREATE TABLE face_embeddings (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    source_type TEXT NOT NULL,        -- 'upload', 'capture', 'event_clip', 'auto_enroll'
    source_reference TEXT,
    quality_score REAL,               -- face quality score at enrollment time
    is_auto_enrolled BOOLEAN DEFAULT 0,
    auto_enroll_expires_at DATETIME,  -- NULL for manual enrollments, 30 days for auto
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Detection / entry-exit events (ENHANCED: track IDs, journey refs, behavior type, sound events)
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id),
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    person_name TEXT,
    is_known BOOLEAN NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL DEFAULT 'detection', -- 'detection', 'zone_enter', 'zone_exit', 'loiter',
                                                   -- 'journey', 'presence_change', 'behavior', 'sound',
                                                   -- 'topology_anomaly', 'liveness_fail'
    direction TEXT,                    -- 'ENTER', 'EXIT', 'INSIDE', or NULL
    detection_method TEXT,             -- 'line_crossing', 'heuristic', 'zone', 'tripwire'
    confidence REAL,
    track_id INTEGER,                  -- ByteTrack persistent ID (per camera)
    global_person_id TEXT,             -- Cross-camera Re-ID global ID
    bbox TEXT,                         -- JSON: {"x1":0,"y1":0,"x2":0,"y2":0}
    snapshot_path TEXT,
    clip_path TEXT,
    zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
    journey_id TEXT REFERENCES journeys(id) ON DELETE SET NULL,
    behavior_type TEXT,                -- 'loiter', 'running', 'pacing', 'tailgating', 'tampering',
                                       -- 'crowd', 'wrong_direction', 'time_anomaly'
    behavior_details TEXT,             -- JSON: context-specific details
    sound_event_type TEXT,             -- 'glass_break', 'gunshot', 'scream', 'dog_bark', 'horn'
    sound_confidence REAL,
    liveness_score REAL,
    is_live BOOLEAN,
    identity_method TEXT,              -- 'face', 'body_reid', 'gait', 'fused', NULL
    identity_fusion_score REAL,        -- Weighted fusion confidence
    telegram_sent BOOLEAN DEFAULT 0,
    telegram_sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Application settings (unchanged)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### New Tables

```sql
-- Zone definitions (polygon zones + tripwires per camera)
CREATE TABLE zones (
    id TEXT PRIMARY KEY,               -- UUID v4
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                -- 'Front Door Zone', 'Driveway Tripwire'
    zone_type TEXT NOT NULL,           -- 'RESTRICTED', 'MONITORED', 'COUNTING', 'TRIPWIRE'
    geometry TEXT NOT NULL,            -- JSON: polygon [{x,y},...] or line {x1,y1,x2,y2,direction}
    color TEXT DEFAULT '#FF0000',      -- Display color (hex)
    alert_enabled BOOLEAN DEFAULT 1,
    loiter_threshold_sec INTEGER DEFAULT 15,  -- Loitering threshold (seconds)
    loiter_cooldown_sec INTEGER DEFAULT 180,
    loiter_movement_radius REAL DEFAULT 80.0,
    enter_count INTEGER DEFAULT 0,     -- Running count for COUNTING zones
    exit_count INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Negative gallery (false positive face crops)
CREATE TABLE negative_gallery (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    crop_thumbnail BLOB,              -- Small JPEG for UI display
    source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cross-camera journeys
CREATE TABLE journeys (
    id TEXT PRIMARY KEY,               -- UUID v4
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    person_name TEXT,
    global_person_id TEXT,             -- Re-ID global ID (for unknown persons)
    status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'expired'
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    total_duration_sec REAL,
    path TEXT NOT NULL,                -- JSON: [{"camera_id":"CAM-2A","timestamp":"...","action":"enter"}, ...]
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Presence state history (for analytics timeline)
CREATE TABLE presence_history (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    state TEXT NOT NULL,               -- 'HOME', 'AT_GATE', 'AWAY', 'ARRIVING', 'DEPARTING'
    previous_state TEXT,
    trigger_camera_id TEXT REFERENCES cameras(id),
    trigger_reason TEXT,               -- 'detection', 'timeout', 'manual'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Camera topology edges
CREATE TABLE topology_edges (
    id TEXT PRIMARY KEY,
    from_camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    to_camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    transit_min_sec INTEGER NOT NULL,
    transit_max_sec INTEGER NOT NULL,
    direction TEXT,                    -- 'inbound', 'outbound', 'bidirectional'
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recording segments
CREATE TABLE recording_segments (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    duration_sec REAL NOT NULL,
    file_size_bytes INTEGER,
    format TEXT DEFAULT 'mp4',         -- 'mp4', 'hls'
    recording_mode TEXT DEFAULT 'continuous',  -- 'continuous', 'event_triggered'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Body Re-ID gallery (short-term: last 5 min per track)
CREATE TABLE reid_gallery (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    global_person_id TEXT,             -- Assigned after cross-camera match
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,  -- If face-matched
    body_embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    clothing_descriptor TEXT,          -- JSON: dominant colors, estimated height
    first_seen_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,      -- Auto-expire after 5 minutes of inactivity
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Gait profiles (persistent per person)
CREATE TABLE gait_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    gait_embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    source_camera_id TEXT,
    quality_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PTZ presets
CREATE TABLE ptz_presets (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    preset_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    pan_position REAL,
    tilt_position REAL,
    zoom_level REAL,
    dwell_sec INTEGER DEFAULT 10,      -- Patrol dwell time at this preset
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(camera_id, preset_id)
);

-- PTZ patrol schedules
CREATE TABLE ptz_patrol_schedules (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                -- 'Night Patrol', 'Day Patrol'
    start_time TEXT NOT NULL,          -- 'HH:MM' format
    end_time TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily LLM summaries (cached)
CREATE TABLE daily_summaries (
    id TEXT PRIMARY KEY,
    summary_date DATE NOT NULL UNIQUE,
    summary_text TEXT NOT NULL,
    model_used TEXT,                   -- 'llama3.2:7b' etc.
    event_count INTEGER,
    generated_at DATETIME NOT NULL,
    telegram_sent BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analytics rollup (pre-aggregated data for dashboard)
CREATE TABLE analytics_rollup (
    id TEXT PRIMARY KEY,
    camera_id TEXT REFERENCES cameras(id) ON DELETE CASCADE,
    zone_id TEXT REFERENCES zones(id) ON DELETE CASCADE,
    rollup_date DATE NOT NULL,
    rollup_hour INTEGER,               -- 0-23, NULL for daily rollup
    detection_count INTEGER DEFAULT 0,
    person_count INTEGER DEFAULT 0,
    known_count INTEGER DEFAULT 0,
    unknown_count INTEGER DEFAULT 0,
    zone_enter_count INTEGER DEFAULT 0,
    zone_exit_count INTEGER DEFAULT 0,
    loiter_count INTEGER DEFAULT 0,
    behavior_count INTEGER DEFAULT 0,
    sound_event_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Floor plan configuration
CREATE TABLE floor_plan (
    id TEXT PRIMARY KEY DEFAULT 'default',
    image_path TEXT,                   -- Path to uploaded floor plan image
    image_width INTEGER,
    image_height INTEGER,
    scale_meters_per_pixel REAL,       -- Optional: physical scale
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### New Indexes

```sql
-- Zones
CREATE INDEX idx_zones_camera_id ON zones(camera_id);

-- Journeys
CREATE INDEX idx_journeys_person_id ON journeys(person_id);
CREATE INDEX idx_journeys_status ON journeys(status);
CREATE INDEX idx_journeys_started_at ON journeys(started_at);

-- Presence history
CREATE INDEX idx_presence_history_person_id ON presence_history(person_id);
CREATE INDEX idx_presence_history_created_at ON presence_history(created_at);

-- Recording segments
CREATE INDEX idx_recording_segments_camera_id ON recording_segments(camera_id);
CREATE INDEX idx_recording_segments_start_time ON recording_segments(start_time);

-- Re-ID gallery
CREATE INDEX idx_reid_gallery_global_person_id ON reid_gallery(global_person_id);
CREATE INDEX idx_reid_gallery_expires_at ON reid_gallery(expires_at);

-- Events (new indexes)
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_track_id ON events(track_id);
CREATE INDEX idx_events_global_person_id ON events(global_person_id);
CREATE INDEX idx_events_journey_id ON events(journey_id);
CREATE INDEX idx_events_zone_id ON events(zone_id);

-- Analytics rollup
CREATE INDEX idx_analytics_rollup_date ON analytics_rollup(rollup_date);
CREATE INDEX idx_analytics_rollup_camera ON analytics_rollup(camera_id, rollup_date);

-- Negative gallery
CREATE INDEX idx_negative_gallery_person_id ON negative_gallery(person_id);

-- PTZ presets
CREATE INDEX idx_ptz_presets_camera_id ON ptz_presets(camera_id);

-- Daily summaries
CREATE INDEX idx_daily_summaries_date ON daily_summaries(summary_date);
```

### 5.2 Default Settings (Expanded)

#### Inherited from v1.0

| Key | Default Value | Description |
|-----|---------------|-------------|
| `telegram_bot_token` | `""` | Telegram Bot API token |
| `telegram_chat_id` | `""` | Telegram chat/group/user ID |
| `telegram_enabled` | `"false"` | Global Telegram toggle |
| `retention_days` | `"90"` | Event log retention period |
| `auto_purge_enabled` | `"true"` | Auto-delete expired events |
| `default_layout` | `"2x2"` | Default camera grid layout |
| `mini_ptz_enabled` | `"false"` | Mini PTZ on grid tiles |
| `recognition_threshold` | `"0.6"` | Global face recognition threshold |
| `detection_threshold` | `"0.5"` | Face detection confidence threshold |
| `gpu_enabled` | `"true"` | Use GPU for AI inference |
| `motion_sensitivity_default` | `"50"` | Default motion sensitivity |

#### New Settings (v2.0)

| Key | Default Value | Description |
|-----|---------------|-------------|
| **AI / Detection** | | |
| `yolo_enabled` | `"true"` | Enable YOLO object detection |
| `yolo_confidence` | `"0.5"` | YOLO detection confidence threshold |
| `yolo_classes` | `"person,car,truck,dog,cat"` | Comma-separated YOLO class filter |
| `bytetrack_enabled` | `"true"` | Enable ByteTrack multi-object tracking |
| **Face Quality Gate** | | |
| `quality_gate_enabled` | `"true"` | Enable face quality filtering |
| `quality_max_yaw_deg` | `"40.0"` | Max face yaw angle |
| `quality_max_pitch_deg` | `"30.0"` | Max face pitch angle |
| `quality_min_blur_score` | `"60.0"` | Min face blur score (Laplacian) |
| `quality_min_det_score` | `"0.72"` | Min InsightFace detection confidence |
| `quality_confirm_frames` | `"3"` | Min consecutive recognitions before alert |
| `quality_embedding_ema_alpha` | `"0.4"` | Temporal EMA smoothing factor |
| **Night Enhancement** | | |
| `night_enhance_enabled` | `"true"` | Enable CLAHE night enhancement |
| `night_luminance_threshold` | `"80.0"` | Mean luminance threshold for activation |
| **Auto-Enrollment** | | |
| `auto_enroll_enabled` | `"true"` | Enable runtime auto-enrollment |
| `auto_enroll_min_similarity` | `"0.55"` | Min similarity for auto-enroll |
| `auto_enroll_max_per_person` | `"5"` | Max auto-enrolled samples per person |
| `auto_enroll_min_quality` | `"80.0"` | Min quality score for auto-enroll |
| `auto_enroll_expiry_days` | `"30"` | Days until auto-enrolled samples expire |
| **Adaptive Threshold** | | |
| `adaptive_threshold_enabled` | `"true"` | Enable per-person adaptive thresholds |
| `adaptive_min_threshold` | `"0.45"` | Min adaptive threshold |
| `adaptive_max_threshold` | `"0.65"` | Max adaptive threshold |
| `adaptive_min_margin` | `"0.08"` | Min margin between best and second-best match |
| **Re-ID** | | |
| `reid_enabled` | `"true"` | Enable body Re-ID |
| `reid_gallery_ttl_sec` | `"300"` | Re-ID gallery entry TTL (5 min) |
| `reid_face_weight` | `"0.7"` | Face weight in identity fusion |
| `reid_body_weight` | `"0.3"` | Body weight in identity fusion |
| **Gait** | | |
| `gait_enabled` | `"false"` | Enable gait recognition (R&D) |
| `gait_min_frames` | `"30"` | Min walking frames for gait analysis (~2s) |
| **Liveness** | | |
| `liveness_enabled` | `"true"` | Enable anti-spoofing checks |
| `liveness_threshold` | `"0.5"` | Liveness score threshold |
| **Sound** | | |
| `sound_detection_enabled` | `"false"` | Enable audio event detection |
| `sound_events` | `"glass_break,gunshot,scream"` | Comma-separated sound events to detect |
| `sound_confidence_threshold` | `"0.7"` | Min confidence for sound alerts |
| **Zones** | | |
| `zone_default_loiter_sec` | `"15"` | Default loitering threshold |
| `zone_default_cooldown_sec` | `"180"` | Default loitering cooldown |
| **PTZ** | | |
| `ptz_autotrack_enabled` | `"false"` | Enable PTZ auto-tracking |
| `ptz_autotrack_dead_zone` | `"0.1"` | Dead zone (fraction of frame) |
| `ptz_autotrack_priority` | `"unknown_first"` | Track priority: 'unknown_first', 'nearest_center' |
| `ptz_patrol_mode` | `"manual"` | Patrol mode: 'always', 'scheduled', 'manual' |
| **Recording** | | |
| `recording_mode` | `"event_triggered"` | Recording mode: 'continuous', 'event_triggered', 'off' |
| `recording_retention_days` | `"30"` | Recording retention (separate from event retention) |
| `recording_storage_path` | `""` | Custom recording storage path (default: app_data) |
| `recording_segment_duration_min` | `"15"` | Segment duration in minutes |
| **WebRTC** | | |
| `webrtc_enabled` | `"true"` | Use WebRTC for display (fallback: raw IPC) |
| **LLM** | | |
| `llm_enabled` | `"false"` | Enable daily LLM summaries |
| `llm_ollama_endpoint` | `"http://localhost:11434"` | Ollama API endpoint |
| `llm_model` | `"llama3.2:7b"` | Ollama model name |
| `llm_summary_time` | `"23:00"` | Daily summary generation time (HH:MM) |
| `llm_telegram_delivery` | `"false"` | Send daily summary via Telegram |
| **Topology** | | |
| `topology_blind_spot_max_sec` | `"60"` | Max seconds person can be "missing" before alert |

### 5.3 Snapshot & Recording Storage

#### Snapshots (Enhanced from v1.0)

- **Location**: `{app_data}/snapshots/{YYYY-MM-DD}/{camera_id}/`
- **Naming**: `{timestamp_ms}_{person_name_or_unknown}_{event_type}.jpg`
- **Format**: JPEG, quality 85%
- **Retention**: Follows `retention_days` setting

#### Recordings (New)

- **Location**: `{recording_storage_path}/{camera_id}/{YYYY-MM-DD}/`
- **Naming**: `{camera_id}_{start_timestamp}.mp4`
- **Format**: MP4 (H.264), segment duration configurable
- **Retention**: Follows `recording_retention_days` setting (separate from events)
- **Index**: SQLite `recording_segments` table maps time ranges to files

---

## 6. Telegram Notification Specification (Enhanced)

### 6.1 Message Formats

#### Detection Alert (Unknown Person)
```
🚨 [ALERT] Unknown Person Detected

📷 Camera: CAM-2A (Front Gate — Wide)
👤 Person: Unknown (Track #47)
📍 Zone: Front Door Zone (RESTRICTED)
🔍 Identity: Body Re-ID match → first sighting
🕐 Time: 2026-03-03 04:15:32
📊 Confidence: 0.45 (face) | 0.82 (body)
⚠️ Behavior: Loitering (23s in RESTRICTED zone)
```
*Attached: snapshot image (best quality from CAM-2B telephoto burst)*

#### Known Person Detection
```
ℹ️ [INFO] Known Person Detected

📷 Camera: CAM-3 (Garden)
👤 Person: Angelo
📍 Direction: INBOUND
🗺️ Journey: Gate(04:14:50) → Garden(04:15:12)
🏠 Presence: ARRIVING (was AWAY)
🕐 Time: 2026-03-03 04:15:12
📊 Confidence: 0.87 (face) | 0.91 (body Re-ID)
```

#### Journey Complete
```
🗺️ [JOURNEY] Angelo Arrived Home

Path: Gate → Garden → House
Duration: 45 seconds
🕐 Arrived: 2026-03-03 04:15:55
🏠 Status: HOME
```

#### Behavioral Alert
```
⚠️ [BEHAVIOR] Suspicious Activity

📷 Camera: CAM-2A (Front Gate)
👤 Person: Unknown (Track #47)
🚨 Behavior: Loitering (45s) + Pacing (3 loops)
📍 Zone: Front Door Zone (RESTRICTED)
🕐 Time: 2026-03-03 02:30:15
💡 Context: Unusual hour (2:30 AM)
```

#### Sound Alert
```
🔊 [SOUND] Glass Breaking Detected

📷 Camera: CAM-1 (SALA)
🔊 Event: Glass Breaking
📊 Confidence: 0.92
🕐 Time: 2026-03-03 02:31:05
```

#### Daily Summary (LLM-Generated)
```
📊 Daily Security Summary — March 3, 2026

🔢 12 person detections across 4 cameras
👤 Angelo arrived home at 6:15 PM (Gate → Garden → House in 40s)
🚨 Unknown person at front gate at 2:30 AM (3 occurrences, loitered 45s)
📷 CAM-3 had highest activity (garden lights attract movement at night)
🔊 1 sound event: dog barking at CAM-3 (11:42 PM)
💡 Recommendation: Review 2:30 AM gate footage

Generated by Llama 3.2 (local)
```

### 6.2 Alert Rules (v2.0)

| Condition | Action | Priority |
|-----------|--------|----------|
| Unknown person in RESTRICTED zone | Immediate alert with snapshot | CRITICAL |
| Unknown person detected (any zone) | Immediate alert with snapshot | HIGH |
| Behavioral anomaly (loitering, running, time anomaly) | Immediate alert | HIGH |
| Sound event (glass break, gunshot, scream) | Immediate alert | CRITICAL |
| Topology anomaly (skip, disappearance) | Immediate alert | HIGH |
| Liveness failure (spoofing attempt) | Immediate alert | CRITICAL |
| Known person detected | Per-person setting: immediate / silent_log / daily_summary | LOW |
| Journey completed | Silent log (included in daily summary) | LOW |
| Daily summary ready | Send at configured time | LOW |

### 6.3 Throttling Rules (v2.0)

- **Cooldown per camera**: 30 seconds (same camera, same event type)
- **Cooldown per person**: 60 seconds (same person, any camera)
- **Camera group dedup**: Events within `GATE_GROUP` (CAM-2A + CAM-2B) deduplicated within 5-second window; best snapshot from either camera
- **Bundle window**: Multiple detections within 5s on same camera → single alert with count
- **DND override**: CRITICAL alerts (unknown in restricted zone, sound events, liveness fail) bypass DND hours

---

## 7. Security & Privacy (Enhanced)

### 7.1 Face & Body Data Encryption

- **Algorithm**: AES-256-CBC (unchanged from v1.0)
- **Scope expanded**: All biometric embeddings encrypted at rest:
  - Face embeddings (`face_embeddings.embedding_encrypted`)
  - Body Re-ID embeddings (`reid_gallery.body_embedding_encrypted`)
  - Gait embeddings (`gait_profiles.gait_embedding_encrypted`)
  - Negative gallery embeddings (`negative_gallery.embedding_encrypted`)
- **IV**: Unique 16-byte per embedding
- **Key Management**: Machine-bound key via PBKDF2 (unchanged)
- **Decryption**: In-memory only, never written to disk unencrypted

### 7.2 Stream Security

- RTSP credentials encrypted in SQLite (AES-256)
- WebRTC signaling over localhost only (no external WebRTC)
- go2rtc bound to `127.0.0.1` only
- No STUN/TURN servers (LAN only, no NAT traversal)

### 7.3 LLM Privacy

- **Local only**: Ollama runs locally, no cloud LLM API calls
- **Data stays local**: Event data sent to Ollama is localhost-only
- **No training**: Ollama models are inference-only; event data is not used for training
- **Summary storage**: Daily summaries stored in SQLite (plaintext — not biometric data)

### 7.4 Data Retention & Purge (Enhanced)

- **Events & snapshots**: Follow `retention_days` (default 90 days)
- **Recordings**: Follow `recording_retention_days` (default 30 days, separate)
- **Re-ID gallery**: Auto-expires entries after `reid_gallery_ttl_sec` (default 5 min)
- **Auto-enrolled embeddings**: Expire after `auto_enroll_expiry_days` (default 30 days)
- **Analytics rollups**: Follow `retention_days`
- **Journey records**: Follow `retention_days`
- **Presence history**: Follow `retention_days`
- **Gait profiles**: Persistent (tied to person lifecycle)
- **Purge All**: Deletes all persons, embeddings, Re-ID gallery, gait profiles, negative gallery, journeys, presence history. Events retain denormalized `person_name` but `person_id` set NULL.

### 7.5 Electron Security (Unchanged from v1.0)

- Sandbox: `true`
- Context isolation: `true`
- Node integration: `false` in renderer
- All privileged operations via Main process IPC
- Preload exposes only typed IPC channels

---

## 8. Performance Requirements (Updated)

### 8.1 Target Hardware

| Component | Specification |
|-----------|--------------|
| CPU | AMD Ryzen 9 7900 (12-core, 24-thread) |
| GPU | NVIDIA RTX 4090 (24GB VRAM) |
| RAM | 32GB DDR5 |
| Storage | NVMe SSD (for recordings) |
| OS | Windows |

### 8.2 Performance Targets (v2.0)

| Metric | Target | v1.0 Target | Notes |
|--------|--------|-------------|-------|
| Simultaneous streams (display) | 4 × 1080p @ 25-30fps | 3 × 1080p | WebRTC hardware decode |
| Simultaneous AI streams | 4 × 720p @ 10-15fps | N/A (1080p) | Sub-stream for AI processing |
| YOLO detection latency | < 15ms per frame | N/A | YOLOv8s on RTX 4090 |
| ByteTrack tracking | < 2ms per frame | N/A | CPU-based, lightweight |
| Face detection latency | < 50ms per frame | < 50ms | RetinaFace on GPU |
| Face recognition latency | < 20ms per embedding | < 20ms | ArcFace on GPU |
| Body Re-ID latency | < 3ms per crop | N/A | OSNet-AIN on GPU |
| Gait analysis latency | < 15ms per sequence | N/A | Per 2-second walking sequence |
| Liveness check | < 5ms per crop | N/A | MiniFASNet on GPU |
| Sound classification | < 10ms per segment | N/A | YAMNet on GPU |
| Motion-to-alert pipeline | < 2 seconds E2E | < 2 seconds | Including all AI stages |
| WebRTC display latency | < 100ms | N/A | go2rtc → browser decode |
| UI frame rate | 60fps | 60fps | With SVG detection overlays |
| App startup | < 8 seconds | < 5 seconds | Additional model loading (YOLO, Re-ID) |
| SQLite queries | < 100ms | < 100ms | With expanded indexes, up to 500K events |
| LLM daily summary | < 15 seconds | N/A | Ollama 7B model generation |

### 8.3 Resource Budget

| Resource | Budget | Breakdown |
|----------|--------|-----------|
| **GPU VRAM** | ≤ 10GB | InsightFace ~800MB + YOLO ~200MB + Re-ID ~100MB + Gait ~200MB + Liveness ~50MB + YAMNet ~50MB + Ollama ~6GB (on-demand) |
| **System RAM** | ≤ 6GB | Electron ~600MB + Python sidecar ~2GB + go2rtc ~200MB + FFmpeg ~800MB (4 sub-streams) + Recording buffers ~500MB |
| **CPU** | ≤ 40% avg | ByteTrack + zone checks + event processing + IPC |
| **Disk I/O** | ≤ 100MB/s sustained | Recording writes (4 cameras × ~2-5 Mbps each) |
| **Network (LAN)** | ≤ 80 Mbps | 4 main streams (~8 Mbps each) + 4 sub-streams (~2 Mbps each) |

### 8.4 CPU Fallback Mode (Enhanced)

When no CUDA GPU is available:

- **All AI models**: Fall back to ONNX Runtime CPU Execution Provider
- **Round-robin**: Process 1 camera at a time (cycle through 4 cameras)
- **Reduced features**: Disable gait recognition, sound detection, Re-ID (face-only identification)
- **YOLO fallback**: YOLOv8n (nano) instead of YOLOv8s for faster CPU inference
- **No Ollama**: LLM daily summaries disabled (insufficient resources)
- **Accept latency**: ~300-800ms per frame for full detection pipeline
- **Display**: WebRTC still uses hardware decode (separate from AI GPU)

---

## 9. Architecture — Communication Flows (Updated)

### 9.1 Allowed Flows

```
Renderer ──IPC──► Main Process                 (all UI commands, WebRTC signaling)
Main Process ──IPC──► Renderer                 (events, AI results, status, presence, floor plan)
Main Process ──HTTP──► Python Sidecar           (AI requests on localhost:8520)
Main Process ──HTTP──► Ollama                   (LLM requests on localhost:11434)
Main Process ──RTSP──► Cameras                  (via go2rtc proxy on LAN)
Main Process ──Tapo API──► Cameras              (device/PTZ control, HTTP/HTTPS on LAN)
Main Process ──ONVIF──► Cameras                 (fallback PTZ/discovery on LAN)
Main Process ──HTTPS──► Telegram API            (send notifications, outbound only)
Main Process ──SQLite──► Local DB               (all data persistence)
Python Sidecar ──SQLite──► Local DB             (face/body embeddings read for recognition)
go2rtc ──RTSP──► Cameras                        (stream ingestion on LAN)
go2rtc ──WebRTC──► Renderer                     (low-latency display, localhost only)
go2rtc ──FFmpeg──► Python Sidecar               (sub-stream frames for AI, localhost only)
go2rtc ──MP4──► Local Disk                      (recording segments)
```

### 9.2 Prohibited Flows

```
Renderer ──X──► Cameras                         (no direct camera access)
Renderer ──X──► SQLite                          (no direct DB access)
Renderer ──X──► Python Sidecar                  (no direct AI calls)
Renderer ──X──► Telegram API                    (no direct external calls)
Renderer ──X──► Ollama                          (no direct LLM calls)
Python Sidecar ──X──► Internet                  (no cloud calls, strictly local)
Ollama ──X──► Internet                          (no cloud calls, local models only)
Any Component ──X──► Cloud Face/Body APIs       (no cloud biometric processing)
go2rtc ──X──► Internet                          (no external streaming, LAN only)
```

### 9.3 Data Flow Diagram (v2.0)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              ELECTRON APP                                     │
│                                                                              │
│  ┌─────────────────────────┐           ┌───────────────────────────────────┐ │
│  │    RENDERER (React)      │◄──IPC──►│           MAIN PROCESS             │ │
│  │                          │          │                                    │ │
│  │  • Dashboard (4-cam grid)│          │  Existing (Enhanced):              │ │
│  │  • Camera View + Overlay │          │  • StreamManager (dual-stream)     │ │
│  │  • Event Log + Summary   │          │  • DetectionPipeline (YOLO+face)   │ │
│  │  • Person Directory      │          │  • EventProcessor (expanded)       │ │
│  │  • Zone Editor           │          │  • AIBridgeService (new endpoints) │ │
│  │  • Analytics Dashboard   │          │  • TelegramService (enhanced)      │ │
│  │  • Floor Plan Map        │          │  • DatabaseService (expanded)      │ │
│  │  • Situation Room        │          │  • ProcessManager (Ollama+go2rtc)  │ │
│  │  • Settings (expanded)   │          │                                    │ │
│  │                          │          │  New Services:                     │ │
│  │  WebRTC <video> ◄────────┼──────────┤  • PTZService (abstraction+auto)  │ │
│  │  SVG Detection Overlay   │          │  • PresenceService (5-state FSM)   │ │
│  │  Canvas Floor Plan       │          │  • JourneyService (cross-camera)   │ │
│  │                          │          │  • ZoneService (polygon+tripwire)  │ │
│  └─────────────────────────┘          │  • RecordingService (go2rtc rec)   │ │
│                                        │  • TopologyService (spatial graph) │ │
│                                        │  • AnalyticsService (rollups)      │ │
│                                        │  • SoundService (audio events)     │ │
│                                        │  • WebRTCService (signaling)       │ │
│                                        │  • OllamaService (daily reports)   │ │
│                                        └──────┬────────────┬───────────────┘ │
│                                               │            │                  │
└───────────────────────────────────────────────┼────────────┼──────────────────┘
                                                │            │
                      ┌─────────────────────────┼────────────┼────────────────┐
                      │                         │            │                │
                      │  ┌──────────────────────▼──────┐    │                │
                      │  │    PYTHON SIDECAR (FastAPI)  │    │                │
                      │  │    localhost:8520             │    │                │
                      │  │                              │    │                │
                      │  │  AI Models:                  │    │                │
                      │  │  • InsightFace buffalo_l     │    │                │
                      │  │  • YOLOv8s + ByteTrack      │    │                │
                      │  │  • OSNet-AIN (Re-ID)        │    │                │
                      │  │  • GaitGL (gait)            │    │                │
                      │  │  • MiniFASNet (liveness)    │    │                │
                      │  │  • YAMNet (sound)           │    │                │
                      │  │                              │    │                │
                      │  │  Services:                   │    │                │
                      │  │  • Object detection          │    │                │
                      │  │  • Face quality gate         │    │                │
                      │  │  • Night enhancement (CLAHE) │    │                │
                      │  │  • Body Re-ID matching       │    │                │
                      │  │  • Gait analysis             │    │                │
                      │  │  • Anti-spoofing             │    │                │
                      │  │  • Sound classification      │    │                │
                      │  │  • Negative gallery check    │    │                │
                      │  │  • Auto-enrollment           │    │                │
                      │  │  • Adaptive thresholds       │    │                │
                      │  └──────────────┬───────────────┘    │                │
                      │                 │                     │                │
                      │  ┌──────────────▼───────────────┐    │                │
                      │  │    OLLAMA (Local LLM)         │    │                │
                      │  │    localhost:11434             │    │                │
                      │  │    Llama 3.2 7B               │    │                │
                      │  │    • Daily security summaries │    │                │
                      │  └──────────────────────────────┘    │                │
                      │                                       │                │
                      │  ┌────────────────────────────────────▼──────────────┐│
                      │  │    go2rtc                                          ││
                      │  │    localhost:1984 (API) / :8555 (WebRTC)           ││
                      │  │                                                    ││
                      │  │  • RTSP ingestion from cameras                    ││
                      │  │  • WebRTC output to renderer                      ││
                      │  │  • FFmpeg sub-stream to AI sidecar                ││
                      │  │  • MP4 recording to disk                          ││
                      │  └────────────────────────────────────────────────────┘│
                      │                                                        │
                      │  ┌────────────────────────────────────────────────────┐│
                      │  │    SQLite Database                                  ││
                      │  │                                                    ││
                      │  │  Inherited: cameras, persons, face_embeddings,     ││
                      │  │            events, settings                        ││
                      │  │                                                    ││
                      │  │  New: zones, negative_gallery, journeys,           ││
                      │  │       presence_history, topology_edges,            ││
                      │  │       recording_segments, reid_gallery,            ││
                      │  │       gait_profiles, ptz_presets,                  ││
                      │  │       ptz_patrol_schedules, daily_summaries,       ││
                      │  │       analytics_rollup, floor_plan                 ││
                      │  └────────────────────────────────────────────────────┘│
                      │                                                        │
                      │                    LOCAL MACHINE                        │
                      └────────────────────────────────────────────────────────┘

                      ┌────────────────────────────┐
                      │    LAN CAMERAS (4 logical)  │
                      │                            │
                      │  CAM-1:  192.168.100.213   │
                      │  (SALA, C520WS, PTZ)       │
                      │                            │
                      │  CAM-2A: 192.168.100.214   │
                      │  (Gate Wide, C246D Lens 1)  │
                      │                            │
                      │  CAM-2B: 192.168.100.214   │
                      │  (Gate Tele, C246D Lens 2,  │
                      │   PTZ, Group: GATE_GROUP)   │
                      │                            │
                      │  CAM-3:  192.168.100.215   │
                      │  (Garden, C520WS, PTZ)     │
                      │                            │
                      │  Protocols: RTSP, Tapo API, │
                      │  ONVIF                      │
                      └────────────────────────────┘

                      ┌────────────────────────────┐
                      │    TELEGRAM API              │
                      │    (outbound HTTPS only)     │
                      │  • Detection alerts          │
                      │  • Behavioral alerts         │
                      │  • Sound alerts              │
                      │  • Journey notifications     │
                      │  • Daily LLM summaries       │
                      └────────────────────────────┘
```

---

## 10. Implementation Phases

### Phase 1 — Foundation Fixes (CRITICAL, 1-2 days)

| Task | Description | Dependencies | Deliverables |
|------|-------------|-------------|-------------|
| **1.1 Fix CUDA/GPU** | Install matching CUDA 12.x toolkit + cuDNN; pin `onnxruntime-gpu` to compatible version; verify GPU inference | None | GPU loads successfully; `nvidia-smi` + ONNX CUDA EP confirmed; 5-10x speedup measured |
| **1.2 Dual-Stream Architecture** | Configure go2rtc for main (1080p) + sub (720p) streams per camera; route main→WebRTC, sub→AI sidecar via FFmpeg | 1.1 | Separate display and AI paths; AI processes 720p (4x less data); go2rtc.yaml updated for 4 logical cameras |

### Phase 2 — Core AI: Port FaceTracker (HIGH, 3-5 days)

| Task | Description | Dependencies | Deliverables |
|------|-------------|-------------|-------------|
| **2.1 YOLO + ByteTrack** | Add `ultralytics` to sidecar; new `/detect_objects` endpoint; per-camera ByteTrack state; face recognition only on person-class crops | Phase 1 | Object detection with persistent track IDs; eliminates false positives from non-person motion |
| **2.2 Face Quality Gate** | Add quality scoring (yaw, pitch, blur, det_score) to `/detect`; multi-frame confirmation (3 frames); weighted voting with EMA smoothing | Phase 1 | Spam alerts eliminated; only clear, front-facing faces trigger alerts |
| **2.3 Night Enhancement (CLAHE)** | Add CLAHE preprocessing to sidecar; auto-activate below luminance threshold; configurable | Phase 1 | Improved night detection; `night_enhance_enabled` setting |
| **2.4 Auto-Enrollment** | New `/auto_enroll` endpoint; runtime augmentation logic; expiry management; Settings toggle | 2.2 | Self-improving recognition; up to 5 auto-enrolled samples/person; 30-day expiry |
| **2.5 Negative Gallery** | New DB table + endpoints (`/negative/add`, `/negative/list`, `/negative/{id}`); UI: right-click detection → "Mark as False Positive"; similarity check during recognition | 2.1 | Known false positives rejected; manageable in Person Directory |

### Phase 3 — Intelligence Layer: Port FaceTracker (HIGH, 3-5 days)

| Task | Description | Dependencies | Deliverables |
|------|-------------|-------------|-------------|
| **3.1 Zone Detection System** | New `zones` table; `ZoneService`; point-in-polygon checks; Zone Editor UI (polygon + tripwire drawing); zone types (RESTRICTED, MONITORED, COUNTING, TRIPWIRE) | 2.1 | Configurable zones per camera; visual zone editor; zone events in Event Log |
| **3.2 Loitering Detection** | Timer-based loitering in `ZoneService`; per-zone threshold/cooldown; loiter events + Telegram alerts | 2.1, 3.1 | Alerts when person lingers > threshold in zone |
| **3.3 Journey Tracking** | `JourneyService`; cross-camera correlation using topology graph; journey lifecycle (active→complete→expire); journey events | 2.1, Topology config | "Angelo: Gate → Garden → House in 45s" events |
| **3.4 Presence Tracking** | `PresenceService`; 5-state FSM per person; Dashboard presence panel; timeout-based AWAY transition; presence history for analytics | 3.3 | HOME/AWAY/ARRIVING/DEPARTING states; presence panel in Dashboard |
| **3.5 Tele Burst Capture** | CAM-2A detection triggers CAM-2B burst capture (5 frames); best-quality frame selection; used for Telegram snapshots | 2.1 | Higher quality face images for gate detections |
| **3.6 Camera Group Dedup** | `GATE_GROUP` dedup logic in `EventProcessor`; 5-second dedup window; best snapshot from group | 2.1 | Single alert per detection across CAM-2A/2B |

### Phase 4 — Advanced Features: Beyond FaceTracker (MEDIUM, 5-10 days)

| Task | Description | Dependencies | Deliverables |
|------|-------------|-------------|-------------|
| **4.1 Real-Time Detection Overlay** | SVG/Canvas overlay on WebRTC video in renderer; bounding boxes, names, confidence, track trails; interactive (click/right-click actions); smooth interpolation | 2.1, 4.2 | Interactive detection visualization; click-to-enroll, right-click negative gallery |
| **4.2 WebRTC Streaming** | `WebRTCService`; go2rtc WebRTC signaling; renderer `<video>` element; fallback to raw IPC | Phase 1 | <100ms display latency; 100x less IPC bandwidth; hardware H.264 decode |
| **4.3 DVR/NVR Recording** | `RecordingService`; go2rtc MP4 recording; segment management; timeline scrubber UI; event markers; playback at timestamp | 4.2 | Continuous or event-triggered recording; timeline UI with event jump |
| **4.4 Analytics Dashboard** | `AnalyticsService`; `analytics_rollup` table; new "Analytics" screen; heatmap, activity graph, presence timeline, zone traffic; recharts/nivo | 3.1, 3.4 | Visual analytics with date range filtering |
| **4.5 LLM Daily Reports** | `OllamaService`; daily summary generation at scheduled time; prompt construction from events; Telegram delivery option; "Daily Summary" in Event Log | Phase 2 | AI-generated natural language security summaries via local Ollama |
| **4.6 Liveness Detection** | MiniFASNet model in sidecar; `/liveness` endpoint; liveness score per detection; spoofing alerts | 2.2 | Anti-spoofing protection; liveness_fail events |
| **4.7 Sound Event Detection** | `SoundService`; YAMNet in sidecar; `/sound/classify` endpoint; audio stream from cameras; sound events in Event Log; Telegram alerts for critical sounds | Phase 1 | Glass break, gunshot, scream, dog bark, horn detection |
| **4.8 Adaptive Per-Person Thresholds** | Enrollment embedding clustering analysis; per-person threshold calculation; stored in `persons.adaptive_threshold`; used during recognition | 2.2 | More accurate recognition; fewer false matches for low-enrollment persons |

### Phase 5 — Presidential-Level Tracking (FUTURE, 10-20 days)

| Task | Description | Dependencies | Deliverables |
|------|-------------|-------------|-------------|
| **5.1 Cross-Camera Re-ID** | OSNet-AIN in sidecar; `/reid/extract` + `/reid/match` endpoints; `reid_gallery` table; cross-camera matching with global track IDs; face+body identity fusion (0.7/0.3 weights) | 2.1 | Same person tracked across cameras even without face; global_person_id |
| **5.2 Spatial Topology** | `TopologyService`; `topology_edges` table; Topology Editor UI in Settings; anomaly detection (skip, transit violation, disappearance); predictive handoff signals | 3.3 | Property-aware intelligence; anomaly alerts; predictive camera pre-positioning |
| **5.3 Floor Plan Visualization** | `floor_plan` table; Floor Plan Editor UI (upload image, place cameras); real-time person dots with identity labels and trails; click dot → camera feed; animate transitions | 5.1, 5.2 | Real-time property map; visual situational awareness |
| **5.4 Multi-Layer Identity** | Gait recognition (GaitGL) in sidecar; `/gait/analyze` endpoint; `gait_profiles` table; soft biometrics (height, clothing); weighted multi-layer fusion | 5.1 | 4-layer identity: face + body + gait + soft; works when face isn't visible |
| **5.5 Behavioral Anomaly Detection** | Behavioral classifiers in `EventProcessor`: loitering (3.2), running (velocity), pacing (trajectory), tailgating (multi-person), camera tampering (frame analysis), crowd (count), wrong direction (topology), time anomaly (hour) | 2.1, 3.1, 5.2 | 9 behavior types detected; configurable; alerts in Event Log + Telegram |
| **5.6 Situation Room** | New "Situation Room" screen; 4-panel layout: alerts, floor map mini, active camera feed, person status + event timeline; real-time updates; click interactions | 5.1-5.5 | Unified command dashboard for continuous monitoring |
| **5.7 Intelligent PTZ** | `PTZService` abstraction (Tapo + ONVIF); auto-tracking (PID controller); preset patrol (scheduled); zoom-on-demand; coordinated multi-camera handoff (Re-ID + topology → pre-position) | 2.1, 5.1, 5.2 | Active camera control; cameras follow subjects; coordinated handoff |

### Dependency Graph

```
Phase 1 (Foundation)
  1.1 CUDA Fix ──────────────────┐
  1.2 Dual-Stream ───────────────┤
                                 │
Phase 2 (Core AI)                ▼
  2.1 YOLO+ByteTrack ◄──── Phase 1
  2.2 Face Quality ◄────── Phase 1
  2.3 Night CLAHE ◄─────── Phase 1
  2.4 Auto-Enroll ◄─────── 2.2
  2.5 Negative Gallery ◄── 2.1
                                 │
Phase 3 (Intelligence)           ▼
  3.1 Zones ◄──────────── 2.1
  3.2 Loitering ◄─────── 2.1 + 3.1
  3.3 Journey ◄──────── 2.1 + Topology
  3.4 Presence ◄──────── 3.3
  3.5 Tele Burst ◄────── 2.1
  3.6 Group Dedup ◄───── 2.1
                                 │
Phase 4 (Advanced)               ▼
  4.1 Overlay ◄────────── 2.1 + 4.2
  4.2 WebRTC ◄─────────── Phase 1
  4.3 DVR/NVR ◄────────── 4.2
  4.4 Analytics ◄──────── 3.1 + 3.4
  4.5 LLM Reports ◄───── Phase 2
  4.6 Liveness ◄───────── 2.2
  4.7 Sound ◄──────────── Phase 1
  4.8 Adaptive Thresh ◄── 2.2
                                 │
Phase 5 (Presidential)           ▼
  5.1 Re-ID ◄─────────── 2.1
  5.2 Topology ◄───────── 3.3
  5.3 Floor Plan ◄──────── 5.1 + 5.2
  5.4 Multi-Layer ID ◄─── 5.1
  5.5 Behavioral ◄──────── 2.1 + 3.1 + 5.2
  5.6 Situation Room ◄──── 5.1-5.5
  5.7 PTZ Intelligence ◄── 2.1 + 5.1 + 5.2
```

---

## 11. Out of Scope

The following are explicitly **NOT** included in this project (carried forward from v1.0 with additions):

- **Multi-user access or authentication** — single-user local app only
- **Remote/cloud access** — no web server, no port forwarding, no remote viewing
- **Mobile companion app** — desktop only
- **Non-Tapo cameras** — designed for TP-Link Tapo cameras; ONVIF support is for PTZ fallback only, not full third-party camera support
- **Cloud-based face/body recognition** — all inference is local
- **License plate recognition** — not in scope
- **Home automation integration** (Home Assistant, etc.) — not in scope
- **macOS or Linux support** — Windows only
- **Cloud LLM APIs** (OpenAI, Anthropic, etc.) — local Ollama only
- **Multi-property support** — single property/location only
- **Drone/mobile camera support** — fixed IP cameras only
- **Real-time voice commands** — no speech-to-text control interface
- **Facial expression analysis** — detection and identity only, not emotion

---

## 12. Dependencies & Libraries (Updated)

### Electron / TypeScript (Main + Renderer)

| Package | Purpose | Version Note |
|---------|---------|-------------|
| `electron` | Desktop app shell | Latest stable |
| `react` + `react-dom` | UI framework | 19.x |
| `typescript` | Language | 5.x+ |
| `better-sqlite3` | SQLite driver | Latest |
| `node-telegram-bot-api` | Telegram Bot API client | Latest |
| `fluent-ffmpeg` / raw `child_process` | FFmpeg management | Latest / built-in |
| `uuid` | UUID generation | Latest |
| `vite` | Build system | Latest |
| `tailwindcss` | Styling | 3.x+ |
| `lucide-react` | Icons | Latest |
| `@radix-ui/*` or `shadcn/ui` | UI components | Latest |
| `recharts` or `@nivo/*` | Analytics charts | Latest |
| `webrtc-adapter` | WebRTC compatibility | Latest |

### Python (AI Sidecar — Expanded)

| Package | Purpose | Version Note |
|---------|---------|-------------|
| `fastapi` | HTTP API framework | Latest |
| `uvicorn` | ASGI server | Latest |
| `insightface` | Face detection + recognition | Latest |
| `onnxruntime-gpu` | ONNX Runtime with CUDA | **Must match CUDA 12.x** |
| `ultralytics` | YOLOv8s object detection | Latest |
| `numpy` | Numerical operations | Latest |
| `opencv-python-headless` | Image processing, CLAHE | Latest |
| `pillow` | Image decoding | Latest |
| `pydantic` | Request/response validation | 2.x+ |
| `scipy` | Embedding distance calculations | Latest |
| `torchreid` (or `osnet-ain` standalone) | Body Re-ID (OSNet-AIN) | Latest |
| `opengait` (or custom ONNX export) | Gait recognition (GaitGL) | Latest |
| `tensorflow-lite` or `onnxruntime` | YAMNet audio classification | Latest |
| `minifasnet` (or ONNX export) | Liveness/anti-spoofing | Latest |
| `shapely` | Polygon geometry (point-in-polygon for zones) | Latest |

### System Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| **FFmpeg** | RTSP decode for AI sub-stream | Latest |
| **NVIDIA CUDA Toolkit** | GPU acceleration | 12.x (must match onnxruntime-gpu) |
| **cuDNN** | Deep learning primitives | Match CUDA version |
| **Python 3.10+** | AI sidecar runtime | 3.10+ |
| **go2rtc** | Stream proxy, WebRTC, recording | Latest (bundled with app) |
| **Ollama** | Local LLM runtime | Latest |

---

## 13. Glossary (Expanded)

| Term | Definition |
|------|-----------|
| **PTZ** | Pan-Tilt-Zoom — motorized camera movement |
| **RTSP** | Real-Time Streaming Protocol — standard for IP camera video streams |
| **WebRTC** | Web Real-Time Communication — browser-native low-latency streaming protocol |
| **ONVIF** | Open Network Video Interface Forum — IP camera interoperability standard |
| **InsightFace** | Open-source face analysis library (detection, recognition, alignment) |
| **buffalo_l** | InsightFace's largest model bundle (RetinaFace + ArcFace) |
| **ArcFace** | Face recognition model producing 512-dimensional embeddings |
| **RetinaFace** | Face detection model producing bounding boxes and landmarks |
| **YOLOv8s** | You Only Look Once v8 small — real-time object detection model |
| **ByteTrack** | Multi-object tracking algorithm with persistent ID assignment |
| **OSNet-AIN** | Omni-Scale Network — lightweight body Re-Identification model |
| **GaitGL** | Gait recognition model using temporal walking patterns |
| **MiniFASNet** | Lightweight face anti-spoofing (liveness) detection model |
| **YAMNet** | Google's audio event classification model |
| **Ollama** | Local LLM runtime for running large language models on-device |
| **CLAHE** | Contrast Limited Adaptive Histogram Equalization — night vision enhancement |
| **Re-ID** | Person Re-Identification — matching the same person across different cameras |
| **Embedding** | A numerical vector representing biometric identity features |
| **Sidecar** | A separate process running alongside the main application |
| **IPC** | Inter-Process Communication — Electron's Main ↔ Renderer mechanism |
| **go2rtc** | Lightweight RTSP/WebRTC proxy for camera stream management |
| **Tapo API** | Reverse-engineered TP-Link Tapo camera HTTP API |
| **pytapo** | Python library implementing the Tapo camera API |
| **PID Controller** | Proportional-Integral-Derivative control algorithm for PTZ auto-tracking |
| **FSM** | Finite State Machine — used for presence state transitions |
| **Topology** | Graph representing camera spatial relationships and transit times |
| **Tripwire** | Directional virtual line for detecting crossing events |
| **Loitering** | Behavioral pattern where a person stays in a zone beyond a time threshold |
| **Identity Fusion** | Combining multiple biometric scores (face + body + gait) for higher accuracy |
| **Camera Group** | Set of cameras covering the same area, used for alert deduplication |
| **Dead Zone** | Central area of camera frame where PTZ auto-tracking doesn't adjust |

---

## 14. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-03 | Initial PRD — MVP monitoring + face recognition + Telegram alerts |
| 2.0 | 2026-03-03 | Presidential-level upgrade: 5 phases, 30+ features, expanded architecture |

---

> **Next Step:** Run `/plan` to generate the technical task list from this PRD.
