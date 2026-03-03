# PRD: Tapo CCTV PC Desktop Application

> **Version:** 1.0
> **Status:** Approved
> **Created:** 2026-03-03
> **Author:** Product Manager (AI-assisted)
> **Next Step:** `/plan` to generate technical task list

---

## 1. Overview

### 1.1 Business Goal

A PC-compatible desktop application that replaces reliance on the TP-Link Tapo mobile app, providing full CCTV monitoring and control from a PC with added face recognition, entry/exit intelligence, and Telegram alerts. Designed for a single home user managing 3 cameras on a local LAN.

### 1.2 Problem Statement

The TP-Link Tapo mobile app is the only official interface for Tapo CCTV cameras. There is no official PC/desktop application. Home users who prefer desktop monitoring, need multi-camera grid views on a large screen, or want advanced features like face recognition and automated entry/exit logging have no solution. This application fills that gap.

### 1.3 Detected Architecture

| Layer | Implementation Target | Technology | Role |
|---|---|---|---|
| **UI Layer** | Electron Renderer Process | TypeScript + React | Multi-camera grid, timeline, event log, person directory, settings |
| **Application Core** | Electron Main Process | TypeScript (Node.js) | Camera control (Tapo API), Telegram bot, event orchestration, IPC bridge |
| **AI Microservice** | Local Python Process (FastAPI) | Python + InsightFace (buffalo_l) + CUDA | Face detection, recognition, enrollment, known/unknown classification |
| **Data Layer** | Embedded SQLite | SQLite via better-sqlite3 | Events, face metadata, settings, entry/exit logs, person profiles |

### 1.4 Key Constraints

- **Single-user local application** — no server, no multi-user, no web access
- **All processing local** — no cloud APIs for face recognition or any other feature
- **Same LAN** — all cameras on 192.168.100.x network
- **Privacy-first** — face embeddings encrypted (AES-256) at rest; no data leaves the machine except user-controlled Telegram alerts
- **High-end hardware target** — Ryzen 9 7900, RTX 4090 (24GB VRAM), 32GB RAM; CPU fallback supported

---

## 2. Camera Hardware

| ID | Location | Type | IP | Model | Capabilities |
|---|---|---|---|---|---|
| CAM-1 | SALA | Indoor / House | 192.168.100.213 | Tapo C212 HW3.0 | Single lens, indoor, fixed |
| CAM-2 | Front House | Gate Outside | 192.168.100.214 | Tapo C246D HW1.0 | Dual lens, PTZ (pan/tilt/zoom), multi-lens |
| CAM-3 | Garden | Garden → Gate | 192.168.100.215 | Tapo C212 HW3.0 | Single lens, faces gate, fixed |

### Camera Communication Protocols

- **RTSP** — Live streaming and playback (all cameras)
- **Tapo-specific API** (pytapo / reverse-engineered) — Device control: motion detection settings, PTZ, siren, spotlight, 2-way audio, firmware updates, device pairing, SD card management
- **ONVIF** — Fallback/supplement where Tapo API is limited

---

## 3. Functional Specifications

### 3.1 User Stories (MVP — Phase 1)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-01 | As a user, I want to see all my cameras in a selectable grid layout so I can monitor my home at a glance. | 1×1, 2×2, 3×1, custom layouts; layout persists across sessions; smooth stream rendering at 1080p/25-30fps |
| US-02 | As a user, I want to click a camera tile to open an enlarged fullscreen view with PTZ controls so I can inspect and control a specific camera. | Enlarged view fills window; PTZ joystick + presets for CAM-2; zoom controls; click-to-exit back to grid |
| US-03 | As a user, I want to enroll known persons by uploading photos, capturing from live stream, or selecting from events so the system can identify them. | Add person (name + label); multiple images per person; enable/disable toggle; delete person + purge data |
| US-04 | As a user, I want to see an event log of all detected entries/exits with person identity, direction, camera, timestamp, and snapshot so I can review who came and went. | Filterable by camera, person, known/unknown, date range; snapshot/clip reference per event; pagination |
| US-05 | As a user, I want to draw a virtual line on a camera view to define entry/exit direction so the system can classify movement automatically. | Line drawing overlay on camera view; direction indicator (arrow); save per camera; clear/redraw |
| US-06 | As a user, I want to configure Telegram bot settings and test the connection so I receive alerts on my phone. | Bot token + chat ID input fields; global enable/disable toggle; "Send Test" button; success/error feedback |
| US-07 | As a user, I want to configure data retention, face encryption, and privacy options so I control how long data is kept. | Retention period selector (30/60/90/180/unlimited); purge all face data button; per-person delete; auto-purge toggle |

