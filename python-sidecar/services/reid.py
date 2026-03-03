"""Person Re-Identification (Re-ID) service using OSNet-AIN.

Extracts 256-dimensional body appearance embeddings from person crops
for cross-camera matching. When the same person appears on different
cameras (even without face visibility), body Re-ID links detections
via cosine similarity against a per-camera gallery.

If OSNet-AIN ONNX model is available, uses CUDA-accelerated inference.
Falls back to a color histogram descriptor when model is unavailable.
"""

import logging
import os
import time
from collections import defaultdict
from threading import Lock
from typing import Any, Optional

import cv2
import numpy as np

logger = logging.getLogger("ai-sidecar.reid")

_model: Any = None
_model_loaded: bool = False
_use_heuristic: bool = False
_embedding_dim: int = 256

# In-memory gallery: camera_id -> list of {track_id, embedding, global_person_id, person_id, timestamp}
_gallery: dict[str, list[dict]] = defaultdict(list)
_gallery_lock = Lock()

# TTL for gallery entries in seconds (configurable, default 5 minutes)
_gallery_ttl_sec: int = 300

# Match threshold for cosine similarity
_match_threshold: float = 0.55

# Global person ID counter (incremented on new cross-camera appearances)
_next_global_id: int = 1
_global_id_lock = Lock()


def load_reid_model(gpu_enabled: bool = True) -> bool:
    """Load the OSNet-AIN ONNX model if available, else enable heuristic fallback.

    Args:
        gpu_enabled: Whether to attempt CUDA acceleration.

    Returns:
        True if Re-ID is available (model or heuristic), False on total failure.
    """
    global _model, _model_loaded, _use_heuristic

    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    model_path = os.path.join(models_dir, "osnet_ain_x1_0.onnx")

    if os.path.exists(model_path):
        try:
            import onnxruntime as ort

            providers = (
                ["CUDAExecutionProvider", "CPUExecutionProvider"]
                if gpu_enabled
                else ["CPUExecutionProvider"]
            )
            _model = ort.InferenceSession(model_path, providers=providers)
            _model_loaded = True
            _use_heuristic = False
            logger.info(
                "Re-ID model loaded: %s (providers: %s)",
                model_path,
                _model.get_providers(),
            )
            return True
        except Exception as e:
            logger.error("Failed to load Re-ID ONNX model: %s", e)
            _use_heuristic = True
            _model_loaded = True
            logger.info("Falling back to heuristic Re-ID (color histogram)")
            return True
    else:
        logger.warning(
            "Re-ID ONNX model not found at %s — using heuristic fallback",
            model_path,
        )
        _use_heuristic = True
        _model_loaded = True
        return True


def is_loaded() -> bool:
    """Check if Re-ID is available (model or heuristic)."""
    return _model_loaded


def configure(gallery_ttl_sec: int | None = None, match_threshold: float | None = None) -> None:
    """Update Re-ID configuration at runtime.

    Args:
        gallery_ttl_sec: TTL for gallery entries in seconds.
        match_threshold: Cosine similarity threshold for matching.
    """
    global _gallery_ttl_sec, _match_threshold
    if gallery_ttl_sec is not None:
        _gallery_ttl_sec = gallery_ttl_sec
    if match_threshold is not None:
        _match_threshold = match_threshold


def _preprocess_crop(crop: np.ndarray) -> np.ndarray:
    """Preprocess a person crop for OSNet-AIN inference.

    Resizes to 256x128 (height x width), normalizes to ImageNet stats,
    and converts to NCHW float32 tensor.
    """
    if crop is None or crop.size == 0:
        raise ValueError("Empty crop provided")

    # OSNet expects 256x128 (HxW)
    resized = cv2.resize(crop, (128, 256))
    if len(resized.shape) == 2:
        resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)

    # Convert BGR to RGB
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    # Normalize with ImageNet mean/std
    blob = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    blob = (blob - mean) / std

    # HWC -> CHW -> NCHW
    blob = np.transpose(blob, (2, 0, 1))
    blob = np.expand_dims(blob, axis=0)
    return blob


def _onnx_extract(crop: np.ndarray) -> np.ndarray:
    """Extract body embedding using ONNX model."""
    if _model is None:
        raise RuntimeError("Re-ID model not loaded")

    blob = _preprocess_crop(crop)
    input_name = _model.get_inputs()[0].name
    outputs = _model.run(None, {input_name: blob})

    # Output is a [1, embedding_dim] tensor
    embedding = outputs[0][0]

    # L2-normalize for cosine similarity
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding.astype(np.float32)


