"""Sound event detection router — POST /sound/classify endpoint."""

import base64
import logging
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.sound_detection import classify_audio, is_loaded

logger = logging.getLogger("sound_router")
router = APIRouter(tags=["sound"])


class SoundClassifyRequest(BaseModel):
    """Request body for sound classification."""
    audio_base64: str
    sample_rate: int = 16000
    confidence_threshold: float = 0.3
    target_classes: Optional[List[str]] = None


class SoundEvent(BaseModel):
    """A detected sound event."""
    sound_class: str
    confidence: float
    start_ms: int
    end_ms: int


class SoundClassifyResponse(BaseModel):
    """Response from sound classification."""
    events: List[SoundEvent]
    model_loaded: bool


@router.post("/sound/classify", response_model=SoundClassifyResponse)
async def classify_sound(request: SoundClassifyRequest) -> SoundClassifyResponse:
    """Classify an audio segment for security-relevant sounds."""
    if not is_loaded():
        return SoundClassifyResponse(events=[], model_loaded=False)

    if not request.audio_base64:
        raise HTTPException(status_code=400, detail="audio_base64 is required")

    try:
        audio_bytes = base64.b64decode(request.audio_base64)
        audio_data = np.frombuffer(audio_bytes, dtype=np.float32)

        if audio_data.size == 0:
            return SoundClassifyResponse(events=[], model_loaded=True)

        detections = classify_audio(
            audio_data=audio_data,
            sample_rate=request.sample_rate,
            confidence_threshold=request.confidence_threshold,
            target_classes=request.target_classes,
        )

        events = [
            SoundEvent(
                sound_class=d["class"],
                confidence=d["confidence"],
                start_ms=d["start_ms"],
                end_ms=d["end_ms"],
            )
            for d in detections
        ]

        return SoundClassifyResponse(events=events, model_loaded=True)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Sound classification failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Sound classification failed: {e}")
