"""YOLO object detection service.

Loads YOLOv8s with CUDA execution provider via ultralytics.
Provides detect_objects() for frame-level person/vehicle/animal detection.
Weights are cached in python-sidecar/models/yolov8s.pt.
"""

import logging
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger("ai-sidecar.object_detection")

_yolo_model: Any | None = None
_yolo_loaded: bool = False

MODELS_DIR = Path(__file__).parent.parent / "models"

DEFAULT_CLASSES: list[int] = [0, 1, 2, 3, 5, 7, 15, 16]
CLASS_NAMES: dict[int, str] = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    15: "cat",
    16: "dog",
}


def load_yolo_model(gpu_enabled: bool = True) -> bool:
    """Load YOLOv8s model. Downloads weights if not present.

    Args:
        gpu_enabled: Whether to use CUDA device.

    Returns:
        True if loaded successfully, False otherwise.
    """
    global _yolo_model, _yolo_loaded

    try:
        from ultralytics import YOLO

        weights_path = MODELS_DIR / "yolov8s.pt"
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        if not weights_path.exists():
            logger.info("yolov8s.pt not found — downloading to %s", weights_path)
            tmp_model = YOLO("yolov8s.pt")
            src = Path(tmp_model.ckpt_path) if hasattr(tmp_model, "ckpt_path") else None
            if src and src.exists() and src != weights_path:
                import shutil
                shutil.copy2(str(src), str(weights_path))
                logger.info("Copied yolov8s.pt to models dir")

        model_path = str(weights_path) if weights_path.exists() else "yolov8s.pt"
        _yolo_model = YOLO(model_path)

        device = "cuda:0" if gpu_enabled else "cpu"
        _yolo_model.to(device)

        logger.info(
            "YOLOv8s loaded — device=%s | classes=%d",
            device,
            len(_yolo_model.names),
        )
        _yolo_loaded = True
        return True

    except Exception as exc:
        logger.error("Failed to load YOLOv8s: %s", exc)
        _yolo_loaded = False
        return False


def is_yolo_loaded() -> bool:
    """Check whether YOLOv8s model is loaded."""
    return _yolo_loaded


def detect_objects(
    frame: np.ndarray,
    confidence_threshold: float = 0.4,
    allowed_classes: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Run YOLOv8s inference on a BGR frame.

    Args:
        frame: BGR numpy array (H x W x 3) from OpenCV.
        confidence_threshold: Minimum detection confidence.
        allowed_classes: COCO class IDs to keep. None = DEFAULT_CLASSES.

    Returns:
        List of dicts with keys:
            - object_class: str (e.g. "person")
            - bbox: [x1, y1, x2, y2] as floats
            - confidence: float

    Raises:
        RuntimeError: If YOLO model is not loaded.
    """
    if not _yolo_loaded or _yolo_model is None:
        raise RuntimeError("YOLOv8s model is not loaded")

    if frame is None or frame.size == 0:
        logger.warning("Empty frame received — skipping YOLO detection")
        return []

    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"Invalid frame shape: {frame.shape}. Expected (H, W, 3).")

    filter_classes = allowed_classes if allowed_classes is not None else DEFAULT_CLASSES

    try:
        results = _yolo_model.predict(
            source=frame,
            conf=confidence_threshold,
            classes=filter_classes if filter_classes else None,
            verbose=False,
        )
    except Exception as exc:
        logger.error("YOLOv8s inference failed: %s", exc)
        raise RuntimeError(f"Object detection failed: {exc}") from exc

    detections: list[dict[str, Any]] = []
    if not results or len(results) == 0:
        return detections

    result = results[0]
    if result.boxes is None or len(result.boxes) == 0:
        return detections

    for box in result.boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        xyxy = box.xyxy[0].tolist()

        class_name = _yolo_model.names.get(cls_id, str(cls_id))

        detections.append({
            "object_class": class_name,
            "bbox": [round(v, 2) for v in xyxy],
            "confidence": round(conf, 4),
            "class_id": cls_id,
        })

    logger.debug("Detected %d object(s) in frame", len(detections))
    return detections


def get_person_crops(
    frame: np.ndarray,
    detections: list[dict[str, Any]],
    min_height_px: int = 64,
) -> list[dict[str, Any]]:
    """Crop person bounding boxes from a frame for face detection.

    Args:
        frame: BGR numpy array.
        detections: Output of detect_objects().
        min_height_px: Minimum crop height to include.

    Returns:
        List of dicts with keys:
            - crop: BGR numpy array
            - bbox: [x1, y1, x2, y2]
            - confidence: float
    """
    if frame is None or frame.size == 0:
        return []

    h, w = frame.shape[:2]
    crops: list[dict[str, Any]] = []

    for det in detections:
        if det.get("object_class") != "person":
            continue

        bbox = det["bbox"]
        x1 = max(0, int(bbox[0]))
        y1 = max(0, int(bbox[1]))
        x2 = min(w, int(bbox[2]))
        y2 = min(h, int(bbox[3]))

        crop_h = y2 - y1
        crop_w = x2 - x1

        if crop_h < min_height_px or crop_w < 20:
            continue

        crop = frame[y1:y2, x1:x2].copy()
        crops.append({
            "crop": crop,
            "bbox": bbox,
            "confidence": det["confidence"],
        })

    return crops