### 3.2 Screen Map

| Screen | Purpose | Key Components |
|---|---|---|
| **Dashboard** | Camera grid (selectable layout) | LayoutSelector, CameraGrid with CameraTile[], StatusBar |
| **Camera Fullscreen View** | Enlarged stream + controls | VideoPlayer, PTZControls, LineCrossingOverlay, FaceDetectionOverlay |
| **Event Log** | Filterable entry/exit event table | FilterBar, EventTable, EventDetail |
| **Person Directory** | Known persons management + enrollment | PersonList, PersonDetail, EnrollmentModal |
| **Settings** | All configuration | TelegramConfig, RetentionConfig, CameraManagement, LayoutPreferences, SystemInfo |

### 3.3 UI Component Hierarchy

```
App Shell (sidebar nav + content area)
├── Dashboard
│   ├── LayoutSelector (1×1 | 2×2 | 3×1 | custom)
│   ├── CameraGrid
│   │   └── CameraTile[] (stream + status + optional mini PTZ for CAM-2)
│   └── StatusBar (connection status per camera, AI service status)
├── CameraFullscreenView
│   ├── VideoPlayer (1080p RTSP stream)
│   ├── PTZControls (joystick + presets, CAM-2 only)
│   ├── LineCrossingOverlay (draw/edit virtual line)
│   └── FaceDetectionOverlay (bounding boxes + labels)
├── EventLog
│   ├── FilterBar (camera, person, known/unknown, date range)
│   ├── EventTable (identity, direction, camera, timestamp, snapshot)
│   └── EventDetail (expanded view with clip/snapshot)
├── PersonDirectory
│   ├── PersonList (name, thumbnail, status, image count)
│   ├── PersonDetail (images gallery, enable/disable, delete)
│   └── EnrollmentModal (upload file | capture from stream | select from event)
└── Settings
    ├── TelegramConfig (token, chat ID, test, global toggle)
    ├── RetentionConfig (period selector, auto-purge toggle, purge all button)
    ├── CameraManagement (IP, model, location label per camera)
    ├── LayoutPreferences (default layout, mini PTZ toggle)
    └── SystemInfo (GPU detection, AI service status, performance stats)
```

### 3.4 UI Interaction Details

- **Grid Layout**: Selectable between 1×1 (fullscreen single cam), 2×2, 3×1 horizontal strip, and custom/free layout. Selection persists across sessions.
- **Camera Tile Click**: Opens enlarged/fullscreen view. PTZ controls appear in enlarged view only (not cluttering grid). Optional small PTZ joystick overlay on grid tile for CAM-2, toggled via Settings.
- **Face Detection Overlay**: Bounding boxes drawn on the video stream in real-time. Known persons labeled with name + green box. Unknown persons labeled "Unknown" + red box. Confidence score displayed.
- **Virtual Line Drawing**: User draws a line on the camera view using click-and-drag. An arrow indicates the "ENTER" direction. Saved per camera. Can be cleared and redrawn.
- **Enrollment Modal**: Three tabs — (1) Upload from disk (drag-and-drop or file picker), (2) Capture from live stream ("Capture Face" button freezes frame), (3) Select from event list (pick an event, crop face region). Multiple images per person supported.

---

## 4. Technical Specifications

### 4.1 Application Core — Electron Main Process Services

| Service | Role | Key Operations |
|---|---|---|
| **StreamManager** | Manages FFmpeg child processes for RTSP decode | Start/stop streams per camera; decode to raw frames; route frames to renderer (display) + AI service (detection) |
| **TapoAPIService** | Interfaces with Tapo cameras via reverse-engineered API | PTZ control, motion detection settings, siren/spotlight, SD card info, device pairing, firmware check |
| **MotionDetector** | Lightweight frame-diff motion detection | Compares consecutive frames; triggers face recognition pipeline only on motion; configurable sensitivity per camera |
| **AIBridgeService** | HTTP client to Python FastAPI sidecar | Send frames for face detection/recognition; receive results (bounding boxes, identity, confidence); manage enrollment requests |
| **EventProcessor** | Processes AI results into structured events | Determines entry/exit direction (line-crossing or heuristic); creates event records; triggers notifications |
| **TelegramService** | Sends alerts via node-telegram-bot-api | Formats messages (camera, person, direction, timestamp, snapshot); applies throttling/cooldown rules; handles test notifications |
| **DatabaseService** | SQLite access layer via better-sqlite3 | CRUD for events, persons, face metadata, settings, camera configs; retention auto-purge; encrypted face data read/write |
| **CryptoService** | AES-256 encryption for face embeddings | Encrypt embeddings before SQLite write; decrypt on read; key management (derived from user-set passphrase or machine-bound key) |
| **ProcessManager** | Manages Python sidecar lifecycle | Launch/restart FastAPI process; health checks; graceful shutdown; GPU detection and configuration passthrough |

