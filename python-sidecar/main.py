"""Tapo CCTV Desktop — AI Sidecar (FastAPI)

Face detection and recognition service powered by InsightFace.
Communicates with Electron main process via local HTTP on port 8520.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import detect_gpu, get_config
from routers import auto_enrollment, config_router, detection, embeddings_sync, enrollment, gait, health, liveness, negative_gallery, object_detection, persons, recognition, reid, sound, zone_check
from services.model_loader import load_model
from services.model_downloader import ensure_models
from services.object_detection import load_yolo_model
from services.liveness import load_liveness_model
from services.reid import load_reid_model
from services.gait_recognition import load_gait_model

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("ai-sidecar")


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    """Handle startup and shutdown events.

    On startup: detect GPU, load InsightFace model.
    On shutdown: log clean exit.
    """
    cfg = get_config()
    logger.info("Starting on %s:%d", cfg.host, cfg.port)
    logger.info("GPU enabled (config): %s", cfg.gpu_enabled)
    logger.info("Model: %s", cfg.model_name)

    # R2-H12: Check and download missing ONNX models before loading
    try:
        model_status = ensure_models()
        for name, status in model_status.items():
            logger.info("Model check: %s → %s", name, status)
    except Exception as exc:
        logger.warning("Model download check failed (non-fatal): %s", exc)

    gpu_available, gpu_name, vram_total_mb, vram_used_mb, cuda_version = detect_gpu()
    logger.info("GPU detected: %s (%s) VRAM: %d/%d MiB CUDA: %s", gpu_available, gpu_name, vram_used_mb, vram_total_mb, cuda_version)

    try:
        load_model(
            model_name=cfg.model_name,
            gpu_enabled=cfg.gpu_enabled and gpu_available,
        )
        logger.info("Model loaded successfully — ready to serve requests")
    except RuntimeError as exc:
        logger.error(
            "Model loading failed: %s. Service will start in degraded mode.", exc
        )

    yolo_ok = load_yolo_model(gpu_enabled=cfg.gpu_enabled and gpu_available)
    if yolo_ok:
        logger.info("YOLOv8s loaded successfully")
    else:
        logger.warning("YOLOv8s failed to load — object detection unavailable")

    liveness_ok = load_liveness_model(gpu_enabled=cfg.gpu_enabled and gpu_available)
    if liveness_ok:
        logger.info("Liveness detection loaded")
    else:
        logger.warning("Liveness detection failed to load")

    reid_ok = load_reid_model(gpu_enabled=cfg.gpu_enabled and gpu_available)
    if reid_ok:
        logger.info("Re-ID (OSNet-AIN) loaded")
    else:
        logger.warning("Re-ID failed to load — cross-camera matching unavailable")

    gait_ok = load_gait_model(gpu_enabled=cfg.gpu_enabled and gpu_available)
    if gait_ok:
        logger.info("Gait recognition loaded")
    else:
        logger.warning("Gait recognition failed to load")

    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="Tapo CCTV AI Sidecar",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(detection.router)
app.include_router(recognition.router)
app.include_router(config_router.router)
app.include_router(enrollment.router)
app.include_router(persons.router)
app.include_router(object_detection.router)
app.include_router(auto_enrollment.router)
app.include_router(negative_gallery.router)
app.include_router(zone_check.router)
app.include_router(liveness.router)
app.include_router(sound.router)
app.include_router(reid.router)
app.include_router(gait.router)
app.include_router(embeddings_sync.router)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint for basic connectivity check."""
    return {"service": "tapo-cctv-ai-sidecar", "status": "running"}
