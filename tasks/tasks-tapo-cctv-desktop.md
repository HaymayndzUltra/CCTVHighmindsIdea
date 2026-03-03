# Technical Execution Plan: Tapo CCTV PC Desktop Application

Based on PRD: `docs/prd-tapo-cctv-desktop.md`

> **Note on AI Model Strategy:** Recommended personas for each phase:
> * **Architect (Claude Opus 4.5):** Complex system design, multi-file reasoning, IPC contracts, security — best for Tasks 1.0, 4.0, 5.0, 7.0, 10.0
> * **Coder (GPT-5.2):** Top benchmark scores, fast iteration, algorithmic code — best for Tasks 2.0, 3.0, 6.0, 8.0
> * **Optimizer (DeepSeek V3.2):** Cost-efficient boilerplate, CRUD, config, tests — best for Task 9.0 and sub-tasks across all

## Primary Files Affected

### Electron Main Process (`src/main/`)
* `src/main/index.ts` — App entry point
* `src/main/services/StreamManager.ts`
* `src/main/services/TapoAPIService.ts`
* `src/main/services/MotionDetector.ts`
* `src/main/services/AIBridgeService.ts`
* `src/main/services/EventProcessor.ts`
* `src/main/services/TelegramService.ts`
* `src/main/services/DatabaseService.ts`
* `src/main/services/CryptoService.ts`
* `src/main/services/ProcessManager.ts`
* `src/main/ipc/` — IPC handler registrations
* `src/main/database/schema.sql`
* `src/main/database/migrations/`

### Electron Renderer (`src/renderer/`)
* `src/renderer/App.tsx` — Root component
* `src/renderer/screens/Dashboard/`
* `src/renderer/screens/CameraFullscreenView/`
* `src/renderer/screens/EventLog/`
* `src/renderer/screens/PersonDirectory/`
* `src/renderer/screens/Settings/`
* `src/renderer/components/` — Shared components
* `src/renderer/hooks/` — Custom React hooks
* `src/renderer/stores/` — State management
* `src/renderer/types/` — TypeScript interfaces

### Python AI Sidecar (`python-sidecar/`)
* `python-sidecar/main.py` — FastAPI entry point
* `python-sidecar/routers/` — API route modules
* `python-sidecar/services/face_detection.py`
* `python-sidecar/services/face_recognition.py`
* `python-sidecar/services/enrollment.py`
* `python-sidecar/models/` — Pydantic schemas
* `python-sidecar/config.py` — Runtime configuration
* `python-sidecar/requirements.txt`

### Preload & Shared
* `src/preload/index.ts` — Preload script (typed IPC channels)
* `src/shared/types.ts` — Shared TypeScript types (IPC payloads)

---

## Dependency Graph

```
1.0 (Scaffold)
 ├── 2.0 (Streaming + Grid)        ──parallel──  4.0 (AI Sidecar)
 │    ├── 3.0 (Fullscreen + PTZ)
 │    └─────────────┐
 │                   ▼
 │              5.0 (Motion + Face Pipeline)  ← 4.0
 │                   │
 │                   ├── 6.0 (Enrollment + Person Directory)
 │                   │    │
 │                   │    ├── 7.0 (Entry/Exit + Events)
 │                   │    │    │
 │                   │    │    └── 8.0 (Telegram)
 │                   │    │         │
 │                   │    └─────────┤
 │                   │              ▼
 │                   │         9.0 (Settings + Privacy)
 │                   │
 │                   └── 7.0
 │
 └── 4.0 (AI Sidecar)

10.0 (Integration + Polish) ← ALL
```

> **Note on Parallel Execution:** Tasks with `[DEPENDS ON: ...]` must wait for prerequisites. Independent tasks can run in parallel. Key parallel opportunities: 2.0 ∥ 4.0 after 1.0; 3.0 ∥ 5.0 after 2.0.

---

## Detailed Execution Plan

---

### 1.0 — Project Scaffold & Build System `[COMPLEXITY: Complex]`

