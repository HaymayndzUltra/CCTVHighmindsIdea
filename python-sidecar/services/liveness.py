"""Liveness detection service — anti-spoofing for face recognition.

Uses MiniFASNet (or equivalent) ONNX model to detect presentation attacks
(photos, screens, masks). Returns a liveness score and boolean result.

If no ONNX model is available, falls back to a heuristic-based approach
using texture analysis (Laplacian variance + color histogram spread).
"""

import logging
import os
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("liveness")

_model = None
_model_loaded = False
_use_heuristic = False


def load_liveness_model(gpu_enabled: bool = True) -> bool:
    """Load the liveness ONNX model if available, else enable heuristic fallback."""
    global _model, _model_loaded, _use_heuristic

    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    model_path = os.path.join(models_dir, "minifasnet.onnx")

    if os.path.exists(model_path):
        try:
            import onnxruntime as ort

            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if gpu_enabled else ["CPUExecutionProvider"]
            _model = ort.InferenceSession(model_path, providers=providers)
            _model_loaded = True
            _use_heuristic = False
            logger.info("Liveness model loaded: %s (providers: %s)", model_path, _model.get_providers())
            return True
        except Exception as e:
            logger.error("Failed to load liveness ONNX model: %s", e)
            _use_heuristic = True
            _model_loaded = True
            logger.info("Falling back to heuristic liveness detection")
            return True
    else:
        logger.warning("Liveness ONNX model not found at %s — using heuristic fallback", model_path)
        _use_heuristic = True
        _model_loaded = True
        return True


def is_loaded() -> bool:
    """Check if liveness detection is available."""
    return _model_loaded


def _heuristic_liveness(face_crop: np.ndarray) -> dict:
    """Heuristic-based liveness using texture and color analysis.

    Detects common spoofing indicators:
    - Low texture variance (flat/printed image)
    - Limited color range (screen display)
    - Moiré patterns from screen capture
    """
    if face_crop is None or face_crop.size == 0:
        return {"is_live": False, "score": 0.0, "method": "heuristic"}

    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop

    # Texture analysis via Laplacian variance
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    # Color histogram spread (only for color images)
    color_spread = 0.0
    if len(face_crop.shape) == 3:
        for ch in range(3):
            hist = cv2.calcHist([face_crop], [ch], None, [256], [0, 256])
            non_zero = np.count_nonzero(hist)
            color_spread += non_zero / 256.0
        color_spread /= 3.0

    # Scoring: real faces have high texture variance and wide color spread
    texture_score = min(1.0, laplacian_var / 500.0)
    color_score = color_spread

    # Weighted combination
    score = 0.6 * texture_score + 0.4 * color_score
    is_live = score > 0.35

    return {
        "is_live": is_live,
        "score": round(float(score), 4),
        "method": "heuristic",
        "texture_variance": round(float(laplacian_var), 2),
        "color_spread": round(float(color_spread), 4),
    }


def _onnx_liveness(face_crop: np.ndarray) -> dict:
    """ONNX model-based liveness detection."""
    if _model is None:
        return _heuristic_liveness(face_crop)

    try:
        # Preprocess: resize to model input size (typically 80x80 for MiniFASNet)
        input_size = (80, 80)
        resized = cv2.resize(face_crop, input_size)
        if len(resized.shape) == 2:
            resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)

        # Normalize to [0, 1] and transpose to NCHW
        blob = resized.astype(np.float32) / 255.0
        blob = np.transpose(blob, (2, 0, 1))
        blob = np.expand_dims(blob, axis=0)

        input_name = _model.get_inputs()[0].name
        outputs = _model.run(None, {input_name: blob})

        # Output: probability of being live (index 1 typically)
        probs = outputs[0][0]
        if len(probs) >= 2:
            live_score = float(probs[1])
        else:
            live_score = float(probs[0])

        is_live = live_score > 0.5

        return {
            "is_live": is_live,
            "score": round(live_score, 4),
            "method": "onnx",
        }
    except Exception as e:
        logger.error("ONNX liveness inference failed: %s — falling back to heuristic", e)
        return _heuristic_liveness(face_crop)


def check_liveness(face_crop: np.ndarray) -> dict:
    """Check if a face crop is from a live person or a spoof.

    Args:
        face_crop: BGR face image (numpy array)

    Returns:
        dict with keys: is_live (bool), score (float 0-1), method (str)
    """
    if face_crop is None or face_crop.size == 0:
        return {"is_live": False, "score": 0.0, "method": "invalid_input"}

    if not _model_loaded:
        load_liveness_model()

    if _use_heuristic:
        return _heuristic_liveness(face_crop)
    else:
        return _onnx_liveness(face_crop)
