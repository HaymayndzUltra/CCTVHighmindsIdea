"""Face recognition service.

Compares a face embedding against enrolled person embeddings using
cosine similarity. Reads enrolled embeddings from the SQLite database
via the configured db_path.
"""

import logging
import sqlite3
from typing import Any

import numpy as np

from config import get_config

logger = logging.getLogger("ai-sidecar.face_recognition")


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors.

    Returns a float in [-1, 1]. Higher means more similar.
    """
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _load_enrolled_embeddings() -> list[dict[str, Any]]:
    """Load all enrolled embeddings from the SQLite database.

    Returns a list of dicts with keys:
        - person_id: str
        - person_name: str
        - embedding: np.ndarray (512-dim)

    The embeddings are stored as raw bytes in the database. The sidecar
    receives them already decrypted from the Electron main process
    (CryptoService handles encryption/decryption on the Node.js side).

    For the sidecar's own operation, embeddings are passed as float arrays
    via the /recognize endpoint, so this function serves as a future hook
    for direct DB access if needed.
    """
    cfg = get_config()
    if not cfg.db_path:
        logger.debug("No db_path configured — embedded DB access disabled")
        return []

    try:
        conn = sqlite3.connect(cfg.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            """
            SELECT
                fe.person_id,
                p.name AS person_name,
                fe.embedding_data
            FROM face_embeddings fe
            JOIN persons p ON fe.person_id = p.id
            WHERE p.enabled = 1
            """
        )
        results: list[dict[str, Any]] = []
        for row in cursor:
            try:
                embedding = np.frombuffer(row["embedding_data"], dtype=np.float32)
                if embedding.shape[0] != 512:
                    logger.warning(
                        "Skipping embedding for person %s: dim=%d",
                        row["person_id"],
                        embedding.shape[0],
                    )
                    continue
                results.append({
                    "person_id": row["person_id"],
                    "person_name": row["person_name"],
                    "embedding": embedding,
                })
            except Exception as exc:
                logger.warning(
                    "Failed to parse embedding for person %s: %s",
                    row["person_id"],
                    exc,
                )
        conn.close()
        logger.debug("Loaded %d enrolled embeddings from DB", len(results))
        return results
    except sqlite3.Error as exc:
        logger.error("Database error loading embeddings: %s", exc)
        return []


# In-memory cache for enrolled embeddings (refreshed via reload_embeddings)
_enrolled_embeddings: list[dict[str, Any]] = []


def reload_embeddings() -> int:
    """Reload enrolled embeddings from the database into memory.

    Returns the number of embeddings loaded.
    """
    global _enrolled_embeddings
    _enrolled_embeddings = _load_enrolled_embeddings()
    logger.info("Reloaded %d enrolled embeddings", len(_enrolled_embeddings))
    return len(_enrolled_embeddings)


def set_embeddings(embeddings: list[dict[str, Any]]) -> None:
    """Set enrolled embeddings directly (used when passed from Electron).

    Mutates the list in-place so all modules that imported the reference
    see the updated data.
    """
    _enrolled_embeddings.clear()
    _enrolled_embeddings.extend(embeddings)
    logger.info("Set %d enrolled embeddings via direct injection", len(_enrolled_embeddings))


def recognize_face(
    embedding: list[float],
    threshold: float | None = None,
) -> dict[str, Any]:
    """Recognize a face by comparing its embedding against enrolled persons.

    Args:
        embedding: 512-dimensional face embedding.
        threshold: Minimum cosine similarity for a match. Uses config default if None.

    Returns:
        Dict with keys: matched, person_id, person_name, confidence.
    """
    cfg = get_config()
    if threshold is None:
        threshold = cfg.rec_threshold

    if len(embedding) != 512:
        logger.error("Invalid embedding dimension: %d. Expected 512.", len(embedding))
        return {
            "matched": False,
            "person_id": None,
            "person_name": None,
            "confidence": 0.0,
        }

    query_vec = np.array(embedding, dtype=np.float32)

    best_match: dict[str, Any] | None = None
    best_score = -1.0

    for enrolled in _enrolled_embeddings:
        score = _cosine_similarity(query_vec, enrolled["embedding"])
        if score > best_score:
            best_score = score
            best_match = enrolled

    if best_match is not None and best_score >= threshold:
        logger.debug(
            "Match: person=%s confidence=%.4f",
            best_match["person_name"],
            best_score,
        )
        return {
            "matched": True,
            "person_id": best_match["person_id"],
            "person_name": best_match["person_name"],
            "confidence": round(best_score, 4),
        }

    logger.debug("No match found (best=%.4f, threshold=%.2f)", best_score, threshold)
    return {
        "matched": False,
        "person_id": None,
        "person_name": None,
        "confidence": round(max(best_score, 0.0), 4),
    }