def _heuristic_extract(crop: np.ndarray) -> np.ndarray:
    """Extract a color histogram descriptor as fallback Re-ID embedding.

    Builds a 256-dimensional descriptor from HSV color histograms
    of upper and lower body regions for basic appearance matching.
    """
    if crop is None or crop.size == 0:
        return np.zeros(_embedding_dim, dtype=np.float32)

    h, w = crop.shape[:2]
    if len(crop.shape) == 2:
        crop = cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

    # Split into upper (torso) and lower (legs) body
    mid = h // 2
    upper = hsv[:mid, :, :]
    lower = hsv[mid:, :, :]

    features = []
    for region in [upper, lower]:
        # H channel: 64 bins
        h_hist = cv2.calcHist([region], [0], None, [64], [0, 180])
        # S channel: 32 bins
        s_hist = cv2.calcHist([region], [1], None, [32], [0, 256])
        # V channel: 32 bins
        v_hist = cv2.calcHist([region], [2], None, [32], [0, 256])

        features.extend([h_hist.flatten(), s_hist.flatten(), v_hist.flatten()])

    # Concatenate: (64+32+32) * 2 = 256 dimensions
    embedding = np.concatenate(features)

    # L2-normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding.astype(np.float32)


def extract_embedding(person_crop: np.ndarray) -> np.ndarray:
    """Extract a body appearance embedding from a person crop.

    Args:
        person_crop: BGR image of the detected person (numpy array).

    Returns:
        L2-normalized float32 embedding of shape (256,) or (embedding_dim,).
    """
    if person_crop is None or person_crop.size == 0:
        return np.zeros(_embedding_dim, dtype=np.float32)

    if not _model_loaded:
        load_reid_model()

    if _use_heuristic:
        return _heuristic_extract(person_crop)
    else:
        try:
            return _onnx_extract(person_crop)
        except Exception as e:
            logger.error("ONNX Re-ID extraction failed: %s — using heuristic", e)
            return _heuristic_extract(person_crop)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two L2-normalized embeddings."""
    return float(np.dot(a, b))


def _generate_global_person_id() -> str:
    """Generate a unique global person ID for cross-camera tracking."""
    global _next_global_id
    with _global_id_lock:
        gid = f"GP-{_next_global_id:06d}"
        _next_global_id += 1
    return gid


def add_to_gallery(
    camera_id: str,
    track_id: int,
    embedding: np.ndarray,
    global_person_id: str | None = None,
    person_id: str | None = None,
    timestamp: float | None = None,
) -> str:
    """Add or update a track's body embedding in the gallery.

    Args:
        camera_id: Camera that observed this track.
        track_id: Tracker-assigned ID.
        embedding: L2-normalized body embedding.
        global_person_id: Existing global person ID if already assigned.
        person_id: Known person ID from face recognition (if available).
        timestamp: Detection timestamp (defaults to current time).

    Returns:
        The global_person_id assigned to this entry.
    """
    if timestamp is None:
        timestamp = time.time()

    if global_person_id is None:
        global_person_id = _generate_global_person_id()

    entry = {
        "track_id": track_id,
        "embedding": embedding,
        "global_person_id": global_person_id,
        "person_id": person_id,
        "timestamp": timestamp,
        "camera_id": camera_id,
    }

    with _gallery_lock:
        # Update existing entry for same camera+track, or append
        cam_gallery = _gallery[camera_id]
        updated = False
        for i, existing in enumerate(cam_gallery):
            if existing["track_id"] == track_id:
                cam_gallery[i] = entry
                updated = True
                break
        if not updated:
            cam_gallery.append(entry)

    return global_person_id


def match_cross_camera(
    source_camera_id: str,
    embedding: np.ndarray,
    exclude_track_id: int | None = None,
    threshold: float | None = None,
) -> dict:
    """Match an embedding against the gallery from OTHER cameras.

    Args:
        source_camera_id: Camera where the new track appeared (excluded from search).
        embedding: L2-normalized body embedding to match.
        exclude_track_id: Track ID to exclude from matching (optional).
        threshold: Cosine similarity threshold (defaults to configured value).

    Returns:
        dict with keys: matched (bool), global_person_id (str|None),
        person_id (str|None), similarity (float), source_camera (str|None).
    """
    if threshold is None:
        threshold = _match_threshold

    now = time.time()
    best_match: dict = {
        "matched": False,
        "global_person_id": None,
        "person_id": None,
        "similarity": 0.0,
        "source_camera": None,
    }

    with _gallery_lock:
        for cam_id, entries in _gallery.items():
            if cam_id == source_camera_id:
                continue

            for entry in entries:
                # Skip expired entries
                if now - entry["timestamp"] > _gallery_ttl_sec:
                    continue

                # Skip same track if specified
                if exclude_track_id is not None and entry["track_id"] == exclude_track_id:
                    continue

                sim = _cosine_similarity(embedding, entry["embedding"])
                if sim > best_match["similarity"] and sim >= threshold:
                    best_match = {
                        "matched": True,
                        "global_person_id": entry["global_person_id"],
                        "person_id": entry.get("person_id"),
                        "similarity": round(sim, 4),
                        "source_camera": entry["camera_id"],
                    }

    return best_match


def cleanup_expired() -> int:
    """Remove expired gallery entries.

    Returns:
        Number of entries removed.
    """
    now = time.time()
    removed = 0

    with _gallery_lock:
        for cam_id in list(_gallery.keys()):
            before = len(_gallery[cam_id])
            _gallery[cam_id] = [
                e for e in _gallery[cam_id]
                if now - e["timestamp"] <= _gallery_ttl_sec
            ]
            removed += before - len(_gallery[cam_id])

            if not _gallery[cam_id]:
                del _gallery[cam_id]

    if removed > 0:
        logger.debug("Cleaned up %d expired Re-ID gallery entries", removed)
    return removed


def get_gallery_stats() -> dict:
    """Get current gallery statistics.

    Returns:
        dict with total_entries, cameras, per_camera counts.
    """
    with _gallery_lock:
        per_camera = {cam: len(entries) for cam, entries in _gallery.items()}
        total = sum(per_camera.values())

    return {
        "total_entries": total,
        "cameras": len(per_camera),
        "per_camera": per_camera,
    }


def clear_gallery() -> None:
    """Clear the entire Re-ID gallery."""
    with _gallery_lock:
        _gallery.clear()
    logger.info("Re-ID gallery cleared")


def extract_clothing_colors(person_crop: np.ndarray) -> dict:
    """Extract dominant clothing colors from a person crop.

    Analyzes upper (torso) and lower (legs) body regions separately
    using HSV histograms to identify dominant colors.

    Args:
        person_crop: BGR image of the detected person.

    Returns:
        dict with upper_color_hsv, lower_color_hsv, and descriptors.
    """
    if person_crop is None or person_crop.size == 0:
        return {"upper_color_hsv": [0, 0, 0], "lower_color_hsv": [0, 0, 0]}

    h, w = person_crop.shape[:2]
    if len(person_crop.shape) == 2:
        person_crop = cv2.cvtColor(person_crop, cv2.COLOR_GRAY2BGR)

    hsv = cv2.cvtColor(person_crop, cv2.COLOR_BGR2HSV)

    mid = h // 2
    upper = hsv[:mid, :, :]
    lower = hsv[mid:, :, :]

    def dominant_color(region: np.ndarray) -> list[int]:
        """Find the dominant HSV color in a region."""
        pixels = region.reshape(-1, 3)
        # Use k-means with k=1 for dominant color
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
        try:
            _, _, centers = cv2.kmeans(
                pixels.astype(np.float32), 1, None, criteria, 3, cv2.KMEANS_PP_CENTERS
            )
            return [int(c) for c in centers[0]]
        except Exception:
            return [int(np.median(pixels[:, i])) for i in range(3)]

    return {
        "upper_color_hsv": dominant_color(upper),
        "lower_color_hsv": dominant_color(lower),
    }


def estimate_height(bbox: list[float], frame_height: int) -> float | None:
    """Estimate relative height from bounding box aspect ratio.

    This is a rough estimate without camera calibration.

    Args:
        bbox: [x1, y1, x2, y2] bounding box.
        frame_height: Height of the source frame in pixels.

    Returns:
        Relative height ratio (0.0-1.0) or None if bbox is invalid.
    """
    if len(bbox) < 4 or frame_height <= 0:
        return None

    person_height_px = abs(bbox[3] - bbox[1])
    if person_height_px <= 0:
        return None

    return round(person_height_px / frame_height, 4)
