"""Face recognition endpoint.

Accepts a 512-dim embedding and compares it against enrolled persons.
Applies adaptive per-person thresholds and multi-frame confirmation tracking.
"""

import logging

from fastapi import APIRouter, HTTPException

from config import get_config
from models.schemas import RecognizeRequest, RecognizeResponse
from services.adaptive_threshold import recognize_with_adaptive_threshold
from services.confirmation_tracker import confirmation_tracker
from services.face_recognition import _enrolled_embeddings
from services.negative_gallery import is_in_negative_gallery

logger = logging.getLogger("ai-sidecar.recognition")

router = APIRouter(tags=["recognition"])


@router.post("/recognize", response_model=RecognizeResponse)
async def recognize(request: RecognizeRequest) -> RecognizeResponse:
    """Match a face embedding against enrolled persons.

    Uses adaptive per-person thresholds when adaptive_threshold_enabled=True.
    Applies multi-frame confirmation when camera_id and track_id are provided.
    Returns match status, person identity, and confidence score.
    """
    if len(request.embedding) != 512:
        raise HTTPException(
            status_code=400,
            detail=f"Embedding must have 512 dimensions, got {len(request.embedding)}",
        )

    cfg = get_config()

    try:
        if cfg.adaptive_threshold_enabled:
            result = recognize_with_adaptive_threshold(
                query_embedding=request.embedding,
                enrolled_embeddings=_enrolled_embeddings,
            )
        else:
            from services.face_recognition import recognize_face
            result = recognize_face(
                embedding=request.embedding,
                threshold=request.threshold,
            )
    except Exception as exc:
        logger.error("Recognition failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Recognition error: {exc}") from exc

    if result.get("matched") and result.get("person_id"):
        is_negative = is_in_negative_gallery(
            person_id=result["person_id"],
            query_embedding=request.embedding,
        )
        if is_negative:
            logger.debug(
                "Recognition rejected by negative gallery for person %s",
                result["person_id"],
            )
            result = {**result, "matched": False, "person_id": None, "person_name": None}

    camera_id = getattr(request, "camera_id", None) or ""
    track_id = getattr(request, "track_id", None)

    if camera_id and track_id is not None:
        confirmed = confirmation_tracker.update(
            camera_id=camera_id,
            track_id=int(track_id),
            recognition_result=result,
        )
        if result.get("matched") and not confirmed.get("confirmed"):
            result = {**result, "matched": False}
            logger.debug(
                "Recognition suppressed — awaiting confirmation (%d/%d hits)",
                confirmed.get("hit_count", 0),
                cfg.confirmation_frames,
            )

    return RecognizeResponse(
        matched=result["matched"],
        person_id=result.get("person_id"),
        person_name=result.get("person_name"),
        confidence=result["confidence"],
    )