> **WHY:** Foundation for the entire application. Without a correct Electron + React + Python + SQLite scaffold, every subsequent task is blocked.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[5-documentation-context-integrity]`
> `[DEPENDS ON: None]`

- [x] 1.0 Set up the complete project scaffold and build system.
  - [x] 1.1 **Electron + React + TypeScript project initialization:**
      - [x] 1.1.1 Initialize npm project with `package.json` (name: `tapo-cctv-desktop`, private, type: module). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.1.2 Install Electron, React 18, React DOM, TypeScript 5.x, Vite, `@vitejs/plugin-react`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.1.3 Install dev dependencies: `electron-builder`, `concurrently`, `cross-env`, `eslint`, `prettier`, `@types/react`, `@types/node`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.1.4 Create `tsconfig.json` (strict mode, paths for `@main/`, `@renderer/`, `@shared/`). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.1.5 Create `vite.config.ts` for renderer (React plugin, dev server, alias paths). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.1.6 Create Electron main process entry: `src/main/index.ts` (BrowserWindow creation, preload path, dev/prod URL switching). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 1.2 **Directory structure creation:**
      - [x] 1.2.1 Create `src/main/` directory with subdirs: `services/`, `ipc/`, `database/`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.2.2 Create `src/renderer/` directory with subdirs: `screens/`, `components/`, `hooks/`, `stores/`, `types/`, `assets/`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.2.3 Create `src/preload/index.ts` with contextBridge skeleton (sandbox: true, contextIsolation: true, nodeIntegration: false). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.2.4 Create `src/shared/types.ts` with initial IPC payload type definitions. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.2.5 Create `python-sidecar/` directory with `main.py`, `requirements.txt`, `config.py`, subdirs: `routers/`, `services/`, `models/`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 1.3 **SQLite schema and database setup:**
      - [x] 1.3.1 Create `src/main/database/schema.sql` with all 5 tables (cameras, persons, face_embeddings, events, settings) + indexes as defined in PRD Section 5.1. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.3.2 Install `better-sqlite3` and `@types/better-sqlite3`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.3.3 Create `src/main/services/DatabaseService.ts` skeleton with: `initDatabase()` (run schema.sql), `getDb()` accessor, connection management. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.3.4 Seed default settings (PRD Section 5.2: telegram_bot_token, retention_days, default_layout, etc.). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.3.5 Seed default camera records for CAM-1, CAM-2, CAM-3 with IPs, models, and heuristic_direction. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 1.4 **Python sidecar initialization:**
      - [x] 1.4.1 Create `python-sidecar/requirements.txt` with: fastapi, uvicorn, insightface, onnxruntime-gpu, numpy, opencv-python-headless, pillow, pydantic. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.4.2 Create `python-sidecar/main.py` with FastAPI app initialization, CORS middleware (localhost only), and placeholder router includes. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.4.3 Create `python-sidecar/config.py` with runtime config class: gpu_enabled, model_name, det_threshold, rec_threshold, port. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.4.4 Create `python-sidecar/models/schemas.py` with Pydantic request/response models for all endpoints (per PRD Section 4.3). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 1.5 **Dev tooling and scripts:**
      - [x] 1.5.1 Create `.eslintrc.json` (TypeScript rules, React hooks rules). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.5.2 Create `.prettierrc` (semi, singleQuote, trailingComma). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.5.3 Add npm scripts: `dev` (concurrent Electron + Vite + Python), `build`, `lint`, `format`, `start:python`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 1.5.4 Configure FFmpeg binary strategy: document expected FFmpeg location, add PATH check in main process startup. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 1.6 **Renderer app shell:**
      - [x] 1.6.1 Create `src/renderer/App.tsx` with sidebar navigation + content area layout (Dashboard, EventLog, PersonDirectory, Settings nav items). [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 1.6.2 Install and configure TailwindCSS 3.x with `tailwind.config.ts`. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 1.6.3 Install `lucide-react` for icons, `@radix-ui/react-*` or shadcn/ui for base components. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 1.6.4 Create `src/renderer/components/Sidebar.tsx` with nav links and active state. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 1.6.5 Create placeholder screens: `Dashboard.tsx`, `EventLog.tsx`, `PersonDirectory.tsx`, `Settings.tsx` (empty shells with titles). [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 1.7 **Documentation:**
      - [x] 1.7.1 Create project `README.md` with: project overview, architecture diagram (from PRD), setup instructions (npm install, python venv, FFmpeg), dev scripts, folder structure explanation. [APPLIES RULES: `5-documentation-context-integrity`]
      - [x] 1.7.2 Create `python-sidecar/README.md` with: setup instructions, GPU requirements, model download notes, API endpoint list. [APPLIES RULES: `5-documentation-context-integrity`]

---

### 2.0 — Video Streaming & Camera Grid UI `[COMPLEXITY: Complex]`

> **WHY:** Core value proposition — users need to see their cameras. Validates the RTSP + FFmpeg + Electron rendering pipeline end-to-end.
> **Recommended Model:** `Coder (GPT-5.2)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[common-rule-ui-foundation-design-system]`, `[common-rule-ui-interaction-a11y-perf]`
> `[DEPENDS ON: 1.0]`

- [x] 2.0 Implement video streaming and multi-camera grid UI.
  - [x] 2.1 **StreamManager service:**
      - [x] 2.1.1 Create `src/main/services/StreamManager.ts` with class structure: `startStream(cameraId)`, `stopStream(cameraId)`, `stopAll()`, private FFmpeg process map. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.1.2 Implement FFmpeg child process spawning: RTSP URL → raw frame output (e.g., `-f rawvideo -pix_fmt rgb24` or MJPEG pipe). Include error handling for FFmpeg crashes with informative logging. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.1.3 Implement frame buffer parsing: read FFmpeg stdout pipe, chunk into complete frames by resolution (1920×1080). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.1.4 Implement frame routing: send decoded frames to renderer via IPC (`stream:frame` channel) with `{ cameraId, frameBuffer, timestamp }`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.1.5 Implement stream lifecycle: graceful stop (SIGTERM to FFmpeg), crash detection + auto-restart with backoff, per-camera status tracking. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.1.6 Add RTSP URL construction: `rtsp://{username}:{password}@{ip}:554/stream1` with credentials from camera config. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 2.2 **IPC registration for streaming:**
      - [x] 2.2.1 Create `src/main/ipc/streamHandlers.ts` with handlers for `stream:start`, `stream:stop` channels. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.2.2 Update `src/preload/index.ts` to expose `stream:start`, `stream:stop` invoke methods and `stream:frame` listener via contextBridge. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.2.3 Add TypeScript types for stream IPC payloads in `src/shared/types.ts`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 2.3 **CameraTile component:**
      - [x] 2.3.1 Create `src/renderer/components/CameraTile/CameraTile.tsx` — receives frame buffer via IPC listener, renders to `<canvas>` element using `requestAnimationFrame`. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `3-code-quality-checklist`]
      - [x] 2.3.2 Implement canvas rendering: decode frame buffer → ImageData → draw to canvas. Handle resolution and aspect ratio. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 2.3.3 Add camera label overlay (camera ID + location name) and connection status indicator (green/red dot). [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 2.3.4 Add click handler: tile click emits `onSelect(cameraId)` for fullscreen view navigation. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 2.3.5 Add loading state (skeleton placeholder while stream initializes) and error state (camera offline message). [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
  - [x] 2.4 **CameraGrid and LayoutSelector:**
      - [x] 2.4.1 Create `src/renderer/components/CameraGrid/CameraGrid.tsx` — renders CameraTile[] in a CSS Grid layout that adapts to selected layout mode. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 2.4.2 Create `src/renderer/components/LayoutSelector/LayoutSelector.tsx` — toolbar with layout options: 1×1, 2×2, 3×1, custom. Visual icons per mode. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 2.4.3 Implement layout CSS: grid-template-columns/rows for each mode. 1×1 = single cam fills area; 2×2 = 2-col grid; 3×1 = 3-col single row; custom = draggable/resizable (stretch goal). [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 2.4.4 Persist selected layout to SQLite settings (`default_layout`) via IPC `settings:set`. Restore on app launch. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 2.5 **StatusBar component:**
      - [x] 2.5.1 Create `src/renderer/components/StatusBar/StatusBar.tsx` — bottom bar showing per-camera connection status (green/yellow/red) and AI service status. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 2.6 **Dashboard screen assembly:**
      - [x] 2.6.1 Update `src/renderer/screens/Dashboard/Dashboard.tsx` — compose LayoutSelector + CameraGrid + StatusBar. On mount, trigger `stream:start` for all enabled cameras. On unmount, stop streams. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `3-code-quality-checklist`]
      - [x] 2.6.2 Create `src/renderer/hooks/useStreamFrame.ts` — custom hook that listens to `stream:frame` IPC events for a given cameraId and provides latest frame buffer to CameraTile. [APPLIES RULES: `3-code-quality-checklist`]

---

### 3.0 — Camera Fullscreen View & PTZ Control `[COMPLEXITY: Complex]`

> **WHY:** Users need to inspect individual cameras closely and control CAM-2's PTZ for gate monitoring — critical for security.
> **Recommended Model:** `Coder (GPT-5.2)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[common-rule-ui-foundation-design-system]`, `[common-rule-ui-interaction-a11y-perf]`
> `[DEPENDS ON: 2.0]`

- [x] 3.0 Implement camera fullscreen view and PTZ control.
  - [x] 3.1 **TapoAPIService:**
      - [x] 3.1.1 Create `src/main/services/TapoAPIService.ts` with class structure. Research and implement Tapo camera HTTP API authentication (handshake, token exchange). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.1.2 Implement PTZ commands: `move(direction, speed)`, `stop()`, `setPreset(name)`, `goToPreset(name)`, `getPresets()`. Wrap all API calls in try/catch with informative error logging. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.1.3 Implement camera info queries: `getDeviceInfo()`, `getMotionDetectionConfig()`, `getSDCardInfo()`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.1.4 Add connection management: per-camera session tokens, auto-reconnect on auth expiry, connection status tracking. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 3.2 **IPC registration for PTZ:**
      - [x] 3.2.1 Create `src/main/ipc/ptzHandlers.ts` with handler for `ptz:command` channel. Validate cameraId has PTZ capability (has_ptz flag). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.2.2 Update `src/preload/index.ts` to expose `ptz:command` invoke method. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.2.3 Add PTZ IPC payload types to `src/shared/types.ts`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 3.3 **CameraFullscreenView screen:**
      - [x] 3.3.1 Create `src/renderer/screens/CameraFullscreenView/CameraFullscreenView.tsx` — full-window video display using enlarged CameraTile/canvas. Accept cameraId as route parameter. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 3.3.2 Add close/back button to return to Dashboard grid. Keyboard shortcut: Escape to exit fullscreen. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 3.3.3 Add camera info header: camera name, location, model, connection status. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 3.4 **PTZControls component:**
      - [x] 3.4.1 Create `src/renderer/components/PTZControls/PTZControls.tsx` — virtual joystick (up/down/left/right/center buttons or drag pad), zoom in/out buttons. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 3.4.2 Implement PTZ command invocation: on joystick interaction, call `ptz:command` IPC with direction + speed. On release, send stop command. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.4.3 Implement preset management: list presets, go-to-preset buttons, save-current-position-as-preset. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 3.4.4 Conditionally render: only show PTZ controls if camera `has_ptz === true` (CAM-2 only). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 3.5 **Mini PTZ overlay on grid tile:**
      - [x] 3.5.1 Create `src/renderer/components/MiniPTZ/MiniPTZ.tsx` — compact 4-direction pad overlay on CameraTile for CAM-2. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 3.5.2 Conditionally render based on `mini_ptz_enabled` setting + camera `has_ptz` flag. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 3.6 **Camera management in Settings:**
      - [x] 3.6.1 Create `src/renderer/screens/Settings/CameraManagement.tsx` — list cameras with editable fields: IP address, label, model, RTSP URL, enabled toggle. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 3.6.2 Implement save: IPC `settings:set` for camera config changes, persist to `cameras` table. [APPLIES RULES: `3-code-quality-checklist`]

---

### 4.0 — Python AI Sidecar & InsightFace Setup `[COMPLEXITY: Complex]`

> **WHY:** Enables the entire face recognition pipeline. GPU auto-detection and model loading must work reliably before any AI feature can be built.
> **Recommended Model:** `Cascade`
> **Rules to apply:** `[3-code-quality-checklist]`, `[5-documentation-context-integrity]`
> `[DEPENDS ON: 1.0]`

- [x] 4.0 Implement the Python AI sidecar with InsightFace.
  - [x] 4.1 **FastAPI server core:**
      - [x] 4.1.1 Implement `python-sidecar/main.py`: FastAPI app with lifespan handler for model loading on startup. CORS middleware allowing localhost only. Include all routers. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.1.2 Implement GPU auto-detection in `python-sidecar/config.py`: check for CUDA availability via `onnxruntime.get_available_providers()`, log GPU name via `torch.cuda.get_device_name()` or nvidia-smi parsing. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.1.3 Implement InsightFace model loading: load `buffalo_l` with CUDA Execution Provider if available, fallback to CPU. Store as app-level state. Log model name, provider, and load time. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.2 **Health endpoint:**
      - [x] 4.2.1 Create `python-sidecar/routers/health.py` with `GET /health` → returns `{ status, gpu_available, gpu_name, model_loaded, model_name }`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.3 **Detection endpoint:**
      - [x] 4.3.1 Create `python-sidecar/services/face_detection.py` with `detect_faces(frame: np.ndarray)` → list of `{ bbox, confidence, embedding }`. Uses InsightFace `app.get()` method. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.3.2 Create `python-sidecar/routers/detection.py` with `POST /detect` — accepts `{ camera_id, frame_base64, timestamp }`, decodes base64 to numpy array, calls detection service, returns results. Input validation on base64 format. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.4 **Recognition endpoint:**
      - [x] 4.4.1 Create `python-sidecar/services/face_recognition.py` with `recognize_face(embedding, threshold)` → `{ matched, person_id, person_name, confidence }`. Compares against all enrolled embeddings using cosine similarity. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.4.2 Implement embedding database access: read encrypted embeddings from SQLite, decrypt in-memory (receive decryption key from config or query), compute similarities. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.4.3 Create `python-sidecar/routers/recognition.py` with `POST /recognize` endpoint. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.5 **Config endpoint:**
      - [x] 4.5.1 Create `python-sidecar/routers/config.py` with `POST /config` — accepts `{ gpu_enabled, model_name, det_threshold, rec_threshold }`, updates runtime config, returns active config. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.6 **ProcessManager in Electron Main:**
      - [x] 4.6.1 Create `src/main/services/ProcessManager.ts` — launches Python sidecar as child process (`python -m uvicorn main:app --port 8520`). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.6.2 Implement health check polling: `GET /health` every 5 seconds. Track sidecar status (starting/healthy/unhealthy/stopped). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.6.3 Implement auto-restart: if health check fails 3 consecutive times, kill and restart Python process with backoff (5s, 10s, 30s). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.6.4 Implement graceful shutdown: on Electron app quit, send SIGTERM to Python process, await exit with timeout. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.6.5 Pass GPU config to sidecar: detect NVIDIA GPU from Electron (via `child_process` nvidia-smi), pass as environment variable or startup config. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.7 **AIBridgeService in Electron Main:**
      - [x] 4.7.1 Create `src/main/services/AIBridgeService.ts` — HTTP client wrapping fetch/axios calls to `http://localhost:8520`. Methods: `detectFaces(cameraId, frameBuffer)`, `recognizeFace(embedding, threshold)`, `checkHealth()`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.7.2 Implement frame encoding: convert raw frame buffer to base64 JPEG for API transmission. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 4.7.3 Add error handling: timeout (5s per request), retry logic (1 retry), sidecar-unavailable fallback (queue frames or skip). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 4.8 **Documentation:**
      - [x] 4.8.1 Update `python-sidecar/README.md` with: complete API reference, GPU setup instructions (CUDA toolkit version), model download procedure, testing instructions. [APPLIES RULES: `5-documentation-context-integrity`]

---

### 5.0 — Motion Detection & Face Recognition Pipeline `[COMPLEXITY: Complex]`

> **WHY:** Connects cameras to AI — motion-triggered face detection avoids wasting GPU on empty frames and delivers real-time known/unknown classification.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[4-code-modification-safety-protocol]`, `[common-rule-ui-foundation-design-system]`
> `[DEPENDS ON: 2.0, 4.0]`

- [x] 5.0 Implement motion detection and face recognition pipeline.
  - [x] 5.1 **MotionDetector service:**
      - [x] 5.1.1 Create `src/main/services/MotionDetector.ts` with frame-diff algorithm: compare consecutive frames per camera, compute pixel difference percentage. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.1.2 Implement configurable sensitivity per camera: read `motion_sensitivity` from camera config (0-100 scale, where 0 = never trigger, 100 = always trigger). Map to pixel-diff threshold. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.1.3 Implement motion cooldown: after motion detected, enforce minimum interval (e.g., 500ms) before next detection to avoid flooding the AI service. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.1.4 Emit `motionDetected(cameraId, frame)` event when threshold exceeded. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 5.2 **Pipeline integration:**
      - [x] 5.2.1 Wire StreamManager → MotionDetector: route every Nth frame (e.g., every 3rd frame = ~10fps analysis rate) from each camera to MotionDetector. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.2.2 Wire MotionDetector → AIBridgeService: on `motionDetected`, call `AIBridgeService.detectFaces(cameraId, frame)`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.2.3 Handle concurrent detection across 3 cameras: use Promise.all or queue with concurrency limit matching GPU capacity. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.2.4 Handle AI results: for each detected face, forward to EventProcessor (Task 7.0) for identity resolution and event creation. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 5.3 **Face detection overlay:**
      - [x] 5.3.1 Create `src/renderer/components/FaceDetectionOverlay/FaceDetectionOverlay.tsx` — transparent canvas overlay on CameraTile, draws bounding boxes and labels from `ai:detection` IPC data. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 5.3.2 Implement color coding: green box + name for known persons, red box + "Unknown" for unknown persons. Display confidence score below label. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 5.3.3 Coordinate bounding box positions with video frame: scale bbox coordinates from detection resolution to canvas display resolution. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 5.4 **IPC for AI detection results:**
      - [x] 5.4.1 Create `src/main/ipc/aiHandlers.ts` — emits `ai:detection` events from Main to Renderer with `{ cameraId, faces: [{ bbox, label, confidence, isKnown }], timestamp }`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.4.2 Update `src/preload/index.ts` to expose `ai:detection` listener via contextBridge. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.4.3 Create `src/renderer/hooks/useDetectionOverlay.ts` — custom hook that listens to `ai:detection` events for a given cameraId. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 5.5 **Performance validation:**
      - [x] 5.5.1 Measure end-to-end latency: motion trigger → face detection → result received in renderer. Target: < 2 seconds. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 5.5.2 Validate concurrent 3-camera operation: all 3 streams + motion detection + face detection running simultaneously without frame drops. [APPLIES RULES: `3-code-quality-checklist`]

---

### 6.0 — Face Enrollment & Person Directory `[COMPLEXITY: Complex]`

> **WHY:** Users must register known persons so the system can distinguish family from strangers — the foundation for smart alerting.
> **Recommended Model:** `Coder (GPT-5.2)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[common-rule-ui-foundation-design-system]`, `[common-rule-ui-interaction-a11y-perf]`
> `[DEPENDS ON: 4.0, 5.0]`

- [x] 6.0 Implement face enrollment and person directory.
  - [x] 6.1 **Enrollment endpoint in Python sidecar:**
      - [x] 6.1.1 Create `python-sidecar/services/enrollment.py` with `enroll_person(person_id, images)`: for each image, detect face → extract embedding → return list of embeddings. Validate exactly 1 face per image (reject multi-face or no-face images with error). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.1.2 Create `python-sidecar/routers/enrollment.py` with `POST /enroll` endpoint per PRD spec. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.1.3 Create `python-sidecar/routers/persons.py` with `GET /persons`, `PUT /person/{id}`, `DELETE /person/{id}` endpoints per PRD spec. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 6.2 **CryptoService:**
      - [x] 6.2.1 Create `src/main/services/CryptoService.ts` — implements AES-256-CBC encryption/decryption. Methods: `encrypt(data: Buffer): { encrypted: Buffer, iv: Buffer }`, `decrypt(encrypted: Buffer, iv: Buffer): Buffer`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.2.2 Implement key derivation: use PBKDF2 with machine-bound identifier (os.hostname + machine UUID from `node-machine-id`) + app salt. Derive 256-bit key. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.2.3 Store key hash in settings (`encryption_key_hash`) for validation on startup (detect if machine changed). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 6.3 **DatabaseService extensions for persons/embeddings:**
      - [x] 6.3.1 Add methods to `DatabaseService.ts`: `createPerson(name, label)`, `getPersons()`, `getPerson(id)`, `updatePerson(id, data)`, `deletePerson(id)` (cascade: delete embeddings too). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.3.2 Add methods: `storeEmbedding(personId, embeddingBuffer, iv, sourceType, sourceRef)`, `getEmbeddingsByPerson(personId)`, `getAllEmbeddings()` (for recognition matching), `deleteEmbeddingsByPerson(personId)`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.3.3 Integrate CryptoService: encrypt embeddings before `storeEmbedding`, decrypt after `getAllEmbeddings`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 6.4 **IPC for person management:**
      - [x] 6.4.1 Create `src/main/ipc/personHandlers.ts` with handlers for: `person:enroll`, `person:list`, `person:delete`, `person:toggle`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.4.2 `person:enroll` handler: receive images, call AIBridgeService → `POST /enroll`, receive embeddings, encrypt and store via DatabaseService. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.4.3 Update `src/preload/index.ts` with all person IPC channel methods. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 6.4.4 Add person IPC payload types to `src/shared/types.ts`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 6.5 **PersonDirectory screen:**
      - [x] 6.5.1 Create `src/renderer/screens/PersonDirectory/PersonDirectory.tsx` — layout with PersonList sidebar + PersonDetail main area. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 6.5.2 Create `src/renderer/components/PersonList/PersonList.tsx` — scrollable list showing: thumbnail (first enrolled image), name, image count, enabled/disabled badge. "Add Person" button at top. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.5.3 Create `src/renderer/components/PersonDetail/PersonDetail.tsx` — selected person view: name (editable), label (editable), enrolled images gallery, enable/disable toggle, delete button (with confirmation dialog). [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.5.4 Implement delete confirmation: destructive action requires modal confirmation "Delete {name} and all face data? This cannot be undone." [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
  - [x] 6.6 **EnrollmentModal:**
      - [x] 6.6.1 Create `src/renderer/components/EnrollmentModal/EnrollmentModal.tsx` — modal dialog with 3 tabs. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.6.2 Tab 1 — Upload from disk: file picker (accept: jpg, png) + drag-and-drop zone. Preview selected images. Multiple file selection. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.6.3 Tab 2 — Capture from stream: live camera stream preview + "Capture Face" button that freezes current frame. Camera selector dropdown. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.6.4 Tab 3 — Select from event: list recent detection events with snapshots. Click to select a face crop. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.6.5 Common: person name input (required), label input (optional), image preview list with remove button per image, "Enroll" submit button with loading state. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 6.6.6 Handle enrollment result: success → close modal + refresh PersonList; error → inline error message per image (e.g., "No face detected in image 3"). [APPLIES RULES: `3-code-quality-checklist`]

---

### 7.0 — Entry/Exit Logging & Event System `[COMPLEXITY: Complex]`

> **WHY:** Transforms raw face detections into meaningful "who entered/exited when" intelligence — the core differentiator over the Tapo app.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[4-code-modification-safety-protocol]`, `[common-rule-ui-foundation-design-system]`, `[common-rule-ui-interaction-a11y-perf]`
> `[DEPENDS ON: 5.0, 6.0]`

- [x] 7.0 Implement entry/exit logging and event system.
  - [x] 7.1 **LineCrossingOverlay component:**
      - [x] 7.1.1 Create `src/renderer/components/LineCrossingOverlay/LineCrossingOverlay.tsx` — transparent SVG/canvas overlay on camera view. Supports click-and-drag to draw a line. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.1.2 Implement line drawing interaction: mousedown → drag → mouseup creates line segment. Show line with direction arrow indicating "ENTER" side. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.1.3 Add direction toggle: click arrow to flip ENTER direction (enter_from_left ↔ enter_from_right). [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.1.4 Add clear/redraw button. Save line config via IPC `line:save`. Load existing config via IPC `line:get` on mount. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.2 **IPC for line-crossing config:**
      - [x] 7.2.1 Create `src/main/ipc/lineHandlers.ts` with handlers for `line:save` (persist to `cameras.line_crossing_config` JSON field) and `line:get` (read from cameras table). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.2.2 Update preload and shared types. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.3 **Entry/exit detection algorithm:**
      - [x] 7.3.1 Implement centroid tracking in `src/main/services/EventProcessor.ts`: track bounding box centroids across consecutive detection frames per camera. Maintain a short-term position history (last 5 positions) per tracked face. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.3.2 Implement line-crossing logic: given line segment and centroid trajectory, determine if centroid crossed the line and from which side. Use vector cross-product for side determination. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.3.3 Implement camera heuristic fallback: if no line_crossing_config for camera, use `heuristic_direction` field. CAM-1 → INSIDE, CAM-2 → ENTER, CAM-3 → ENTER. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.3.4 Tag each detection with `detection_method`: `'line_crossing'` or `'heuristic'`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.4 **EventProcessor service:**
      - [x] 7.4.1 Create `src/main/services/EventProcessor.ts` (or extend if skeleton exists from pipeline integration): receives face detection results + identity from recognition → creates full event record. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.4.2 For each detected face: call AIBridgeService.recognizeFace() → get identity → determine direction → save snapshot → insert event into SQLite → emit `event:new` IPC → trigger TelegramService if rules match. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.4.3 Implement snapshot capture: crop detected face region from frame (with padding), save as JPEG to `{app_data}/snapshots/{date}/{camera_id}/{timestamp}_{name}.jpg`. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.5 **DatabaseService extensions for events:**
      - [x] 7.5.1 Add methods to `DatabaseService.ts`: `createEvent(eventData)`, `getEvents(filters)`, `getEvent(id)`, `deleteEventsOlderThan(days)`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.5.2 Implement filter query builder for `getEvents()`: filter by camera_id, person_id, is_known, direction, date range (created_at between). Support pagination (limit + offset). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.6 **IPC for events:**
      - [x] 7.6.1 Create `src/main/ipc/eventHandlers.ts` with handlers for `event:list` (query with filters) and `event:new` emitter (Main → Renderer push). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 7.6.2 Update preload and shared types. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 7.7 **EventLog screen:**
      - [x] 7.7.1 Create `src/renderer/screens/EventLog/EventLog.tsx` — layout with FilterBar + EventTable + EventDetail. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 7.7.2 Create `src/renderer/components/FilterBar/FilterBar.tsx` — filter controls: camera dropdown (All/CAM-1/CAM-2/CAM-3), person dropdown, known/unknown toggle, date range picker. Apply filters via `event:list` IPC. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.7.3 Create `src/renderer/components/EventTable/EventTable.tsx` — sortable table with columns: Timestamp, Camera, Person, Direction, Confidence, Snapshot thumbnail. Click row to expand detail. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.7.4 Create `src/renderer/components/EventDetail/EventDetail.tsx` — expanded view: full-size snapshot, all event metadata, link to person profile (if known). [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 7.7.5 Implement real-time event updates: listen to `event:new` IPC, prepend new events to table with highlight animation. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 7.7.6 Implement pagination: load 50 events per page, "Load More" button or infinite scroll. [APPLIES RULES: `3-code-quality-checklist`]

---

### 8.0 — Telegram Notifications `[COMPLEXITY: Simple]`

> **WHY:** Delivers immediate mobile alerts for unknown persons at the gate — the primary security notification channel.
> **Recommended Model:** `Coder (GPT-5.2)`
> **Rules to apply:** `[3-code-quality-checklist]`
> `[DEPENDS ON: 7.0]`

- [x] 8.0 Implement Telegram notifications.
  - [x] 8.1 **TelegramService:**
      - [x] 8.1.1 Create `src/main/services/TelegramService.ts` — initialize `node-telegram-bot-api` instance with bot token from settings. Methods: `sendAlert(event)`, `sendTestMessage(token, chatId)`, `isConfigured()`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.1.2 Implement message formatting per PRD Section 6.1: emoji-prefixed structured message with Camera, Person, Direction, Time, Confidence fields. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.1.3 Implement snapshot attachment: read snapshot file from disk, send as photo with caption. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.1.4 Implement alert priority: Unknown person → 🚨 `[ALERT]` prefix, high priority; Known person → ℹ️ `[INFO]` prefix, normal priority (MVP: known = silent log only). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 8.2 **Throttling/cooldown logic:**
      - [x] 8.2.1 Implement per-camera cooldown: track last alert timestamp per camera. Skip if within 30 seconds. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.2.2 Implement per-person cooldown: track last alert timestamp per person (unknown counts as one "person"). Skip if within 60 seconds. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.2.3 Implement bundle window: if multiple detections on same camera within 5 seconds, combine into single alert with count (e.g., "3 persons detected"). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 8.3 **Integration with EventProcessor:**
      - [x] 8.3.1 Wire EventProcessor → TelegramService: after creating event record, if `telegram_enabled` and person is unknown (MVP rule), call `TelegramService.sendAlert(event)`. Update `telegram_sent` and `telegram_sent_at` in event record. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 8.4 **Telegram Settings UI:**
      - [x] 8.4.1 Create `src/renderer/screens/Settings/TelegramConfig.tsx` — form with: Bot Token input (password-masked), Chat ID input, Global enable/disable toggle, "Send Test Notification" button. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 8.4.2 Implement test button: call `telegram:test` IPC, show success toast or error message. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.4.3 Implement save: persist token + chatId + enabled to settings table via `settings:set` IPC. Reinitialize TelegramService on save. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 8.5 **IPC for Telegram:**
      - [x] 8.5.1 Create `src/main/ipc/telegramHandlers.ts` with handler for `telegram:test`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 8.5.2 Update preload and shared types. [APPLIES RULES: `3-code-quality-checklist`]

---

### 9.0 — Settings & Privacy Controls `[COMPLEXITY: Simple]`

> **WHY:** Users need control over data retention, privacy, and app configuration to trust the system with sensitive face data.
> **Recommended Model:** `Optimizer (DeepSeek V3.2)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[common-rule-ui-foundation-design-system]`, `[common-rule-ui-interaction-a11y-perf]`
> `[DEPENDS ON: 6.0, 8.0]`

- [x] 9.0 Implement settings and privacy controls.
  - [x] 9.1 **Settings screen assembly:**
      - [x] 9.1.1 Update `src/renderer/screens/Settings/Settings.tsx` — tabbed or sectioned layout assembling: TelegramConfig (from 8.4), RetentionConfig, CameraManagement (from 3.6), LayoutPreferences, SystemInfo. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 9.2 **RetentionConfig:**
      - [x] 9.2.1 Create `src/renderer/screens/Settings/RetentionConfig.tsx` — retention period dropdown (30/60/90/180/unlimited days), auto-purge toggle, "Purge All Face Data" button (destructive, red), "Purge Events Now" button. [APPLIES RULES: `common-rule-ui-foundation-design-system`, `common-rule-ui-interaction-a11y-perf`]
      - [x] 9.2.2 Implement "Purge All Face Data" confirmation: two-step confirmation dialog — "This will permanently delete ALL enrolled persons and their face data. Type 'DELETE' to confirm." [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 9.2.3 Implement purge IPC: add `privacy:purge-all-faces` and `privacy:purge-old-events` IPC channels. Handler deletes all persons + embeddings or events older than retention period. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 9.3 **Auto-purge background job:**
      - [x] 9.3.1 Implement in `src/main/services/DatabaseService.ts`: `runAutoPurge()` method — if `auto_purge_enabled`, delete events + snapshot files where `created_at < NOW - retention_days`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 9.3.2 Schedule auto-purge: run on app startup and every 24 hours via `setInterval`. Log purge results (count of deleted events + freed disk space). [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 9.4 **LayoutPreferences:**
      - [x] 9.4.1 Create `src/renderer/screens/Settings/LayoutPreferences.tsx` — default layout selector (1×1, 2×2, 3×1, custom), mini PTZ toggle for CAM-2. Save via `settings:set` IPC. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 9.5 **SystemInfo panel:**
      - [x] 9.5.1 Create `src/renderer/screens/Settings/SystemInfo.tsx` — read-only display: GPU detected (name + VRAM), AI service status (healthy/unhealthy), model loaded (buffalo_l), CUDA version, Python sidecar PID, cameras connected count, total events count, database file size. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
      - [x] 9.5.2 Implement `system:status` IPC channel: Main process gathers system info from ProcessManager, DatabaseService, StreamManager → sends to renderer on request. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 9.6 **Settings IPC consolidation:**
      - [x] 9.6.1 Create `src/main/ipc/settingsHandlers.ts` with handlers for `settings:get`, `settings:set`, `privacy:purge-all-faces`, `privacy:purge-old-events`, `system:status`. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 9.6.2 Update preload and shared types for all settings channels. [APPLIES RULES: `3-code-quality-checklist`]

---

### 10.0 — Integration, Polish & End-to-End Testing `[COMPLEXITY: Complex]`

> **WHY:** Ensures all components work together reliably. Error handling and monitoring make the difference between a demo and a usable app.
> **Recommended Model:** `Architect (Claude Opus 4.5)`
> **Rules to apply:** `[3-code-quality-checklist]`, `[4-code-modification-safety-protocol]`, `[5-documentation-context-integrity]`
> `[DEPENDS ON: 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]`

- [x] 10.0 Integration testing, error handling, and production polish.
  - [x] 10.1 **End-to-end pipeline validation:**
      - [x] 10.1.1 Test full pipeline: camera RTSP connect → FFmpeg decode → frame display in grid → motion detect → face detect (GPU) → recognize → event created → Telegram sent. Verify < 2 second end-to-end latency. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.1.2 Test all 3 cameras simultaneously: verify no frame drops, no memory leaks, GPU VRAM within budget (< 4GB). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.1.3 Test face enrollment → recognition cycle: enroll a person with 3+ images → verify recognition on live stream with correct name and confidence > 0.6. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.1.4 Test entry/exit detection: configure virtual line on CAM-2 → walk through gate → verify correct ENTER/EXIT direction in event log. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.1.5 Test Telegram delivery: trigger unknown person detection → verify Telegram message received with correct format, snapshot attached. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 10.2 **Error handling and resilience:**
      - [x] 10.2.1 FFmpeg crash recovery: detect FFmpeg process exit, auto-restart with exponential backoff (1s, 2s, 4s, max 30s). Update camera status in StatusBar. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.2.2 Camera disconnect handling: detect RTSP connection failure, show "Disconnected" state on CameraTile, attempt reconnect every 10 seconds. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.2.3 Python sidecar crash recovery: ProcessManager auto-restarts (already in 4.6.3). Verify AI overlay shows "AI Offline" status during restart. Queue or skip frames during downtime. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.2.4 Telegram failure handling: if Telegram send fails, log error, mark `telegram_sent = false` on event, retry once after 30 seconds. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.2.5 SQLite error handling: wrap all DB operations in try/catch, log errors, prevent app crash on DB issues. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 10.3 **Status monitoring:**
      - [x] 10.3.1 Implement `system:status` periodic push: Main process emits status every 10 seconds with camera statuses, AI service health, memory usage. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.3.2 Update StatusBar to reflect real-time status: green = connected, yellow = reconnecting, red = offline for each camera and AI service. [APPLIES RULES: `common-rule-ui-foundation-design-system`]
  - [x] 10.4 **Performance optimization:**
      - [x] 10.4.1 Profile memory usage: ensure total < 4GB (Electron + Python + FFmpeg). Identify and fix any memory leaks (frame buffers not being freed, etc.). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.4.2 Optimize frame transfer: evaluate SharedArrayBuffer or efficient IPC serialization for frame data to minimize copy overhead. [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.4.3 Optimize SQLite queries: verify all filtered event queries use indexes, test with 10K+ events for < 100ms response. [APPLIES RULES: `3-code-quality-checklist`]
  - [x] 10.5 **App branding and packaging:**
      - [x] 10.5.1 Add app icon (window icon + taskbar icon). Set window title to "Tapo CCTV Desktop". [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.5.2 Add system tray icon with context menu: Show/Hide window, camera status summary, Quit. [APPLIES RULES: `common-rule-ui-interaction-a11y-perf`]
      - [x] 10.5.3 Configure `electron-builder` for Windows packaging: NSIS installer, app name, icon, auto-update disabled (local app). [APPLIES RULES: `3-code-quality-checklist`]
      - [x] 10.5.4 Bundle FFmpeg binary with the packaged app (or document system requirement). [APPLIES RULES: `5-documentation-context-integrity`]
      - [x] 10.5.5 Bundle Python sidecar: either embed Python runtime + dependencies or document system Python + pip install requirement. [APPLIES RULES: `5-documentation-context-integrity`]
  - [x] 10.6 **Final documentation update:**
      - [x] 10.6.1 Update project `README.md` with: final architecture, complete setup guide, build instructions, troubleshooting FAQ. [APPLIES RULES: `5-documentation-context-integrity`]
      - [x] 10.6.2 Update `python-sidecar/README.md` with final API reference and GPU troubleshooting. [APPLIES RULES: `5-documentation-context-integrity`]

---

## Summary Statistics

| Metric | Count |
|---|---|
| High-level tasks | 10 |
| Sub-tasks (total) | 114 |
| Complex tasks | 7 (1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 10.0) |
| Simple tasks | 2 (8.0, 9.0) |
| Parallel opportunities | 2.0 ∥ 4.0; 3.0 ∥ 5.0 |
| Estimated MVP milestones | M1–M10 (per PRD Phase 1) |

---

**Next Step:** Once this task list is validated, proceed to `/implement` to begin execution starting with Task 1.0.
