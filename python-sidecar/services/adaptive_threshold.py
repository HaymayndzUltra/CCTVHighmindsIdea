"""Adaptive recognition threshold calculator.

Computes a per-person recognition threshold based on the diversity and
quantity of their enrolled face embeddings.

Logic:
  - More enrolled images with high angular spread → lower threshold (tighter cluster
    means we can be more confident with a lower similarity).
  - Fewer images or low diversity → higher threshold (be conservative).
  - Range is clamped to [adaptive_threshold_min, adaptive_threshold_max].
  - A minimum margin of adaptive_threshold_margin is enforced between the
    best match and the second-best match at recognition time.
"""

import logging
from typing import Any

import numpy as np

from config import get_config

logger = logging.getLogger("ai-sidecar.adaptive_threshold")


def _mean_pairwise_cosine_similarity(embeddings: list[np.ndarray]) -> float:
    """Compute mean pairwise cosine similarity across a list of embeddings.

    Returns a value in [-1, 1]. Higher = more similar to each other (less diverse).
    """
    if len(embeddings) < 2:
        return 1.0

    similarities: list[float] = []
    for i in range(len(embeddings)):
        for j in range(i + 1, len(embeddings)):
            norm_a = np.linalg.norm(embeddings[i])
            norm_b = np.linalg.norm(embeddings[j])
            if norm_a == 0 or norm_b == 0:
                continue
            sim = float(np.dot(embeddings[i], embeddings[j]) / (norm_a * norm_b))
            similarities.append(sim)

    return float(np.mean(similarities)) if similarities else 1.0


def compute_adaptive_threshold(
    person_embeddings: list[list[float]],
) -> float:
    """Compute a per-person adaptive recognition threshold.

    Args:
        person_embeddings: List of 512-dim float embeddings for a person.

    Returns:
        Adaptive threshold in [adaptive_threshold_min, adaptive_threshold_max].
    """
    cfg = get_config()
    min_thresh = cfg.adaptive_threshold_min
    max_thresh = cfg.adaptive_threshold_max

    if not person_embeddings:
        logger.debug("No embeddings — returning max threshold %.2f", max_thresh)
        return max_thresh

    count = len(person_embeddings)

    if count == 1:
        return max_thresh

    vecs = [np.array(e, dtype=np.float32) for e in person_embeddings]

    mean_sim = _mean_pairwise_cosine_similarity(vecs)

    diversity = 1.0 - mean_sim

    count_factor = min(1.0, (count - 1) / 4.0)

    threshold = max_thresh - (max_thresh - min_thresh) * diversity * count_factor

    threshold = float(np.clip(threshold, min_thresh, max_thresh))

    logger.debug(
        "Adaptive threshold: count=%d mean_sim=%.3f diversity=%.3f → threshold=%.3f",
        count,
        mean_sim,
        diversity,
        threshold,
    )
    return round(threshold, 4)


def check_margin(
    best_score: float,
    second_best_score: float,
) -> bool:
    """Check if the margin between the best and second-best match is sufficient.

    Args:
        best_score: Cosine similarity of best matching person.
        second_best_score: Cosine similarity of second-best matching person.

    Returns:
        True if margin >= adaptive_threshold_margin (safe to accept match).
    """
    cfg = get_config()
    margin = best_score - second_best_score
    is_safe = margin >= cfg.adaptive_threshold_margin

    if not is_safe:
        logger.debug(
            "Margin check FAILED: margin=%.4f < required=%.4f (best=%.4f, 2nd=%.4f)",
            margin,
            cfg.adaptive_threshold_margin,
            best_score,
            second_best_score,
        )

    return is_safe


_threshold_cache: dict[str, float] = {}


def get_cached_threshold(person_id: str) -> float | None:
    """Return cached adaptive threshold for a person, or None if not computed."""
    return _threshold_cache.get(person_id)


def set_cached_threshold(person_id: str, threshold: float) -> None:
    """Store computed adaptive threshold in cache."""
    _threshold_cache[person_id] = threshold


def invalidate_threshold(person_id: str) -> None:
    """Remove cached threshold (call after enrollment changes)."""
    _threshold_cache.pop(person_id, None)


def recognize_with_adaptive_threshold(
    query_embedding: list[float],
    enrolled_embeddings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Match a query embedding against enrolled persons using adaptive thresholds.

    Args:
        query_embedding: 512-dim float embedding to match.
        enrolled_embeddings: List of dicts with keys:
            person_id, person_name, embedding (np.ndarray).

    Returns:
        Dict with keys: matched, person_id, person_name, confidence,
        threshold_used, margin.
    """
    cfg = get_config()

    if not enrolled_embeddings:
        return {
            "matched": False,
            "person_id": None,
            "person_name": None,
            "confidence": 0.0,
            "threshold_used": cfg.rec_threshold,
            "margin": 0.0,
        }

    query_vec = np.array(query_embedding, dtype=np.float32)
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return {
            "matched": False,
            "person_id": None,
            "person_name": None,
            "confidence": 0.0,
            "threshold_used": cfg.rec_threshold,
            "margin": 0.0,
        }
    query_vec = query_vec / query_norm

    scores: list[tuple[float, dict[str, Any]]] = []
    for enrolled in enrolled_embeddings:
        emb = enrolled["embedding"]
        if isinstance(emb, np.ndarray):
            vec = emb
        else:
            vec = np.array(emb, dtype=np.float32)

        norm = np.linalg.norm(vec)
        if norm == 0:
            continue
        vec = vec / norm

        score = float(np.dot(query_vec, vec))
        scores.append((score, enrolled))

    if not scores:
        return {
            "matched": False,
            "person_id": None,
            "person_name": None,
            "confidence": 0.0,
            "threshold_used": cfg.rec_threshold,
            "margin": 0.0,
        }

    scores.sort(key=lambda x: x[0], reverse=True)
    best_score, best_match = scores[0]
    second_best_score = scores[1][0] if len(scores) > 1 else 0.0

    person_id = best_match["person_id"]
    threshold = get_cached_threshold(person_id)
    if threshold is None:
        threshold = cfg.rec_threshold

    margin = best_score - second_best_score

    if (
        cfg.adaptive_threshold_enabled
        and best_score >= threshold
        and check_margin(best_score, second_best_score)
    ):
        matched = True
    elif not cfg.adaptive_threshold_enabled and best_score >= cfg.rec_threshold:
        matched = True
    else:
        matched = False
        person_id = None

    return {
        "matched": matched,
        "person_id": person_id if matched else None,
        "person_name": best_match["person_name"] if matched else None,
        "confidence": round(best_score, 4),
        "threshold_used": round(threshold, 4),
        "margin": round(margin, 4),
    }
