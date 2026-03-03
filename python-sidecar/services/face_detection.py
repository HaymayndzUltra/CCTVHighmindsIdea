"""Face detection service using InsightFace.

Processes image frames and returns detected faces with bounding boxes,
confidence scores, and 512-dimensional embeddings.
"""

import logging
from typing import Any

import cv2
import numpy as np

from config import get_config
from services.model_loader import get_face_app

logger = logging.getLogger("ai-sidecar.face_detection")


def _apply_clahe(frame: np.ndarray) -> np.ndarray:
    """Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to a BGR frame.

    Converts to YCrCb, applies CLAHE to the Y (luminance) channel only,
    then converts back to BGR to preserve color accuracy.

    Args:
        frame: BGR numpy array.

    Returns:
        CLAHE-enhanced BGR numpy array.
    """
    try:
        ycrcb = cv2.cvtColor(frame, cv2.COLOR_BGR2YCrCb)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        ycrcb[:, :, 0] = clahe.apply(ycrcb[:, :, 0])
        return cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)
    except Exception as exc:
        logger.warning("CLAHE failed — returning original frame: %s", exc)
        return frame


def _should_apply_clahe(frame: np.ndarray) -> bool:
    """Return True if the frame's mean luminance is below the configured threshold."""
    cfg = get_config()
    if not cfg.night_enhance_enabled:
        return False
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(np.mean(gray)) < cfg.night_luminance_threshold
    except Exception:
        return False


def detect_faces(
    frame: np.ndarray,
    return_raw_faces: bool = False,
) -> list[dict[str, Any]]:
    """Detect faces in a given frame using InsightFace.

    Applies CLAHE night enhancement automatically when luminance is low.

    Args:
        frame: BGR numpy array (H x W x 3) from OpenCV.
        return_raw_faces: If True, include the raw InsightFace Face object
            under key 'raw_face' for downstream quality gate scoring.

    Returns:
        List of dicts, each containing:
            - bbox: [x1, y1, x2, y2] as floats
            - confidence: detection confidence score
            - embedding: 512-dim float list
            - clahe_applied: bool (True if CLAHE was used)
            - raw_face: InsightFace Face object (only if return_raw_faces=True)

    Raises:
        RuntimeError: If the InsightFace model is not loaded.
    """
    face_app = get_face_app()
    if face_app is None:
        logger.error("detect_faces called but model is not loaded")
        raise RuntimeError("InsightFace model is not loaded. Cannot detect faces.")

    if frame is None or frame.size == 0:
        logger.warning("Empty frame received — skipping detection")
        return []

    if frame.ndim != 3 or frame.shape[2] != 3:
        logger.error(
            "Invalid frame shape: %s. Expected (H, W, 3).", frame.shape
        )
        raise ValueError(f"Invalid frame dimensions: {frame.shape}. Expected (H, W, 3).")

    clahe_applied = False
    processing_frame = frame

    if _should_apply_clahe(frame):
        processing_frame = _apply_clahe(frame)
        clahe_applied = True
        logger.debug("CLAHE applied (low luminance frame)")

    try:
        faces = face_app.get(processing_frame)
    except Exception as exc:
        logger.error("InsightFace detection failed: %s", exc)
        raise RuntimeError(f"Face detection failed: {exc}") from exc

    results: list[dict[str, Any]] = []
    for face in faces:
        bbox = face.bbox.tolist()
        confidence = float(face.det_score)
        embedding = face.normed_embedding.tolist() if face.normed_embedding is not None else []

        if len(embedding) != 512:
            logger.warning(
                "Unexpected embedding dimension %d for face at %s — skipping",
                len(embedding),
                bbox,
            )
            continue

        entry: dict[str, Any] = {
            "bbox": [round(v, 2) for v in bbox],
            "confidence": round(confidence, 4),
            "embedding": embedding,
            "clahe_applied": clahe_applied,
        }

        if return_raw_faces:
            entry["raw_face"] = face

        results.append(entry)

    logger.debug("Detected %d face(s) in frame (clahe=%s)", len(results), clahe_applied)
    return results