### 4.2 IPC Contract (Main ↔ Renderer)

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `stream:frame` | Main → Renderer | `{ cameraId: string, frameBuffer: Buffer, timestamp: number }` | Live video frames for display |
| `stream:start` | Renderer → Main | `{ cameraId: string }` | Start camera stream |
| `stream:stop` | Renderer → Main | `{ cameraId: string }` | Stop camera stream |
| `ptz:command` | Renderer → Main | `{ cameraId: string, action: string, params: object }` | PTZ move/preset command |
| `ai:detection` | Main → Renderer | `{ cameraId: string, faces: Face[], timestamp: number }` | Face detection overlay data |
| `event:new` | Main → Renderer | `{ eventId: string, type: string, person: string, direction: string, cameraId: string, timestamp: number, snapshotPath: string }` | Real-time event notification |
| `person:enroll` | Renderer → Main | `{ personName: string, label?: string, imageData: string[], source: 'upload' \| 'capture' \| 'event' }` | Face enrollment request |
| `person:list` | Renderer → Main | `{}` → `Person[]` | List known persons |
| `person:delete` | Renderer → Main | `{ personId: string }` | Delete person + all face data |
| `person:toggle` | Renderer → Main | `{ personId: string, enabled: boolean }` | Enable/disable person |
| `event:list` | Renderer → Main | `{ filters: EventFilters }` → `Event[]` | Query events with filters |
| `settings:get` | Renderer → Main | `{ key: string }` → `{ value: string }` | Read setting |
| `settings:set` | Renderer → Main | `{ key: string, value: string }` | Write setting |
| `telegram:test` | Renderer → Main | `{ token: string, chatId: string }` | Send test Telegram notification |
| `line:save` | Renderer → Main | `{ cameraId: string, lineCoords: { x1, y1, x2, y2 }, direction: 'enter_from_left' \| 'enter_from_right' }` | Save virtual line-crossing config |
| `line:get` | Renderer → Main | `{ cameraId: string }` → `LineCrossingConfig \| null` | Get virtual line config for camera |
| `system:status` | Main → Renderer | `{ cameras: CameraStatus[], aiService: ServiceStatus, gpu: GpuInfo }` | System health/status update |

### 4.3 AI Microservice — Python FastAPI Sidecar

#### API Contract

| Endpoint | Method | Request Body | Response Body | Purpose |
|---|---|---|---|---|
| `/health` | GET | — | `{ status: str, gpu_available: bool, gpu_name: str, model_loaded: bool, model_name: str }` | Health check + GPU detection |
| `/detect` | POST | `{ camera_id: str, frame_base64: str, timestamp: float }` | `{ faces: [{ bbox: [x1,y1,x2,y2], confidence: float, embedding: float[512] }] }` | Detect faces in a single frame |
| `/recognize` | POST | `{ embedding: float[512], threshold: float }` | `{ matched: bool, person_id: str?, person_name: str?, confidence: float }` | Match embedding against enrolled persons |
| `/enroll` | POST | `{ person_id: str, person_name: str, images_base64: str[] }` | `{ success: bool, embeddings_count: int, errors: str[] }` | Generate + store embeddings for a person |
| `/person/{id}` | DELETE | — | `{ success: bool }` | Remove person + all embeddings |
| `/persons` | GET | — | `{ persons: [{ id: str, name: str, embeddings_count: int, enabled: bool }] }` | List all enrolled persons |
| `/person/{id}` | PUT | `{ enabled: bool?, name: str? }` | `{ success: bool }` | Update person status or name |
| `/config` | POST | `{ gpu_enabled: bool?, model_name: str?, det_threshold: float?, rec_threshold: float? }` | `{ success: bool, active_config: object }` | Update AI configuration at runtime |

#### Model & Inference Specification

- **Model**: InsightFace `buffalo_l` (highest accuracy, best suited for RTX 4090)
- **Detection**: RetinaFace (bundled with buffalo_l) — real-time at 1080p on RTX 4090
- **Recognition**: ArcFace (bundled with buffalo_l) — 512-dimensional embeddings
- **Runtime**: ONNX Runtime with CUDA Execution Provider (GPU), fallback to CPU Execution Provider
- **GPU**: Auto-detect NVIDIA CUDA devices; prefer RTX 4090; log GPU name and VRAM on startup
- **Concurrency**: Process frames from 3 simultaneous camera streams; batch when multiple cameras trigger motion simultaneously
- **Default Thresholds**: Detection confidence ≥ 0.5; Recognition confidence ≥ 0.6 (configurable via `/config`)
- **Frame Input**: Base64-encoded JPEG or PNG; decoded server-side; resized internally by InsightFace

