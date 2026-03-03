"""Embeddings sync endpoint.

Receives decrypted face embeddings from Electron main process.
The Electron side handles AES decryption — this endpoint just stores
the plain float32 embeddings in memory for the /recognize endpoint.
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.face_recognition import set_embeddings, _enrolled_embeddings

logger = logging.getLogger("ai-sidecar.embeddings_sync")

router = APIRouter(tags=["embeddings_sync"])


class EmbeddingEntry(BaseModel):
    person_id: str
    person_name: str
    embedding: list[float]


class SyncRequest(BaseModel):
    embeddings: list[EmbeddingEntry]


class SyncResponse(BaseModel):
    success: bool
    count: int


@router.post("/embeddings/sync", response_model=SyncResponse)
async def sync_embeddings(request: SyncRequest) -> SyncResponse:
    """Receive decrypted embeddings from Electron and store in memory.

    Called on app startup and after each enrollment to keep the sidecar's
    in-memory embedding gallery in sync with the encrypted SQLite store.
    """
    if not request.embeddings:
        logger.info("Sync received 0 embeddings — gallery cleared")
        set_embeddings([])
        return SyncResponse(success=True, count=0)

    import numpy as np

    entries: list[dict[str, Any]] = []
    for entry in request.embeddings:
        if len(entry.embedding) != 512:
            logger.warning(
                "Skipping embedding for %s: dim=%d (expected 512)",
                entry.person_id,
                len(entry.embedding),
            )
            continue
        entries.append({
            "person_id": entry.person_id,
            "person_name": entry.person_name,
            "embedding": np.array(entry.embedding, dtype=np.float32),
        })

    set_embeddings(entries)
    logger.info("Synced %d embeddings from Electron", len(entries))
    return SyncResponse(success=True, count=len(entries))


@router.get("/embeddings/count")
async def get_embedding_count() -> dict[str, int]:
    """Return the number of enrolled embeddings currently in memory."""
    return {"count": len(_enrolled_embeddings)}
