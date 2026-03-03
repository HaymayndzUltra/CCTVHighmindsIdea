"""Auto-enrollment service.

When a recognized person passes quality and similarity thresholds, automatically
stores their current frame crop as a new embedding with source_type='auto_enroll'.
Auto-enrolled embeddings expire after 30 days to prevent database bloat.

Criteria for auto-enrollment:
  - match similarity >= auto_enroll_min_similarity (default 0.55)
  - quality_score >= auto_enroll_min_quality (default 80.0)
  - auto_enroll_count < auto_enroll_max_count (default 5) per person
  - person has auto_enroll_enabled = True in the database
"""

import base64
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

import cv2
import numpy as np

from config import get_config
from services.face_detection import detect_faces
from services.model_loader import get_face_app

logger = logging.getLogger("ai-sidecar.auto_enrollment")


def _decode_crop(crop_base64: str) -> np.ndarray | None:
    """Decode base64 crop to BGR numpy array."""
    try:
        img_bytes = base64.b64decode(crop_base64)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        return frame
    except Exception as exc:
        logger.warning("Failed to decode crop: %s", exc)
        return None


def _get_auto_enroll_count(conn: sqlite3.Connection, person_id: str) -> int:
    """Count existing auto-enrolled (non-expired) embeddings for a person."""
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        row = conn.execute(
            """
            SELECT COUNT(*) FROM face_embeddings
            WHERE person_id = ?
              AND source_type = 'auto_enroll'
              AND (auto_enroll_expires_at IS NULL OR auto_enroll_expires_at > ?)
            """,
            (person_id, now_iso),
        ).fetchone()
        return int(row[0]) if row else 0
    except sqlite3.Error as exc:
        logger.error("DB error counting auto-enroll embeddings: %s", exc)
        return 0


def _person_has_auto_enroll_enabled(conn: sqlite3.Connection, person_id: str) -> bool:
    """Check if the person has auto_enroll_enabled = 1 in the database."""
    try:
        row = conn.execute(
            "SELECT auto_enroll_enabled FROM persons WHERE id = ?",
            (person_id,),
        ).fetchone()
        if row is None:
            return True
        return bool(row[0])
    except sqlite3.Error:
        return True


def _store_auto_enrolled_embedding(
    conn: sqlite3.Connection,
    person_id: str,
    embedding: list[float],
    person_name: str,
) -> bool:
    """Store an auto-enrolled embedding in the database.

    Uses 30-day expiry. The embedding is stored as raw float32 bytes.
    """
    try:
        import uuid
        embedding_id = str(uuid.uuid4())
        expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        embedding_bytes = np.array(embedding, dtype=np.float32).tobytes()

        conn.execute(
            """
            INSERT INTO face_embeddings
                (id, person_id, embedding_data, source_type, quality_score,
                 is_auto_enrolled, auto_enroll_expires_at)
            VALUES (?, ?, ?, 'auto_enroll', NULL, 1, ?)
            """,
            (embedding_id, person_id, embedding_bytes, expires_at),
        )
        conn.execute(
            "UPDATE persons SET auto_enroll_count = auto_enroll_count + 1 WHERE id = ?",
            (person_id,),
        )
        conn.commit()
        logger.info(
            "Auto-enrolled embedding for person %s (%s), expires %s",
            person_id,
            person_name,
            expires_at,
        )
        return True
    except Exception as exc:
        logger.error("Failed to store auto-enrolled embedding: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def try_auto_enroll(
    person_id: str,
    person_name: str,
    crop_base64: str,
    quality_score: float,
    similarity: float,
) -> dict[str, Any]:
    """Attempt to auto-enroll a new embedding for a recognized person.

    Args:
        person_id: Person's ID in the database.
        person_name: Person's display name.
        crop_base64: Base64-encoded face crop image.
        quality_score: Quality score from QualityGateResult (0-100).
        similarity: Cosine similarity from recognition.

    Returns:
        Dict with keys: success (bool), auto_enrolled_count (int), reason (str).
    """
    cfg = get_config()

    if not cfg.auto_enroll_enabled:
        return {"success": False, "auto_enrolled_count": 0, "reason": "auto_enroll disabled"}

    if similarity < cfg.auto_enroll_min_similarity:
        return {
            "success": False,
            "auto_enrolled_count": 0,
            "reason": f"similarity {similarity:.3f} < min {cfg.auto_enroll_min_similarity}",
        }

    if quality_score < cfg.auto_enroll_min_quality:
        return {
            "success": False,
            "auto_enrolled_count": 0,
            "reason": f"quality {quality_score:.1f} < min {cfg.auto_enroll_min_quality}",
        }

    if not cfg.db_path:
        logger.debug("Auto-enroll skipped — no db_path configured")
        return {"success": False, "auto_enrolled_count": 0, "reason": "no db_path"}

    crop = _decode_crop(crop_base64)
    if crop is None:
        return {"success": False, "auto_enrolled_count": 0, "reason": "invalid crop"}

    face_app = get_face_app()
    if face_app is None:
        return {"success": False, "auto_enrolled_count": 0, "reason": "model not loaded"}

    try:
        faces = face_app.get(crop)
    except Exception as exc:
        logger.warning("Failed to extract embedding from crop: %s", exc)
        return {"success": False, "auto_enrolled_count": 0, "reason": f"embedding extraction failed: {exc}"}

    if not faces or faces[0].normed_embedding is None:
        return {"success": False, "auto_enrolled_count": 0, "reason": "no face in crop"}

    embedding = faces[0].normed_embedding.tolist()
    if len(embedding) != 512:
        return {"success": False, "auto_enrolled_count": 0, "reason": "invalid embedding dimension"}

    try:
        conn = sqlite3.connect(cfg.db_path)
    except sqlite3.Error as exc:
        logger.error("Cannot connect to DB for auto-enroll: %s", exc)
        return {"success": False, "auto_enrolled_count": 0, "reason": f"db connect failed: {exc}"}

    try:
        if not _person_has_auto_enroll_enabled(conn, person_id):
            return {"success": False, "auto_enrolled_count": 0, "reason": "auto_enroll disabled for person"}

        current_count = _get_auto_enroll_count(conn, person_id)
        if current_count >= cfg.auto_enroll_max_count:
            return {
                "success": False,
                "auto_enrolled_count": current_count,
                "reason": f"max auto-enroll count reached ({current_count}/{cfg.auto_enroll_max_count})",
            }

        ok = _store_auto_enrolled_embedding(conn, person_id, embedding, person_name)
        new_count = current_count + 1 if ok else current_count
        return {"success": ok, "auto_enrolled_count": new_count, "reason": "" if ok else "db insert failed"}

    finally:
        conn.close()


def purge_expired_auto_enrollments() -> int:
    """Delete expired auto-enrolled embeddings from the database.

    Returns the number of embeddings deleted.
    """
    cfg = get_config()
    if not cfg.db_path:
        return 0

    try:
        conn = sqlite3.connect(cfg.db_path)
        now_iso = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            """
            DELETE FROM face_embeddings
            WHERE source_type = 'auto_enroll'
              AND auto_enroll_expires_at IS NOT NULL
              AND auto_enroll_expires_at < ?
            """,
            (now_iso,),
        )
        deleted = cursor.rowcount
        conn.commit()
        conn.close()

        if deleted:
            logger.info("Purged %d expired auto-enrolled embeddings", deleted)
        return deleted

    except sqlite3.Error as exc:
        logger.error("Failed to purge expired auto-enrollments: %s", exc)
        return 0