### 4.4 Face Recognition Pipeline (End-to-End Flow)

```
Camera (RTSP 1080p)
    │
    ▼
StreamManager (FFmpeg child process — decode RTSP to raw frames)
    │
    ├──► Renderer (IPC: stream:frame — for display)
    │
    ▼
MotionDetector (frame-diff on consecutive frames)
    │
    │ [motion detected?]
    │   NO → skip (save CPU)
    │   YES ▼
    │
AIBridgeService (HTTP POST /detect — send frame to Python sidecar)
    │
    ▼
Python FastAPI Sidecar
    ├── RetinaFace detection (GPU) → bounding boxes
    └── ArcFace recognition (GPU) → 512-dim embeddings
    │
    ▼
AIBridgeService (receives detection results)
    │
    ├──► Renderer (IPC: ai:detection — bounding boxes + labels for overlay)
    │
    ▼
EventProcessor
    ├── For each detected face:
    │   ├── POST /recognize → match against enrolled persons
    │   ├── Classify: Known (name + confidence) or Unknown
    │   ├── Determine direction: line-crossing analysis OR camera heuristic fallback
    │   ├── Save snapshot to disk
    │   └── Insert event record into SQLite
    │
    ├──► Renderer (IPC: event:new — real-time event notification)
    │
    └──► TelegramService (if rules match — send alert)
```

### 4.5 Entry/Exit Detection Logic

#### Primary Method: Virtual Line-Crossing

1. User draws a virtual line on the camera view (stored as `{ x1, y1, x2, y2 }` in `cameras.line_crossing_config`)
2. User sets the "ENTER" direction (which side of the line is "entering")
3. When a person is detected, track their bounding box centroid across consecutive frames
4. If the centroid crosses the virtual line, determine direction:
   - Centroid moved from the "outside" to the "inside" of the line → **ENTER**
   - Centroid moved from the "inside" to the "outside" of the line → **EXIT**

#### Fallback Method: Camera Heuristic

If no virtual line is configured for a camera, use the camera's `heuristic_direction` field:

| Camera | Default Heuristic | Rationale |
|---|---|---|
| CAM-1 (SALA) | `INSIDE` (no direction) | Indoor room — detection means person is inside the house |
| CAM-2 (Front House / Gate) | `ENTER` | Gate camera — detection typically means someone arriving |
| CAM-3 (Garden) | `ENTER` | Garden-to-gate — detection means someone approaching |

The heuristic is a simple default. Once the user draws a virtual line, it overrides the heuristic for that camera.

---

## 5. Data Specifications

### 5.1 SQLite Schema

```sql
-- Camera configuration
CREATE TABLE cameras (
    id TEXT PRIMARY KEY,              -- 'CAM-1', 'CAM-2', 'CAM-3'
    label TEXT NOT NULL,              -- 'SALA', 'Front House', 'Garden'
    ip_address TEXT NOT NULL,
    model TEXT,                       -- 'Tapo C212 HW3.0', 'Tapo C246D HW1.0'
    type TEXT,                        -- 'indoor', 'outdoor'
    rtsp_url TEXT,                    -- 'rtsp://192.168.100.213:554/stream1'
    has_ptz BOOLEAN DEFAULT 0,
    line_crossing_config TEXT,        -- JSON: {"x1":0,"y1":0,"x2":0,"y2":0,"enter_direction":"left"}
    heuristic_direction TEXT,         -- 'ENTER', 'EXIT', 'INSIDE', or NULL
    motion_sensitivity INTEGER DEFAULT 50,  -- 0-100
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Known persons
CREATE TABLE persons (
    id TEXT PRIMARY KEY,              -- UUID v4
    name TEXT NOT NULL,
    label TEXT,                       -- optional tag/notes (e.g., 'family', 'neighbor')
    enabled BOOLEAN DEFAULT 1,
    telegram_notify TEXT DEFAULT 'silent_log',  -- 'immediate', 'silent_log', 'daily_summary' (Phase 2)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Face embeddings (encrypted at rest)
CREATE TABLE face_embeddings (
    id TEXT PRIMARY KEY,              -- UUID v4
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    embedding_encrypted BLOB NOT NULL, -- AES-256 encrypted 512-dim float32 vector (2048 bytes raw → encrypted blob)
    iv BLOB NOT NULL,                 -- AES initialization vector (16 bytes)
    source_type TEXT NOT NULL,        -- 'upload', 'capture', 'event_clip'
    source_reference TEXT,            -- file path or event ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Detection / entry-exit events
CREATE TABLE events (
    id TEXT PRIMARY KEY,              -- UUID v4
    camera_id TEXT NOT NULL REFERENCES cameras(id),
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    person_name TEXT,                 -- denormalized for fast display; 'Unknown' if unmatched
    is_known BOOLEAN NOT NULL DEFAULT 0,
    direction TEXT,                   -- 'ENTER', 'EXIT', 'INSIDE', or NULL
    detection_method TEXT,            -- 'line_crossing' or 'heuristic'
    confidence REAL,                  -- face recognition confidence (0.0 - 1.0)
    bbox TEXT,                        -- JSON: {"x1":0,"y1":0,"x2":0,"y2":0}
    snapshot_path TEXT,               -- local file path to snapshot image
    clip_path TEXT,                   -- local file path to short clip (optional, Phase 2)
    telegram_sent BOOLEAN DEFAULT 0,
    telegram_sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Application settings (key-value store)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for query performance
CREATE INDEX idx_events_camera_id ON events(camera_id);
CREATE INDEX idx_events_person_id ON events(person_id);
CREATE INDEX idx_events_is_known ON events(is_known);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_direction ON events(direction);
CREATE INDEX idx_face_embeddings_person_id ON face_embeddings(person_id);
```

