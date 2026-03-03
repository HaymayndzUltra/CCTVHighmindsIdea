"""Gait recognition router — POST /gait/analyze endpoint."""

import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.gait_recognition import analyze_gait, is_loaded

logger = logging.getLogger("ai-sidecar.gait_router")
router = APIRouter(tags=["gait"])


class GaitAnalyzeRequest(BaseModel):
    """Request body for gait analysis."""
    frames_base64: list[str] = Field(..., min_length=1)
    person_id: str | None = None
    track_id: int | None = None
    camera_id: str | None = None


class GaitAnalyzeResponse(BaseModel):
    """Response from gait analysis."""
    gait_embedding: list[float]
    confidence: float
    method: str
    frames_used: int


@router.post("/gait/analyze", response_model=GaitAnalyzeResponse)
async def gait_analyze(request: GaitAnalyzeRequest) -> GaitAnalyzeResponse:
    """Analyze a walking sequence to extract a gait embedding."""
    if not is_loaded():
        raise HTTPException(status_code=503, detail="Gait model not loaded")

    if not request.frames_base64:
        raise HTTPException(status_code=400, detail="frames_base64 is required and must not be empty")

    try:
        frames: list[np.ndarray] = []
        for frame_b64 in request.frames_base64:
            img_bytes = base64.b64decode(frame_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is not None:
                frames.append(frame)

        if len(frames) < 10:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient decodable frames: {len(frames)} (minimum 10 required)",
            )

        result = analyze_gait(frames)

        return GaitAnalyzeResponse(
            gait_embedding=result["gait_embedding"],
            confidence=result["confidence"],
            method=result["method"],
            frames_used=result["frames_used"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Gait analysis failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Gait analysis failed: {e}")
