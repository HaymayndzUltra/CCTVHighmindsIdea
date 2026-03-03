"""Object detection endpoint — YOLO + ByteTrack.

POST /detect_objects  — run YOLOv8s on a frame, update ByteTrack, return tracked objects.
GET  /track_state     — return current tracking state for a camera.
"""

import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Query

from models.schemas import (
    DetectObjectsRequest,
    DetectObjectsResponse,
    DetectedObject,
    TrackPoint,
    TrackState,
    TrackStateResponse,
)
from services.object_detection import detect_objects, is_yolo_loaded
from services.tracker import tracker_service

logger = logging.getLogger("ai-sidecar.object_detection_router")

router = APIRouter(tags=["object-detection"])


def _decode_base64_frame(frame_base64: str) -> np.ndarray:
    """Decode base64-encoded image to BGR numpy array.

    Raises:
        ValueError: If decoding fails.
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


@router.post("/detect_objects", response_model=DetectObjectsResponse)
async def detect_objects_endpoint(
    request: DetectObjectsRequest,
) -> DetectObjectsResponse:
    """Run YOLO detection + ByteTrack on a frame.

    Accepts camera_id, base64-encoded frame, and timestamp.
    Returns tracked objects with persistent track_id assigned.
    """
    if not request.camera_id:
        raise HTTPException(status_code=400, detail="camera_id is required")
    if not request.frame_base64:
        raise HTTPException(status_code=400, detail="frame_base64 is required")

    if not is_yolo_loaded():
        raise HTTPException(
            status_code=503,
            detail="YOLOv8s model not loaded — check startup logs",
        )

    try:
        frame = _decode_base64_frame(request.frame_base64)
    except ValueError as exc:
        logger.warning("Frame decode failed for camera %s: %s", request.camera_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        raw_detections = detect_objects(frame)
    except RuntimeError as exc:
        logger.error("YOLO detection error for camera %s: %s", request.camera_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    tracked = tracker_service.update(
        camera_id=request.camera_id,
        detections=raw_detections,
        timestamp=request.timestamp,
    )

    objects: list[DetectedObject] = []
    for t in tracked:
        objects.append(
            DetectedObject(
                object_class=t["object_class"],
                bbox=t["bbox"],
                confidence=t["confidence"],
                track_id=t["track_id"],
            )
        )

    logger.info(
        "Camera %s: %d raw detections → %d tracked objects at ts=%.1f",
        request.camera_id,
        len(raw_detections),
        len(objects),
        request.timestamp,
    )

    return DetectObjectsResponse(objects=objects)


@router.get("/track_state", response_model=TrackStateResponse)
async def get_track_state(
    camera_id: str = Query(..., description="Camera ID to query"),
) -> TrackStateResponse:
    """Return current tracking state for a camera.

    Returns all confirmed active tracks with trail history.
    """
    if not camera_id:
        raise HTTPException(status_code=400, detail="camera_id is required")

    state = tracker_service.get_state(camera_id)

    tracks: list[TrackState] = []
    for t in state:
        trail_points = [
            TrackPoint(x=p["x"], y=p["y"], timestamp=p["timestamp"])
            for p in t.get("trail", [])
        ]
        tracks.append(
            TrackState(
                track_id=t["track_id"],
                object_class=t["object_class"],
                bbox=t["bbox"],
                trail=trail_points,
            )
        )

    return TrackStateResponse(camera_id=camera_id, tracks=tracks)