### 5.2 Default Settings

| Key | Default Value | Description |
|---|---|---|
| `telegram_bot_token` | `""` | Telegram Bot API token |
| `telegram_chat_id` | `""` | Telegram chat/group/user ID for alerts |
| `telegram_enabled` | `"false"` | Global Telegram notification toggle |
| `retention_days` | `"90"` | Event log retention period in days |
| `auto_purge_enabled` | `"true"` | Auto-delete events older than retention period |
| `default_layout` | `"2x2"` | Default camera grid layout |
| `mini_ptz_enabled` | `"false"` | Show mini PTZ joystick on CAM-2 grid tile |
| `recognition_threshold` | `"0.6"` | Face recognition confidence threshold |
| `detection_threshold` | `"0.5"` | Face detection confidence threshold |
| `gpu_enabled` | `"true"` | Use GPU for AI inference (auto-detected) |
| `motion_sensitivity_default` | `"50"` | Default motion detection sensitivity (0-100) |

### 5.3 Snapshot Storage

- **Location**: `{app_data}/snapshots/{YYYY-MM-DD}/{camera_id}/`
- **Naming**: `{timestamp_ms}_{person_name_or_unknown}.jpg`
- **Format**: JPEG, quality 85%, cropped to detection region + padding
- **Retention**: Follows `retention_days` setting; auto-purged with events

---

## 6. Telegram Notification Specification

### 6.1 Message Format

```
🚨 [ALERT] Person Detected

📷 Camera: CAM-2 (Front House)
👤 Person: Unknown
📍 Direction: ENTER
🕐 Time: 2026-03-03 04:15:32
📊 Confidence: 0.45
```
*Attached: snapshot image*

For known persons:
```
ℹ️ [INFO] Known Person Detected

📷 Camera: CAM-1 (SALA)
👤 Person: Juan Dela Cruz
📍 Direction: INSIDE
🕐 Time: 2026-03-03 04:16:10
📊 Confidence: 0.87
```

### 6.2 Alert Rules (MVP)

| Condition | Action | Priority |
|---|---|---|
| Unknown person detected | Immediate Telegram alert with snapshot | HIGH |
| Known person detected | Silent log (configurable per person in Phase 2) | LOW |
| Telegram test requested | Send test message immediately | — |

### 6.3 Throttling Rules (MVP)

- **Cooldown per camera**: No duplicate alerts for the same camera within 30 seconds
- **Cooldown per person**: No duplicate alerts for the same unknown person within 60 seconds
- **Bundle window**: If multiple detections occur within 5 seconds on the same camera, bundle into a single alert with count

### 6.4 Post-MVP Telegram Enhancements (Phase 2)

- Per-person notification rules: `immediate`, `silent_log`, `daily_summary`
- Daily summary digest at configurable time
- "Do Not Disturb" hours (except for Unknown persons or user-specified critical persons)
- Night vs day threshold differentiation
- Short video clip attachment (in addition to snapshot)

---

## 7. Security & Privacy

### 7.1 Face Data Encryption

