"""Person management endpoints.

Provides read/update/delete operations for enrolled persons.
Reads from and writes to the SQLite database directly.
The Electron main process is the primary source of truth for person data;
these endpoints allow the sidecar to serve person info and trigger
embedding reloads after mutations.
"""

import logging
import sqlite3

from fastapi import APIRouter, HTTPException

from config import get_config
from models.schemas import (
    PersonInfo,
    PersonsListResponse,
    PersonUpdateRequest,
    SuccessResponse,
)
from services.face_recognition import reload_embeddings

logger = logging.getLogger("ai-sidecar.persons")

router = APIRouter(tags=["persons"])


def _get_db_connection() -> sqlite3.Connection:
    """Open a connection to the configured SQLite database.

    Raises:
        HTTPException: If db_path is not configured.
    """
    cfg = get_config()
    if not cfg.db_path:
        raise HTTPException(
            status_code=503,
            detail="Database path not configured for sidecar",
        )
    try:
        conn = sqlite3.connect(cfg.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as exc:
        logger.error("Failed to connect to database: %s", exc)
        raise HTTPException(status_code=503, detail=f"Database error: {exc}") from exc


@router.get("/persons", response_model=PersonsListResponse)
async def list_persons() -> PersonsListResponse:
    """List all enrolled persons with their embedding counts."""
    conn = _get_db_connection()
    try:
        cursor = conn.execute(
            """
            SELECT
                p.id,
                p.name,
                p.enabled,
                COUNT(fe.id) AS embeddings_count
            FROM persons p
            LEFT JOIN face_embeddings fe ON p.id = fe.person_id
            GROUP BY p.id
            ORDER BY p.name ASC
            """
        )
        persons = [
            PersonInfo(
                id=row["id"],
                name=row["name"],
                embeddings_count=row["embeddings_count"],
                enabled=bool(row["enabled"]),
            )
            for row in cursor
        ]
        return PersonsListResponse(persons=persons)
    except sqlite3.Error as exc:
        logger.error("Failed to list persons: %s", exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    finally:
        conn.close()


@router.put("/person/{person_id}", response_model=SuccessResponse)
async def update_person(person_id: str, request: PersonUpdateRequest) -> SuccessResponse:
    """Update a person's name or enabled status."""
    if not person_id:
        raise HTTPException(status_code=400, detail="person_id is required")

    conn = _get_db_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM persons WHERE id = ?", (person_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Person '{person_id}' not found")

        updates: list[str] = []
        params: list[str | int] = []

        if request.name is not None:
            updates.append("name = ?")
            params.append(request.name)
        if request.enabled is not None:
            updates.append("enabled = ?")
            params.append(1 if request.enabled else 0)

        if not updates:
            return SuccessResponse(success=True)

        updates.append("updated_at = datetime('now')")
        params.append(person_id)

        conn.execute(
            f"UPDATE persons SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()

        if request.enabled is not None:
            reload_embeddings()

        logger.info("Updated person %s: %s", person_id, updates)
        return SuccessResponse(success=True)
    except sqlite3.Error as exc:
        logger.error("Failed to update person %s: %s", person_id, exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    finally:
        conn.close()


@router.delete("/person/{person_id}", response_model=SuccessResponse)
async def delete_person(person_id: str) -> SuccessResponse:
    """Delete a person and all their face embeddings (cascade)."""
    if not person_id:
        raise HTTPException(status_code=400, detail="person_id is required")

    conn = _get_db_connection()
    try:
        conn.execute("PRAGMA foreign_keys = ON")

        existing = conn.execute(
            "SELECT id FROM persons WHERE id = ?", (person_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Person '{person_id}' not found")

        conn.execute("DELETE FROM persons WHERE id = ?", (person_id,))
        conn.commit()

        reload_embeddings()

        logger.info("Deleted person %s and associated embeddings", person_id)
        return SuccessResponse(success=True)
    except sqlite3.Error as exc:
        logger.error("Failed to delete person %s: %s", person_id, exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    finally:
        conn.close()
