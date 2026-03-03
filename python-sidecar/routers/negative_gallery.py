"""Negative gallery endpoints.

POST /negative/add          — add a false-positive crop to the negative gallery.
GET  /negative/list         — list negative gallery entries for a person.
DELETE /negative/{entry_id} — remove a negative gallery entry.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from models.schemas import (
    NegativeAddRequest,
    NegativeAddResponse,
    NegativeEntry,
    NegativeListResponse,
    SuccessResponse,
)
from services.negative_gallery import add_negative, delete_negative, list_negatives

logger = logging.getLogger("ai-sidecar.negative_gallery_router")

router = APIRouter(tags=["negative-gallery"])


@router.post("/negative/add", response_model=NegativeAddResponse)
async def add_negative_entry(request: NegativeAddRequest) -> NegativeAddResponse:
    """Add a false-positive face crop to the negative gallery.

    The face crop is embedded and stored. Future recognition requests
    matching this embedding will be rejected for the specified person.
    """
    if not request.person_id:
        raise HTTPException(status_code=400, detail="person_id is required")
    if not request.crop_base64:
        raise HTTPException(status_code=400, detail="crop_base64 is required")

    try:
        result = add_negative(
            person_id=request.person_id,
            crop_base64=request.crop_base64,
            source_event_id=request.source_event_id,
        )
    except Exception as exc:
        logger.error("Failed to add negative for person %s: %s", request.person_id, exc)
        raise HTTPException(status_code=500, detail=f"Negative gallery error: {exc}") from exc

    if not result["success"]:
        raise HTTPException(
            status_code=422,
            detail=f"Could not embed negative crop — ensure a clear face is visible",
        )

    return NegativeAddResponse(success=result["success"], id=result["id"])


@router.get("/negative/list", response_model=NegativeListResponse)
async def list_negative_entries(
    person_id: str = Query(..., description="Person ID to list negatives for"),
) -> NegativeListResponse:
    """List all negative gallery entries for a person."""
    if not person_id:
        raise HTTPException(status_code=400, detail="person_id is required")

    try:
        entries_raw = list_negatives(person_id)
    except Exception as exc:
        logger.error("Failed to list negatives for person %s: %s", person_id, exc)
        raise HTTPException(status_code=500, detail=f"List error: {exc}") from exc

    entries = [
        NegativeEntry(
            id=e["id"],
            person_id=e["person_id"],
            created_at=e["created_at"],
        )
        for e in entries_raw
    ]

    return NegativeListResponse(entries=entries)


@router.delete("/negative/{entry_id}", response_model=SuccessResponse)
async def delete_negative_entry(entry_id: str) -> SuccessResponse:
    """Delete a negative gallery entry by ID."""
    if not entry_id:
        raise HTTPException(status_code=400, detail="entry_id is required")

    try:
        ok = delete_negative(entry_id)
    except Exception as exc:
        logger.error("Failed to delete negative %s: %s", entry_id, exc)
        raise HTTPException(status_code=500, detail=f"Delete error: {exc}") from exc

    if not ok:
        raise HTTPException(status_code=404, detail=f"Negative entry {entry_id} not found")

    return SuccessResponse(success=True)
