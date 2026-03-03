# Tapo CCTV Desktop

PC desktop application for TP-Link Tapo CCTV monitoring with face recognition and entry/exit intelligence.

## Architecture

### Dual-Stream Architecture (v2.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Tapo Cameras (LAN)                            │
│  CAM-1 (C520WS PTZ)  CAM-2A (C246D Wide)  CAM-2B (C246D Tele PTZ)  │
│  CAM-3 (C520WS PTZ)     [GATE_GROUP: CAM-2A + CAM-2B]              │
│  192.168.100.213        192.168.100.214         192.168.100.215      │
└───────────┬──────────────────────┬──────────────────────────────────┘
            │ main stream (1080p)  │ sub stream (720p)
            ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       go2rtc  (:1984 API, :8554 RTSP, :8555 WebRTC) │
│                                                                      │
│  cam1_main/sub   cam2a_main/sub   cam2b_main/sub   cam3_main/sub    │
│  ─────────────────────────────────────────────────────────────────  │
│  DISPLAY PATH: cam*_main → WebRTC → renderer <video> element        │
│  AI PATH:      cam*_sub  → RTSP re-stream → FFmpeg → AI pipeline    │
└────┬───────────────────────────────────────────────┬────────────────┘
     │ WebRTC (SDP via /api/webrtc)                  │ RTSP sub-stream
     │ hardware H.264 decode, <100ms latency          │ 720p RGB24 @ 12fps
     ▼                                                ▼
┌────────────────────────────────┐   ┌───────────────────────────────┐
│     Electron Renderer          │   │    Electron Main Process       │
│   (React + TypeScript)         │   │    (Node.js / TypeScript)      │
│                                │   │                                │
│  <video> WebRTC display        │   │  StreamManager (FFmpeg)        │
│  DetectionOverlay (SVG)        │   │  MotionDetector / YOLO         │
│  Dashboard  EventLog           │   │  DetectionPipeline             │
│  PersonDir  Settings           │   │  EventProcessor                │
│  ZoneEditor Analytics          │   │  DatabaseService (SQLite)      │
│  FloorPlan  SitRoom            │◄──│  TelegramService               │
│                                │IPC│  ProcessManager                │
└────────────────────────────────┘   └────────────┬───────────────────┘
                                                   │ HTTP (localhost:8520)
                                      ┌────────────┴───────────────────┐
                                      │    Python FastAPI Sidecar      │
                                      │  InsightFace buffalo_l (GPU)   │
                                      │  YOLOv8s + ByteTrack           │
                                      │  OSNet-AIN Re-ID               │
                                      │  MiniFASNet Liveness           │
                                      │  YAMNet Sound Detection        │
                                      │  Ollama LLM (daily reports)    │
                                      │  CUDA 12.x / ORT 1.23.2       │
                                      └────────────────────────────────┘
```

### Four-Layer Architecture

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| **Renderer** | React 19, TypeScript, TailwindCSS | UI screens, video rendering, overlays |
| **Main Process** | Electron, Node.js, better-sqlite3 | IPC, services, FFmpeg, database |
| **AI Sidecar** | Python, FastAPI, InsightFace, YOLOv8s, ByteTrack | Face detection, recognition, enrollment, object detection, tracking, zones, Re-ID, gait, liveness, sound, LLM |
| **Data** | SQLite (v2.0 schema) | cameras, persons, face_embeddings, events, settings, zones, journeys, presence_history, topology_edges, recording_segments, reid_gallery, gait_profiles, ptz_presets, ptz_patrol_schedules, daily_summaries, analytics_rollup, floor_plan, negative_gallery |

## Prerequisites

- **Node.js** >= 20.x
- **Python** >= 3.10
- **FFmpeg** in system PATH
- **NVIDIA GPU** with CUDA (recommended, CPU fallback available)

## Setup

### 1. Install Node.js dependencies

```bash
npm install --legacy-peer-deps
```

### 2. Set up Python virtual environment

```bash
cd python-sidecar
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

> **Note:** For GPU support, ensure CUDA Toolkit is installed and `onnxruntime-gpu` resolves correctly. If no GPU, replace `onnxruntime-gpu` with `onnxruntime` in requirements.txt.

### 3. Verify FFmpeg

```bash
ffmpeg -version
```

## Development

