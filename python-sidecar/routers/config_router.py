"""Runtime configuration endpoint.

Allows the Electron main process to update AI sidecar config at runtime
(e.g., GPU toggle, thresholds) without restarting the service.
"""

import logging

from fastapi import APIRouter

from config import get_config, update_config
from models.schemas import ConfigResponse, ConfigUpdateRequest

logger = logging.getLogger("ai-sidecar.config_router")

router = APIRouter(tags=["config"])


@router.post("/config", response_model=ConfigResponse)
async def update_runtime_config(request: ConfigUpdateRequest) -> ConfigResponse:
    """Update runtime configuration.

    Accepts partial updates — only provided fields are changed.
    Returns the full active configuration after the update.
    """
    updated = update_config(
        gpu_enabled=request.gpu_enabled,
        model_name=request.model_name,
        det_threshold=request.det_threshold,
        rec_threshold=request.rec_threshold,
        yolo_enabled=request.yolo_enabled,
        yolo_confidence=request.yolo_confidence,
        yolo_classes=request.yolo_classes,
        quality_gate_enabled=request.quality_gate_enabled,
        night_enhance_enabled=request.night_enhance_enabled,
        night_luminance_threshold=request.night_luminance_threshold,
    )

    logger.info(
        "Config updated: gpu=%s model=%s det=%.2f rec=%.2f qgate=%s night=%s",
        updated.gpu_enabled,
        updated.model_name,
        updated.det_threshold,
        updated.rec_threshold,
        updated.quality_gate_enabled,
        updated.night_enhance_enabled,
    )

    return ConfigResponse(
        success=True,
        active_config={
            "gpu_enabled": updated.gpu_enabled,
            "model_name": updated.model_name,
            "det_threshold": updated.det_threshold,
            "rec_threshold": updated.rec_threshold,
            "port": updated.port,
            "host": updated.host,
            "yolo_enabled": updated.yolo_enabled,
            "yolo_confidence": updated.yolo_confidence,
            "quality_gate_enabled": updated.quality_gate_enabled,
            "quality_gate_max_yaw": updated.quality_gate_max_yaw,
            "quality_gate_max_pitch": updated.quality_gate_max_pitch,
            "quality_gate_min_blur": updated.quality_gate_min_blur,
            "night_enhance_enabled": updated.night_enhance_enabled,
            "night_luminance_threshold": updated.night_luminance_threshold,
            "adaptive_threshold_enabled": updated.adaptive_threshold_enabled,
            "auto_enroll_enabled": updated.auto_enroll_enabled,
            "negative_gallery_threshold": updated.negative_gallery_threshold,
        },
    )