- **Algorithm**: AES-256-CBC
- **Scope**: All face embeddings encrypted before writing to SQLite (`face_embeddings.embedding_encrypted`)
- **IV**: Unique 16-byte initialization vector per embedding, stored alongside in `face_embeddings.iv`
- **Key Management**: Encryption key derived from a machine-bound identifier (e.g., machine UUID + app salt) using PBKDF2. No user passphrase required for MVP (transparent encryption). Phase 2 may add optional user passphrase.
- **Decryption**: Happens in-memory only when recognition is needed. Decrypted embeddings are never written to disk.

### 7.2 RTSP Stream Security

- RTSP credentials stored encrypted in SQLite settings (same AES-256 key)
- Streams accessible only on local LAN (no port forwarding, no external exposure)

### 7.3 Data Retention & Purge

- **Auto-purge**: Background job runs daily; deletes events + snapshots older than `retention_days`
- **Purge All Face Data**: Deletes all rows from `persons` + `face_embeddings` + associated snapshots; requires confirmation dialog
- **Per-Person Delete**: Cascade delete — removes person, all embeddings, and all event references (events retain `person_name` as denormalized text but `person_id` set to NULL)

### 7.4 Electron Security

- Renderer process sandboxed (`sandbox: true`)
- Context isolation enabled (`contextIsolation: true`)
- Node integration disabled in renderer (`nodeIntegration: false`)
- All privileged operations (camera, DB, file system, network, AI) via Main process IPC only
- Preload script exposes only typed IPC channels

---

## 8. Performance Requirements

### 8.1 Target Hardware

| Component | Specification |
|---|---|
| CPU | AMD Ryzen 9 7900 (12-core, 24-thread) |
| GPU | NVIDIA RTX 4090 (24GB VRAM) |
| RAM | 32GB DDR5 |
| OS | Windows |

### 8.2 Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Simultaneous streams | 3 × 1080p @ 25-30fps | FFmpeg decode, no throttling |
| Face detection latency | < 50ms per frame | RetinaFace on RTX 4090 |
| Face recognition latency | < 20ms per embedding | ArcFace on RTX 4090 |
| Motion-to-alert pipeline | < 2 seconds end-to-end | Motion detect → face detect → recognize → event → Telegram |
| UI frame rate | 60fps | Renderer rendering, smooth grid transitions |
| App startup | < 5 seconds | Including Python sidecar launch + model load |
| SQLite query (event list) | < 100ms | With indexes, up to 100K events |
| Memory usage | < 4GB total | Electron + Python + FFmpeg processes combined |
| GPU VRAM usage | < 4GB | InsightFace buffalo_l model + inference buffers |

### 8.3 CPU Fallback Mode

When no CUDA GPU is available:
- InsightFace uses ONNX Runtime CPU Execution Provider
- Reduce to 1 stream at a time for face detection (round-robin across cameras)
- Accept higher latency (~200-500ms per frame detection)
- Motion detection threshold auto-increased to reduce unnecessary AI calls

---

## 9. Architecture — Communication Flows

### 9.1 Allowed Flows

```
Renderer ──IPC──► Main Process          (all UI commands)
Main Process ──IPC──► Renderer          (frames, events, AI results, status)
Main Process ──HTTP──► Python Sidecar   (AI requests on localhost:8520)
Main Process ──RTSP──► Cameras          (via FFmpeg child processes on LAN)
Main Process ──Tapo API──► Cameras      (device control, HTTP/HTTPS on LAN)
Main Process ──HTTPS──► Telegram API    (send notifications, outbound only)
Main Process ──SQLite──► Local DB       (all data persistence)
Python Sidecar ──SQLite──► Local DB     (face embeddings read for recognition)
```

### 9.2 Prohibited Flows

```
Renderer ──X──► Cameras                 (no direct camera access from renderer)
Renderer ──X──► SQLite                  (no direct DB access from renderer)
Renderer ──X──► Python Sidecar          (no direct AI calls from renderer)
Renderer ──X──► Telegram API            (no direct external API calls from renderer)
Python Sidecar ──X──► Internet          (no cloud calls, strictly local)
Any Component ──X──► Cloud Face APIs    (no cloud, local inference only)
```

