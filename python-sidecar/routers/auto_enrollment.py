"""Auto-enrollment endpoint.

POST /auto_enroll — attempt to auto-enroll a face crop for a recognized person.
"""

import logging

from fastapi import APIRouter, HTTPException

from models.schemas import AutoEnrollRequest, AutoEnrollResponse
from services.auto_enrollment import purge_expired_auto_enrollments, try_auto_enroll

logger = logging.getLogger("ai-sidecar.auto_enrollment_router")

router = APIRouter(tags=["auto-enrollment"])


@router.post("/auto_enroll", response_model=AutoEnrollResponse)
async def auto_enroll(request: AutoEnrollRequest) -> AutoEnrollResponse:
    """Attempt to auto-enroll a new face crop for a recognized person.

    Checks similarity >= threshold, quality >= threshold, and count < max
    before storing the new embedding. All criteria must pass.
    """
    if not request.person_id:
        raise HTTPException(status_code=400, detail="person_id is required")
    if not request.crop_base64:
        raise HTTPException(status_code=400, detail="crop_base64 is required")
    if request.quality_score < 0 or request.quality_score > 100:
        raise HTTPException(status_code=400, detail="quality_score must be in [0, 100]")
    if request.similarity < 0 or request.similarity > 1:
        raise HTTPException(status_code=400, detail="similarity must be in [0, 1]")

    try:
        result = try_auto_enroll(
            person_id=request.person_id,
            person_name=request.person_id,
            crop_base64=request.crop_base64,
            quality_score=request.quality_score,
            similarity=request.similarity,
        )
    except Exception as exc:
        logger.error("Auto-enroll failed for person %s: %s", request.person_id, exc)
        raise HTTPException(status_code=500, detail=f"Auto-enroll error: {exc}") from exc

    logger.info(
        "Auto-enroll for person %s: success=%s count=%d reason=%s",
        request.person_id,
        result["success"],
        result.get("auto_enrolled_count", 0),
        result.get("reason", ""),
    )

    return AutoEnrollResponse(
        success=result["success"],
        auto_enrolled_count=result.get("auto_enrolled_count", 0),
    )


@router.post("/auto_enroll/purge_expired")
async def purge_expired() -> dict:
    """Purge expired auto-enrolled embeddings from the database.

    Called periodically by the Electron main process (ProcessManager).
    Returns the count of deleted embeddings.
    """
    try:
        deleted = purge_expired_auto_enrollments()
        return {"deleted": deleted, "success": True}
    except Exception as exc:
        logger.error("Purge expired auto-enrollments failed: %s", exc)
        return {"deleted": 0, "success": False}
