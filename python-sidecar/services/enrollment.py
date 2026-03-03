"""Face enrollment service.

Processes images for person enrollment: detects exactly one face per image,
extracts 512-dim embeddings, and returns them for storage by the Electron
main process (CryptoService handles encryption on the Node.js side).
"""

import base64
import logging
from typing import Any

import cv2
import numpy as np

from services.face_detection import detect_faces

logger = logging.getLogger("ai-sidecar.enrollment")


def _decode_base64_image(image_b64: str) -> np.ndarray:
    """Decode a base64-encoded image string to a BGR numpy array.

    Args:
        image_b64: Base64-encoded JPEG/PNG image data.

    Returns:
        BGR numpy array (H x W x 3).

    Raises:
        ValueError: If the image cannot be decoded.
    """
    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception as exc:
        raise ValueError(f"Invalid base64 encoding: {exc}") from exc

    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None or frame.size == 0:
        raise ValueError("Failed to decode image — cv2.imdecode returned None")

    return frame


def enroll_person(
    person_id: str,
    images_base64: list[str],
) -> dict[str, Any]:
    """Process enrollment images and extract face embeddings.

    For each image:
    1. Decode base64 → BGR numpy array
    2. Detect faces using InsightFace
    3. Validate exactly 1 face is present
    4. Extract 512-dim embedding

    Args:
        person_id: Unique identifier for the person being enrolled.
        images_base64: List of base64-encoded image strings.

    Returns:
        Dict with keys:
            - success: bool
            - embeddings: list of 512-dim float lists (one per valid image)
            - errors: list of per-image error messages (empty string if OK)
    """
    if not person_id:
        logger.error("enroll_person called with empty person_id")
        return {"success": False, "embeddings": [], "errors": ["person_id is required"]}

    if not images_base64:
        logger.error("enroll_person called with no images")
        return {"success": False, "embeddings": [], "errors": ["No images provided"]}

    embeddings: list[list[float]] = []
    errors: list[str] = []

    for idx, img_b64 in enumerate(images_base64):
        image_label = f"image {idx + 1}/{len(images_base64)}"

        try:
            frame = _decode_base64_image(img_b64)
        except ValueError as exc:
            error_msg = f"Failed to decode {image_label}: {exc}"
            logger.warning(error_msg)
            errors.append(error_msg)
            continue

        try:
            faces = detect_faces(frame)
        except RuntimeError as exc:
            error_msg = f"Detection failed for {image_label}: {exc}"
            logger.error(error_msg)
            errors.append(error_msg)
            continue

        if len(faces) == 0:
            error_msg = f"No face detected in {image_label}"
            logger.warning(error_msg)
            errors.append(error_msg)
            continue

        if len(faces) > 1:
            error_msg = (
                f"Multiple faces ({len(faces)}) detected in {image_label}. "
                "Please provide an image with exactly one face."
            )
            logger.warning(error_msg)
            errors.append(error_msg)
            continue

        embedding = faces[0]["embedding"]
        if len(embedding) != 512:
            error_msg = f"Invalid embedding dimension ({len(embedding)}) in {image_label}"
            logger.error(error_msg)
            errors.append(error_msg)
            continue

        embeddings.append(embedding)
        errors.append("")
        logger.debug(
            "Enrolled face from %s for person %s (confidence=%.4f)",
            image_label,
            person_id,
            faces[0]["confidence"],
        )

    is_success = len(embeddings) > 0
    logger.info(
        "Enrollment for person %s: %d/%d images successful",
        person_id,
        len(embeddings),
        len(images_base64),
    )

    return {
        "success": is_success,
        "embeddings": embeddings,
        "errors": [e for e in errors if e],
    }
