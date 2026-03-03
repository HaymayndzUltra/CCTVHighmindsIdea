# Tapo CCTV AI Sidecar

FastAPI microservice providing face detection and recognition via InsightFace.
Launched and managed by the Electron main process via `ProcessManager`.

## Architecture

```
Electron Main Process
    │
    ├── ProcessManager.ts  → spawns Python child process
    │                        health-checks every 5s
    │                        auto-restarts on failure (backoff: 5s/10s/30s)
    │
    └── AIBridgeService.ts → HTTP client to localhost:8520
                              timeout: 5s, 1 retry, graceful fallback

Python FastAPI (this service)
    ├── main.py            → app + lifespan (GPU detect + model load)
    ├── config.py          → runtime config + GPU detection
    ├── services/
    │   ├── model_loader.py      → InsightFace buffalo_l loading
    │   ├── face_detection.py    → detect_faces(frame) → faces[]
    │   └── face_recognition.py  → recognize_face(embedding) → match
    └── routers/
        ├── health.py        → GET /health
        ├── detection.py     → POST /detect
        ├── recognition.py   → POST /recognize
        └── config_router.py → POST /config
```

## Requirements

- **Python** >= 3.10
- **NVIDIA GPU** with CUDA support (recommended)
  - CUDA Toolkit 11.8 or 12.x
  - cuDNN compatible with your CUDA version
- Falls back to CPU if no GPU is detected

## Setup

```bash
cd python-sidecar
python -m venv venv

# Activate virtual environment
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux/macOS

pip install -r requirements.txt
```

### GPU Setup (CUDA)

1. Install NVIDIA driver (latest Game Ready or Studio)
2. Install CUDA Toolkit 11.8 or 12.x from https://developer.nvidia.com/cuda-downloads
3. Install cuDNN matching your CUDA version
4. Verify: `nvidia-smi` should show your GPU and CUDA version
5. Verify onnxruntime sees CUDA:
   ```python
   import onnxruntime
   print(onnxruntime.get_available_providers())
   # Should include 'CUDAExecutionProvider'
   ```

### GPU Troubleshooting

If `onnxruntime-gpu` fails to install or detect your GPU:

1. Verify CUDA: `nvidia-smi` should show your GPU and CUDA version
2. Ensure CUDA Toolkit matches onnxruntime requirements: https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
3. For CPU-only fallback: replace `onnxruntime-gpu` with `onnxruntime` in `requirements.txt`
4. If CUDA version mismatch: `pip install onnxruntime-gpu==1.17.0` (match your CUDA)
5. Check GPU memory: `nvidia-smi` — model needs ~1.5GB VRAM

### InsightFace Model Download

The `buffalo_l` model will auto-download on first run to `~/.insightface/models/buffalo_l/`.

- Model size: ~350MB
- Contains: detection (RetinaFace) + recognition (ArcFace) models
- First startup may take 30-60 seconds for download
- Manual download: https://github.com/deepinsight/insightface/releases

To verify model is cached:
```bash
ls ~/.insightface/models/buffalo_l/
# Should contain: det_10g.onnx, w600k_r50.onnx, etc.
```

## Running

```bash
# Development (with auto-reload)
python -m uvicorn main:app --host 127.0.0.1 --port 8520 --reload

# Production
python -m uvicorn main:app --host 127.0.0.1 --port 8520

# Check health
curl http://127.0.0.1:8520/health
```

## Configuration

