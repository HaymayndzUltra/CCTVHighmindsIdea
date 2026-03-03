"""Liveness detection router — POST /liveness endpoint."""

import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.liveness import check_liveness, is_loaded

logger = logging.getLogger("liveness_router")
router = APIRouter(tags=["liveness"])


class LivenessRequest(BaseModel):
    """Request body for liveness check."""
    face_crop_base64: str


class LivenessResponse(BaseModel):
    """Response from liveness check."""
    is_live: bool
    score: float
    method: str


@router.post("/liveness", response_model=LivenessResponse)
async def liveness_check(request: LivenessRequest) -> LivenessResponse:
    """Check if a face crop is from a live person or a spoof (photo/screen)."""
    if not is_loaded():
        raise HTTPException(status_code=503, detail="Liveness model not loaded")

    if not request.face_crop_base64:
        raise HTTPException(status_code=400, detail="face_crop_base64 is required")

    try:
        img_bytes = base64.b64decode(request.face_crop_base64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        face_crop = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if face_crop is None:
            raise HTTPException(status_code=400, detail="Failed to decode face crop image")

        result = check_liveness(face_crop)

        return LivenessResponse(
            is_live=result["is_live"],
            score=result["score"],
            method=result.get("method", "unknown"),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Liveness check failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Liveness check failed: {e}")