### 9.3 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON APP                                   │
│                                                                         │
│  ┌──────────────────────┐         ┌──────────────────────────────────┐  │
│  │   RENDERER (React)   │◄──IPC──►│         MAIN PROCESS             │  │
│  │                      │         │                                  │  │
│  │  • Dashboard/Grid    │         │  • StreamManager (FFmpeg)        │  │
│  │  • Fullscreen View   │         │  • TapoAPIService               │  │
│  │  • Event Log         │         │  • MotionDetector               │  │
│  │  • Person Directory  │         │  • AIBridgeService ──HTTP──►┐   │  │
│  │  • Settings          │         │  • EventProcessor            │   │  │
│  │  • Detection Overlay │         │  • TelegramService           │   │  │
│  │  • Line Drawing      │         │  • DatabaseService           │   │  │
│  │                      │         │  • CryptoService             │   │  │
│  └──────────────────────┘         │  • ProcessManager            │   │  │
│                                   └──────────┬───────────────────┘   │  │
│                                              │                       │  │
└──────────────────────────────────────────────┼───────────────────────┘  │
                                               │                          │
                              ┌─────────────── │ ────────────────────┐    │
                              │                ▼                     │    │
                              │  ┌──────────────────────────────┐   │    │
                              │  │  PYTHON SIDECAR (FastAPI)    │◄──┘    │
                              │  │                              │         │
                              │  │  • InsightFace buffalo_l     │         │
                              │  │  • RetinaFace (detection)    │         │
                              │  │  • ArcFace (recognition)     │         │
                              │  │  • CUDA / CPU runtime        │         │
                              │  └──────────────┬───────────────┘         │
                              │                 │                          │
                              │                 ▼                          │
                              │  ┌──────────────────────────────┐         │
                              │  │      SQLite Database         │◄────────┘
                              │  │                              │
                              │  │  • cameras                   │
                              │  │  • persons                   │
                              │  │  • face_embeddings (AES-256) │
                              │  │  • events                    │
                              │  │  • settings                  │
                              │  └──────────────────────────────┘
                              │                                    
                              │          LOCAL MACHINE             
                              └────────────────────────────────────

                    ┌──────────────────────┐
                    │   LAN CAMERAS        │
                    │                      │
                    │  CAM-1: 192.168.100.213 (SALA)
                    │  CAM-2: 192.168.100.214 (Front House, PTZ)
                    │  CAM-3: 192.168.100.215 (Garden)
                    │                      │
                    │  Protocols:           │
                    │  • RTSP (streaming)   │
                    │  • Tapo API (control) │
                    │  • ONVIF (fallback)   │
                    └──────────────────────┘

                    ┌──────────────────────┐
                    │   TELEGRAM API        │
                    │  (outbound HTTPS)     │
                    │  • Alert messages     │
                    │  • Snapshot images    │
                    └──────────────────────┘
