"""Health check endpoint for the AI sidecar.

Returns service health status, GPU availability, and model loading state.
"""

import logging

from fastapi import APIRouter

from config import detect_gpu, get_config
from models.schemas import HealthResponse
from services.model_loader import get_active_provider, is_model_loaded
from services.object_detection import is_yolo_loaded
from services.reid import is_loaded as is_reid_loaded
from services.liveness import is_loaded as is_liveness_loaded
from services.gait_recognition import is_loaded as is_gait_loaded

logger = logging.getLogger("ai-sidecar.health")

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return service health including GPU metrics and model status."""
    cfg = get_config()
    gpu_available, gpu_name, vram_total_mb, vram_used_mb, cuda_version = detect_gpu()

    return HealthResponse(
        status="healthy" if is_model_loaded() else "degraded",
        gpu_available=gpu_available,
        gpu_name=gpu_name,
        vram_total_mb=vram_total_mb,
        vram_used_mb=vram_used_mb,
        cuda_version=cuda_version,
        execution_provider=get_active_provider(),
        model_loaded=is_model_loaded(),
        model_name=cfg.model_name,
        yolo_loaded=is_yolo_loaded(),
        reid_loaded=is_reid_loaded(),
        liveness_loaded=is_liveness_loaded(),
        gait_loaded=is_gait_loaded(),
    )
