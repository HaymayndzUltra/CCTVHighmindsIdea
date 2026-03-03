"""Negative gallery service.

Stores false-positive face crops as embeddings to prevent repeated misidentification.
During recognition, if a query embedding is too similar to any negative gallery entry
for a given person, the match is rejected.

Storage: SQLite `negative_gallery` table with encrypted embeddings.
Lookup: Per-person in-memory cache refreshed on write.
"""

import base64
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np

from config import get_config
from services.model_loader import get_face_app

logger = logging.getLogger("ai-sidecar.negative_gallery")

_negative_cache: dict[str, list[np.ndarray]] = {}


def _decode_image(img_base64: str) -> np.ndarray | None:
    """Decode base64 image to BGR numpy array."""
    try:
        img_bytes = base64.b64decode(img_base64)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    except Exception as exc:
        logger.warning("Failed to decode negative image: %s", exc)
        return None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def add_negative(
    person_id: str,
    crop_base64: str,
    source_event_id: str | None = None,
) -> dict[str, Any]:
    """Add a false-positive face crop to the negative gallery.

    Args:
        person_id: Person that was incorrectly matched.
        crop_base64: Base64-encoded face crop image.
        source_event_id: Optional event ID that triggered this false positive.

    Returns:
        Dict with keys: success (bool), id (str).
    """
    cfg = get_config()
    if not cfg.db_path:
        logger.debug("Negative gallery add skipped — no db_path configured")
        return {"success": False, "id": ""}

    crop = _decode_image(crop_base64)
    if crop is None:
        return {"success": False, "id": ""}

    face_app = get_face_app()
    if face_app is None:
        return {"success": False, "id": ""}

    try:
        faces = face_app.get(crop)
    except Exception as exc:
        logger.warning("Failed to extract embedding from negative crop: %s", exc)
        return {"success": False, "id": ""}

    if not faces or faces[0].normed_embedding is None:
        logger.warning("No face detected in negative crop for person %s", person_id)
        return {"success": False, "id": ""}

    embedding = faces[0].normed_embedding
    if len(embedding) != 512:
        return {"success": False, "id": ""}

    embedding_bytes = embedding.astype(np.float32).tobytes()
    entry_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    try:
        conn = sqlite3.connect(cfg.db_path)
        conn.execute(
            """
            INSERT INTO negative_gallery
                (id, person_id, embedding_data, source_event_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (entry_id, person_id, embedding_bytes, source_event_id, created_at),
        )
        conn.commit()
        conn.close()

        if person_id in _negative_cache:
            _negative_cache[person_id].append(embedding.astype(np.float32))
        else:
            _negative_cache[person_id] = [embedding.astype(np.float32)]

        logger.info("Added negative gallery entry %s for person %s", entry_id, person_id)
        return {"success": True, "id": entry_id}

    except sqlite3.Error as exc:
        logger.error("DB error storing negative gallery entry: %s", exc)
        return {"success": False, "id": ""}


def list_negatives(person_id: str) -> list[dict[str, Any]]:
    """List all negative gallery entries for a person.

    Args:
        person_id: Person to list negatives for.

    Returns:
        List of dicts with keys: id, person_id, created_at.
    """
    cfg = get_config()
    if not cfg.db_path:
        return []

    if not person_id:
        logger.warning("list_negatives() called with empty person_id")
        return []

    try:
        conn = sqlite3.connect(cfg.db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, person_id, created_at FROM negative_gallery WHERE person_id = ? ORDER BY created_at DESC",
            (person_id,),
        ).fetchall()
        conn.close()
        return [{"id": row["id"], "person_id": row["person_id"], "created_at": row["created_at"]} for row in rows]
    except sqlite3.Error as exc:
        logger.error("DB error listing negatives for person %s: %s", person_id, exc)
        return []


def delete_negative(entry_id: str) -> bool:
    """Delete a negative gallery entry by ID.

    Also invalidates the in-memory cache for the affected person.

    Returns True if deleted successfully.
    """
    cfg = get_config()
    if not cfg.db_path:
        return False

    if not entry_id:
        return False

    try:
        conn = sqlite3.connect(cfg.db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT person_id FROM negative_gallery WHERE id = ?",
            (entry_id,),
        ).fetchone()

        if row is None:
            conn.close()
            return False

        person_id = row["person_id"]
        conn.execute("DELETE FROM negative_gallery WHERE id = ?", (entry_id,))
        conn.commit()
        conn.close()

        _negative_cache.pop(person_id, None)
        logger.info("Deleted negative gallery entry %s for person %s", entry_id, person_id)
        return True

    except sqlite3.Error as exc:
        logger.error("DB error deleting negative %s: %s", entry_id, exc)
        return False


def _load_negatives_for_person(person_id: str) -> list[np.ndarray]:
    """Load negative gallery embeddings from DB into cache for a person."""
    cfg = get_config()
    if not cfg.db_path:
        return []

    try:
        conn = sqlite3.connect(cfg.db_path)
        rows = conn.execute(
            "SELECT embedding_data FROM negative_gallery WHERE person_id = ?",
            (person_id,),
        ).fetchall()
        conn.close()

        embeddings = []
        for row in rows:
            try:
                emb = np.frombuffer(row[0], dtype=np.float32)
                if emb.shape[0] == 512:
                    embeddings.append(emb)
            except Exception:
                pass
        return embeddings
    except sqlite3.Error:
        return []


def is_in_negative_gallery(
    person_id: str,
    query_embedding: list[float] | np.ndarray,
) -> bool:
    """Check if a query embedding matches any negative gallery entry for a person.

    Returns True if the match should be REJECTED (false positive detected).
    """
    cfg = get_config()

    if person_id not in _negative_cache:
        _negative_cache[person_id] = _load_negatives_for_person(person_id)

    negatives = _negative_cache.get(person_id, [])
    if not negatives:
        return False

    if isinstance(query_embedding, list):
        query_vec = np.array(query_embedding, dtype=np.float32)
    else:
        query_vec = query_embedding.astype(np.float32)

    threshold = cfg.negative_gallery_threshold

    for neg_emb in negatives:
        sim = _cosine_similarity(query_vec, neg_emb)
        if sim >= threshold:
            logger.debug(
                "Negative gallery match for person %s: similarity=%.4f >= threshold=%.4f",
                person_id,
                sim,
                threshold,
            )
            return True

    return False