```

---

## 10. Implementation Phases

### Phase 1 — MVP

**Goal**: Core monitoring, face recognition, entry/exit logging, basic Telegram alerts.

| Milestone | Deliverables | Dependencies |
|---|---|---|
| **M1: Project Scaffold** | Electron + React + TypeScript project setup; Python FastAPI sidecar scaffold; SQLite schema; build system (Vite/Webpack) | None |
| **M2: Video Streaming** | FFmpeg RTSP decode; frame routing to renderer; CameraTile component; selectable grid layouts (1×1, 2×2, 3×1, custom); 1080p rendering | M1 |
| **M3: Camera Control** | TapoAPIService integration; PTZ controls for CAM-2 (joystick + presets); fullscreen camera view; camera management settings | M2 |
| **M4: AI Sidecar** | Python FastAPI server; InsightFace buffalo_l model loading; GPU auto-detection (CUDA); `/health`, `/detect`, `/recognize`, `/enroll` endpoints; ProcessManager for lifecycle | M1 |
| **M5: Face Recognition Pipeline** | MotionDetector (frame-diff); AIBridgeService (HTTP to sidecar); face detection overlay on video; known/unknown classification; confidence display | M2, M4 |
| **M6: Face Enrollment** | Person Directory UI; EnrollmentModal (upload, capture, select); multiple images per person; `/enroll` endpoint; encrypted embedding storage (AES-256); person CRUD | M4, M5 |
| **M7: Entry/Exit Logging** | Virtual line-crossing drawing UI; direction detection algorithm; camera heuristic fallback; EventProcessor; Event Log UI with filters; snapshot storage | M5, M6 |
| **M8: Telegram Notifications** | TelegramService; bot token/chat ID settings UI; test notification; unknown person alerts; throttling/cooldown rules | M7 |
| **M9: Settings & Privacy** | Retention config UI; auto-purge job; purge all face data; per-person delete; SystemInfo (GPU, AI status); layout preferences | M6, M8 |
| **M10: Integration & Polish** | End-to-end testing; performance optimization; error handling; status bar; connection monitoring; app icon/branding | All above |

### Phase 2 — Advanced Features (Post-MVP)

| Feature | Description |
|---|---|
| **SD Card Playback** | Access Tapo camera SD card recordings; timeline scrubbing UI; playback controls |
| **Full Telegram Rules** | Per-person notification rules (immediate/silent/daily summary); DND schedules; night/day thresholds; short clip attachment |
| **Advanced AI Analytics** | Pet/vehicle detection; line-crossing visualization on playback; auto-tracking for PTZ cameras |
| **2-Way Audio** | Microphone input from PC → camera speaker; camera mic → PC speaker; push-to-talk UI |
| **Siren & Spotlight** | Trigger siren/spotlight from UI per camera; schedule-based auto-activation |
| **Firmware Management** | Check for firmware updates; display current version; initiate update from UI |
| **Cloud/Local Storage UI** | SD card storage stats; format SD card; manage recorded clips |
| **Enhanced Privacy** | Optional user passphrase for face data encryption; export/import face database; audit log |

---

## 11. Out of Scope

The following are explicitly **NOT** included in this project:

- **Multi-user access or authentication** — single-user local app only
- **Remote/cloud access** — no web server, no port forwarding, no remote viewing
- **Mobile companion app** — desktop only
- **Non-Tapo cameras** — designed specifically for TP-Link Tapo cameras (C212, C246D); other brands not supported
- **Cloud-based face recognition** — all inference is local, no external API calls
- **License plate recognition** — not in scope (may be considered for future phases)
- **Integration with home automation systems** (Home Assistant, etc.) — not in scope
- **macOS or Linux support** — Windows only (target machine)

---

## 12. Dependencies & Libraries

### Electron / TypeScript (Main + Renderer)

| Package | Purpose | Version Note |
|---|---|---|
| `electron` | Desktop app shell | Latest stable |
| `react` + `react-dom` | UI framework | 18.x+ |
| `typescript` | Language | 5.x+ |
| `better-sqlite3` | SQLite driver (synchronous, fast) | Latest |
| `node-telegram-bot-api` | Telegram Bot API client | Latest |
| `fluent-ffmpeg` / raw `child_process` | FFmpeg management | Latest / built-in |
| `uuid` | UUID generation for IDs | Latest |
| `electron-store` or custom | Settings persistence (backup to SQLite) | Latest |
| `vite` or `webpack` | Build system | Latest |
| `tailwindcss` | Styling | 3.x+ |
| `lucide-react` | Icons | Latest |
| `@radix-ui/*` or `shadcn/ui` | UI components | Latest |

### Python (AI Sidecar)

| Package | Purpose | Version Note |
|---|---|---|
| `fastapi` | HTTP API framework | Latest |
| `uvicorn` | ASGI server | Latest |
| `insightface` | Face detection + recognition | Latest |
| `onnxruntime-gpu` | ONNX Runtime with CUDA | Match CUDA version |
| `numpy` | Numerical operations | Latest |
| `opencv-python-headless` | Image processing | Latest |
| `pillow` | Image decoding | Latest |
| `pydantic` | Request/response validation | 2.x+ |

### System Dependencies

| Dependency | Purpose |
|---|---|
| **FFmpeg** | RTSP decode, video processing (bundled with app or system-installed) |
| **NVIDIA CUDA Toolkit** | GPU acceleration for InsightFace (must match onnxruntime-gpu) |
| **Python 3.10+** | AI sidecar runtime (bundled or system-installed) |

---

## 13. Glossary

| Term | Definition |
|---|---|
| **PTZ** | Pan-Tilt-Zoom — motorized camera movement |
| **RTSP** | Real-Time Streaming Protocol — standard for IP camera video streams |
| **ONVIF** | Open Network Video Interface Forum — interoperability standard for IP cameras |
| **InsightFace** | Open-source face analysis library (detection, recognition, alignment) |
| **buffalo_l** | InsightFace's largest pre-trained model bundle (RetinaFace + ArcFace) |
| **ArcFace** | Face recognition model producing 512-dimensional embedding vectors |
| **RetinaFace** | Face detection model producing bounding boxes and landmarks |
| **Embedding** | A numerical vector (512 floats) representing a face's identity features |
| **Sidecar** | A separate process that runs alongside the main application |
| **IPC** | Inter-Process Communication — Electron's mechanism for Main ↔ Renderer communication |
| **Tapo API** | Reverse-engineered TP-Link Tapo camera HTTP API for device control |
| **pytapo** | Python library implementing the Tapo camera API |
| **Pumasok** | Filipino for "entered" — used in entry/exit logging context |
| **Lumabas** | Filipino for "exited" — used in entry/exit logging context |
