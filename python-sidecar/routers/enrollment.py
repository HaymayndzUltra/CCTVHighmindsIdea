"""Enrollment endpoint.

Accepts person_id, person_name, and base64-encoded images.
Detects faces, validates one face per image, and returns embeddings
for the Electron main process to encrypt and store.
"""

import logging

from fastapi import APIRouter, HTTPException

from models.schemas import EnrollRequest, EnrollResponse
from services.enrollment import enroll_person

logger = logging.getLogger("ai-sidecar.enrollment")

router = APIRouter(tags=["enrollment"])


@router.post("/enroll", response_model=EnrollResponse)
async def enroll(request: EnrollRequest) -> EnrollResponse:
    """Enroll a person by extracting face embeddings from provided images.

    Expects person_id, person_name, and a list of base64-encoded images.
    Returns the count of successfully extracted embeddings and per-image errors.
    """
    if not request.person_id:
        raise HTTPException(status_code=400, detail="person_id is required")

    if not request.person_name:
        raise HTTPException(status_code=400, detail="person_name is required")

    if not request.images_base64:
        raise HTTPException(status_code=400, detail="At least one image is required")

    try:
        result = enroll_person(
            person_id=request.person_id,
            images_base64=request.images_base64,
        )
    except RuntimeError as exc:
        logger.error("Enrollment failed for person %s: %s", request.person_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    logger.info(
        "Enrollment for person %s ('%s'): %d embeddings extracted",
        request.person_id,
        request.person_name,
        len(result["embeddings"]),
    )

    return EnrollResponse(
        success=result["success"],
        embeddings_count=len(result["embeddings"]),
        embeddings=result["embeddings"],
        errors=result["errors"],
    )