```bash
npm run dev           # Starts Electron main (watch), Vite renderer, Python sidecar concurrently
npm run dev:renderer  # Vite dev server only (port 5173)
npm run start:python  # Python sidecar only (port 8520)
npm run start:electron # Electron main process only
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Concurrent: Electron + Vite + Python |
| `npm run build` | Build main + renderer for production |
| `npm run dist:win` | Build + package as Windows NSIS installer |
| `npm run lint` | ESLint check on `src/` |
| `npm run format` | Prettier format `src/` |

## Folder Structure

```
├── src/
│   ├── main/                # Electron main process
│   │   ├── index.ts         # App entry point
│   │   ├── services/        # StreamManager, DatabaseService, etc.
│   │   ├── ipc/             # IPC handler registrations
│   │   ├── database/        # schema.sql, migrations
│   │   └── utils/           # ffmpegCheck, etc.
│   ├── renderer/            # React UI (Vite)
│   │   ├── App.tsx          # Root component with sidebar nav
│   │   ├── screens/         # Dashboard, EventLog, PersonDirectory, Settings
│   │   ├── components/      # Sidebar, CameraTile, etc.
│   │   ├── hooks/           # Custom React hooks
│   │   ├── stores/          # State management
│   │   ├── types/           # Renderer-specific types
│   │   └── assets/          # Static assets
│   ├── preload/             # Electron preload script (contextBridge)
│   └── shared/              # Shared types (IPC payloads)
├── python-sidecar/          # AI microservice
│   ├── main.py              # FastAPI app
│   ├── config.py            # Runtime configuration
│   ├── routers/             # API route modules
│   ├── services/            # Face detection/recognition logic
│   └── models/              # Pydantic schemas
├── docs/                    # PRD and project documentation
├── tasks/                   # Technical execution plans
├── package.json
├── tsconfig.json            # Base TypeScript config
├── tsconfig.main.json       # Main process TypeScript config
├── vite.config.ts           # Vite config for renderer
├── tailwind.config.ts       # TailwindCSS config
└── eslint.config.js         # ESLint flat config
```

## Camera Setup (v2.0 — 4 Logical Cameras)

| Logical ID | Location | IP | Model | PTZ | Group | Role |
|-----------|----------|-----|-------|-----|-------|------|
| CAM-1 | SALA (Indoor) | 192.168.100.213 | Tapo C520WS | ✅ Pan/Tilt | — | Indoor monitoring |
| CAM-2A | Front Gate (Wide) | 192.168.100.214 | Tapo C246D HW1.0 | ❌ Fixed | GATE_GROUP | Gate area coverage |
| CAM-2B | Front Gate (Tele) | 192.168.100.214 | Tapo C246D HW1.0 | ✅ PTZ | GATE_GROUP | High-res face capture |
| CAM-3 | Garden → Gate | 192.168.100.215 | Tapo C520WS | ✅ Pan/Tilt | — | Garden/path monitoring |

> **Camera Group:** CAM-2A and CAM-2B share the same physical device (C246D dual-lens) and are grouped as `GATE_GROUP` for event deduplication.

### Dual-Stream Architecture (v2.0)

Each camera provides two RTSP streams through go2rtc:
- **Main stream** (1080p) → go2rtc → WebRTC → Renderer `<video>` (display)
- **Sub-stream** (720p) → FFmpeg decode → AI Pipeline (detection/tracking)

This reduces AI processing bandwidth by ~4x compared to v1.0's single 1080p pipeline.

## Key Services (Main Process)

| Service | File | Responsibility |
|---------|------|----------------|
| **StreamManager** | `services/StreamManager.ts` | FFmpeg RTSP streams, frame routing, auto-restart with exponential backoff |
| **DetectionPipeline** | `services/DetectionPipeline.ts` | Motion → face detection → recognition orchestration |
| **EventProcessor** | `services/EventProcessor.ts` | Centroid tracking, line-crossing detection, snapshot capture, event creation |
| **ProcessManager** | `services/ProcessManager.ts` | Python sidecar lifecycle, health checks, auto-restart |
| **TelegramService** | `services/TelegramService.ts` | Alert formatting, throttling, bundling, retry-on-failure |
| **DatabaseService** | `services/DatabaseService.ts` | SQLite CRUD, encryption, auto-purge, settings |
| **AIBridgeService** | `services/AIBridgeService.ts` | HTTP client to Python sidecar (detect, recognize, enroll) |

## System Tray

The app creates a system tray icon with context menu:
- **Show/Hide Window** — toggle main window visibility
- **Camera status summary** — connected camera count
- **AI Service status** — sidecar health
- **Quit** — graceful shutdown

Double-click the tray icon to show and focus the window.

## Build & Packaging

### Development Build

```bash
npm run build          # TypeScript + Vite build
```

### Windows Installer (NSIS)

```bash
npm run dist:win       # Build + package → release/ directory
```

The installer bundles:
- Compiled Electron app (`dist/`)
- Python sidecar source (`python-sidecar/`, excluding venv)
- App icon

### System Requirements for Packaged App

- **FFmpeg** must be installed and in system PATH (not bundled)
- **Python** >= 3.10 must be installed with pip
- After installing, run `pip install -r python-sidecar/requirements.txt` in the app's resources directory

## Security

- Face embeddings encrypted at rest (AES-256-CBC)
- No cloud APIs — all AI inference is local
- RTSP credentials stored in local SQLite only
- Electron sandbox + contextIsolation enabled

## Troubleshooting

### FFmpeg not found
Ensure FFmpeg is installed and available in your system PATH. Run `ffmpeg -version` to verify.

### Python sidecar fails to start
- Check Python version: `python --version` (>= 3.10 required)
- Verify dependencies: `pip install -r python-sidecar/requirements.txt`
- Check port 8520 is not in use: `netstat -an | findstr 8520`

### GPU not detected / CUDA errors
- Requires NVIDIA CUDA Toolkit 12.x (matching onnxruntime-gpu)
- Verify with `nvidia-smi` and `nvcc --version`
- Check health endpoint: `GET http://127.0.0.1:8520/health` reports `gpu_available`, `cuda_version`, `execution_provider`
- If no GPU, set `gpu_enabled` to `false` in Settings → the app falls back to CPU inference

### Camera streams not connecting
- Verify camera IP is reachable: `ping 192.168.100.213`
- Check RTSP URL format: `rtsp://{user}:{pass}@{ip}:554/stream1`
- Ensure cameras are on the same LAN subnet

### High memory usage
- Expected total: ~2-3 GB (Electron ~500MB + Python ~1-2GB + FFmpeg ~200MB per stream)
- If exceeding 4GB, check for stuck FFmpeg processes in Task Manager
- Reduce camera count or lower stream resolution

### Telegram alerts not sending
- Verify bot token and chat ID in Settings → Telegram Config → Send Test
- Check internet connectivity
- Failed alerts auto-retry once after 30 seconds
