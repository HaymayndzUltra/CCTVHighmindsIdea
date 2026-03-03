"""Face detection endpoint.

Accepts a base64-encoded JPEG frame, decodes it, runs face detection,
and returns detected faces with bounding boxes, confidence, and embeddings.
"""

import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException

from models.schemas import DetectedFace, DetectRequest, DetectResponse, QualityGateResult
from services.face_detection import detect_faces
from services.quality_gate import score_face

logger = logging.getLogger("ai-sidecar.detection")

router = APIRouter(tags=["detection"])


def _decode_base64_frame(frame_base64: str) -> np.ndarray:
    """Decode a base64-encoded image to a BGR numpy array.

    Args:
        frame_base64: Base64-encoded JPEG/PNG image data.

    Returns:
        BGR numpy array suitable for OpenCV / InsightFace.

    Raises:
        ValueError: If decoding or image parsing fails.
    """
    try:
        img_bytes = base64.b64decode(frame_base64)
    except Exception as exc:
        raise ValueError(f"Invalid base64 encoding: {exc}") from exc

    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Failed to decode image — invalid image data")

    return frame


@router.post("/detect", response_model=DetectResponse)
async def detect(request: DetectRequest) -> DetectResponse:
    """Detect faces in a submitted frame.

    Expects camera_id, base64-encoded frame, and timestamp.
    Returns list of detected faces with bounding boxes and embeddings.
    """
    if not request.frame_base64:
        raise HTTPException(status_code=400, detail="frame_base64 is required")

    if not request.camera_id:
        raise HTTPException(status_code=400, detail="camera_id is required")

    try:
        frame = _decode_base64_frame(request.frame_base64)
    except ValueError as exc:
        logger.warning("Frame decode failed for camera %s: %s", request.camera_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        raw_faces = detect_faces(frame, return_raw_faces=True)
    except RuntimeError as exc:
        logger.error("Detection error for camera %s: %s", request.camera_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    faces: list[DetectedFace] = []
    rejected_count = 0

    for f in raw_faces:
        raw_face_obj = f.get("raw_face")
        quality_data = score_face(raw_face_obj, frame) if raw_face_obj is not None else {
            "yaw": 0.0, "pitch": 0.0, "blur_score": 0.0,
            "det_score": f["confidence"], "passes_gate": True,
        }

        if not quality_data["passes_gate"]:
            rejected_count += 1
            continue

        faces.append(
            DetectedFace(
                bbox=f["bbox"],
                confidence=f["confidence"],
                embedding=f["embedding"],
                quality=QualityGateResult(
                    yaw=quality_data["yaw"],
                    pitch=quality_data["pitch"],
                    blur_score=quality_data["blur_score"],
                    det_score=quality_data["det_score"],
                    passes_gate=quality_data["passes_gate"],
                ),
            )
        )

    if rejected_count:
        logger.debug(
            "Camera %s: quality gate rejected %d/%d face(s)",
            request.camera_id,
            rejected_count,
            len(raw_faces),
        )

    logger.info(
        "Camera %s: detected %d face(s) (%d passed gate) at ts=%.1f",
        request.camera_id,
        len(raw_faces),
        len(faces),
        request.timestamp,
    )
    return DetectResponse(faces=faces)