Runtime config via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SIDECAR_GPU_ENABLED` | `true` | Enable GPU acceleration |
| `SIDECAR_MODEL_NAME` | `buffalo_l` | InsightFace model name |
| `SIDECAR_DET_THRESHOLD` | `0.5` | Face detection confidence threshold |
| `SIDECAR_REC_THRESHOLD` | `0.6` | Face recognition match threshold |
| `SIDECAR_PORT` | `8520` | HTTP server port |
| `SIDECAR_HOST` | `127.0.0.1` | HTTP server host |
| `SIDECAR_DB_PATH` | `""` | Path to SQLite database (optional, for direct DB access) |

## API Reference

### GET /
Root connectivity check.
```json
{ "service": "tapo-cctv-ai-sidecar", "status": "running" }
```

### GET /health
Service health including GPU and model status.
```json
{
  "status": "healthy",
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 4090",
  "model_loaded": true,
  "model_name": "buffalo_l"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `"healthy"` (model loaded) or `"degraded"` (model failed) |
| `gpu_available` | `bool` | Whether CUDA GPU was detected |
| `gpu_name` | `string` | GPU device name or `"N/A"` |
| `model_loaded` | `bool` | Whether InsightFace model loaded successfully |
| `model_name` | `string` | Active model name (e.g., `"buffalo_l"`) |

### POST /detect
Detect faces in a base64-encoded image frame.

**Request:**
```json
{
  "camera_id": "CAM-1",
  "frame_base64": "<base64-encoded-jpeg>",
  "timestamp": 1709400000.0
}
```

**Response:**
```json
{
  "faces": [
    {
      "bbox": [100.0, 50.0, 250.0, 300.0],
      "confidence": 0.97,
      "embedding": [0.012, -0.034, ...]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `bbox` | `float[4]` | Bounding box `[x1, y1, x2, y2]` in pixels |
| `confidence` | `float` | Detection confidence `[0, 1]` |
| `embedding` | `float[512]` | 512-dimensional face embedding vector |

**Error codes:** `400` (invalid base64/image), `503` (model not loaded)

### POST /recognize
Match a face embedding against enrolled persons using cosine similarity.

**Request:**
```json
{
  "embedding": [0.012, -0.034, ...],
  "threshold": 0.6
}
```

**Response:**
```json
{
  "matched": true,
  "person_id": "abc123",
  "person_name": "John",
  "confidence": 0.82
}
```

| Field | Type | Description |
|-------|------|-------------|
| `matched` | `bool` | Whether a match above threshold was found |
| `person_id` | `string?` | Matched person ID or `null` |
| `person_name` | `string?` | Matched person name or `null` |
| `confidence` | `float` | Highest cosine similarity score |

### POST /enroll
Enroll a person by extracting face embeddings from provided images.

**Request:**
```json
{
  "person_id": "abc123",
  "person_name": "John",
  "images_base64": ["<base64-jpeg>", "<base64-jpeg>"]
}
```

**Response:**
```json
{
  "success": true,
  "embeddings_count": 2,
  "embeddings": [[0.012, -0.034, ...], [0.015, -0.028, ...]],
  "errors": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | `bool` | Whether at least one embedding was extracted |
| `embeddings_count` | `int` | Number of successfully extracted embeddings |
| `embeddings` | `float[][]` | List of 512-dim embedding vectors |
| `errors` | `string[]` | Per-image error messages (e.g., no face found) |

**Error codes:** `400` (missing fields), `503` (model not loaded)

### GET /persons
List all enrolled persons with embedding counts. Requires `SIDECAR_DB_PATH` to be configured.

**Response:**
```json
{
  "persons": [
    { "id": "abc123", "name": "John", "embeddings_count": 3, "enabled": true }
  ]
}
```

### PUT /person/{person_id}
Update a person's name or enabled status. Triggers embedding reload if enabled status changes.

**Request:**
```json
{
  "name": "John Doe",
  "enabled": true
}
```
All fields are optional.

**Response:** `{ "success": true }`

**Error codes:** `404` (person not found), `503` (DB not configured)

### DELETE /person/{person_id}
Delete a person and all their face embeddings (cascading delete). Triggers embedding reload.

**Response:** `{ "success": true }`

**Error codes:** `404` (person not found), `503` (DB not configured)

### POST /config
Update runtime configuration without restart.

**Request:**
```json
{
  "gpu_enabled": true,
  "model_name": "buffalo_l",
  "det_threshold": 0.5,
  "rec_threshold": 0.6
}
```
All fields are optional — only provided fields are updated.

**Response:**
```json
{
  "success": true,
  "active_config": {
    "gpu_enabled": true,
    "model_name": "buffalo_l",
    "det_threshold": 0.5,
    "rec_threshold": 0.6,
    "port": 8520,
    "host": "127.0.0.1"
  }
}
```

## Testing

```bash
# 1. Start the service
python -m uvicorn main:app --host 127.0.0.1 --port 8520 --reload

# 2. Verify health
curl http://127.0.0.1:8520/health

# 3. Test detection (with a test image)
python -c "
import base64, json, requests
with open('test_image.jpg', 'rb') as f:
    b64 = base64.b64encode(f.read()).decode()
resp = requests.post('http://127.0.0.1:8520/detect', json={
    'camera_id': 'test',
    'frame_base64': b64,
    'timestamp': 0.0,
})
print(json.dumps(resp.json(), indent=2))
"

# 4. Test config update
curl -X POST http://127.0.0.1:8520/config \
  -H 'Content-Type: application/json' \
  -d '{"det_threshold": 0.7}'
```

## Module Overview

| Module | Purpose |
|--------|---------|
| `main.py` | FastAPI app, lifespan (GPU detect + model load), router wiring |
| `config.py` | `SidecarConfig` dataclass, `detect_gpu()`, env var parsing |
| `services/model_loader.py` | InsightFace `FaceAnalysis` loading with CUDA/CPU fallback |
| `services/face_detection.py` | `detect_faces(frame)` → list of faces with bbox/embedding |
| `services/face_recognition.py` | `recognize_face(embedding)` → match result via cosine similarity |
| `routers/health.py` | `GET /health` — service + GPU + model status |
| `routers/detection.py` | `POST /detect` — base64 decode + face detection |
| `routers/recognition.py` | `POST /recognize` — embedding matching |
| `routers/config_router.py` | `POST /config` — runtime config update |
| `models/schemas.py` | Pydantic request/response models for all endpoints |
