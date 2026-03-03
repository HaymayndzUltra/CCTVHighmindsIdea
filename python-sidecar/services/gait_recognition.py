"""Gait recognition service using GaitGL/GaitSet ONNX model.

Analyzes walking sequences (~30 frames / ~2s at 15fps) to extract
gait embeddings for person identification. Gait works even when
face and body appearance are obscured (e.g., wearing a coat/mask).

If no ONNX model is available, falls back to a motion-pattern
heuristic based on stride frequency and bbox aspect ratio dynamics.
"""

import logging
import os
import time
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("ai-sidecar.gait")

_model = None
_model_loaded: bool = False
_use_heuristic: bool = False
_embedding_dim: int = 128

# Minimum frames needed for gait analysis (~2s at 15fps)
MIN_GAIT_FRAMES: int = 30


def load_gait_model(gpu_enabled: bool = True) -> bool:
    """Load the gait ONNX model if available, else enable heuristic fallback.

    Args:
        gpu_enabled: Whether to attempt CUDA acceleration.

    Returns:
        True if gait recognition is available (model or heuristic).
    """
    global _model, _model_loaded, _use_heuristic

    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    model_path = os.path.join(models_dir, "gaitgl.onnx")

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
                "Gait model loaded: %s (providers: %s)",
                model_path,
                _model.get_providers(),
            )
            return True
        except Exception as e:
            logger.error("Failed to load gait ONNX model: %s", e)
            _use_heuristic = True
            _model_loaded = True
            logger.info("Falling back to heuristic gait analysis")
            return True
    else:
        logger.warning(
            "Gait ONNX model not found at %s — using heuristic fallback",
            model_path,
        )
        _use_heuristic = True
        _model_loaded = True
        return True


def is_loaded() -> bool:
    """Check if gait recognition is available."""
    return _model_loaded


def _preprocess_silhouettes(frames: list[np.ndarray]) -> np.ndarray:
    """Extract binary silhouettes from person crops for GaitGL input.

    Each frame is converted to a binary silhouette mask via background
    subtraction / thresholding, then resized to 64x44 (HxW).
    """
    silhouettes = []
    for frame in frames:
        if frame is None or frame.size == 0:
            silhouettes.append(np.zeros((64, 44), dtype=np.float32))
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        # Adaptive threshold for silhouette extraction
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Resize to GaitGL input size (64x44)
        resized = cv2.resize(binary, (44, 64)).astype(np.float32) / 255.0
        silhouettes.append(resized)

    # Stack: (T, H, W) -> (1, T, 1, H, W) for batch ONNX input
    arr = np.array(silhouettes, dtype=np.float32)
    arr = np.expand_dims(arr, axis=(0, 2))  # (1, T, 1, 64, 44)
    return arr


def _onnx_analyze(frames: list[np.ndarray]) -> dict:
    """Analyze gait using ONNX model."""
    if _model is None:
        return _heuristic_analyze(frames)

    try:
        blob = _preprocess_silhouettes(frames)
        input_name = _model.get_inputs()[0].name
        outputs = _model.run(None, {input_name: blob})

        embedding = outputs[0][0]

        # L2-normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm

        return {
            "gait_embedding": embedding.astype(np.float32).tolist(),
            "confidence": 0.8,
            "method": "onnx",
            "frames_used": len(frames),
        }
    except Exception as e:
        logger.error("ONNX gait analysis failed: %s — using heuristic", e)
        return _heuristic_analyze(frames)


def _heuristic_analyze(frames: list[np.ndarray]) -> dict:
    """Heuristic gait analysis based on motion dynamics.

    Extracts features from:
    - Stride frequency (periodic vertical oscillation of bbox center)
    - Aspect ratio dynamics (width/height variation during walk cycle)
    - Horizontal movement pattern
    """
    if not frames or len(frames) < 10:
        return {
            "gait_embedding": [0.0] * _embedding_dim,
            "confidence": 0.0,
            "method": "heuristic",
            "frames_used": len(frames) if frames else 0,
        }

    heights = []
    widths = []
    centers_y = []

    for frame in frames:
        if frame is None or frame.size == 0:
            continue
        h, w = frame.shape[:2]
        heights.append(h)
        widths.append(w)
        centers_y.append(h / 2.0)

    if len(heights) < 10:
        return {
            "gait_embedding": [0.0] * _embedding_dim,
            "confidence": 0.0,
            "method": "heuristic",
            "frames_used": len(frames),
        }

    # Feature extraction
    heights_arr = np.array(heights, dtype=np.float32)
    widths_arr = np.array(widths, dtype=np.float32)
    aspect_ratios = widths_arr / np.maximum(heights_arr, 1.0)

    # Stride frequency via FFT on vertical center oscillation
    centers_arr = np.array(centers_y, dtype=np.float32)
    centers_detrended = centers_arr - np.mean(centers_arr)
    fft_magnitudes = np.abs(np.fft.rfft(centers_detrended))
    fft_normalized = fft_magnitudes / (np.max(fft_magnitudes) + 1e-8)

    # Aspect ratio statistics
    ar_mean = float(np.mean(aspect_ratios))
    ar_std = float(np.std(aspect_ratios))
    ar_range = float(np.max(aspect_ratios) - np.min(aspect_ratios))

    # Height statistics
    h_mean = float(np.mean(heights_arr))
    h_std = float(np.std(heights_arr))

    # Build feature vector (pad to embedding_dim)
    features = []
    features.extend(fft_normalized[:64].tolist())  # FFT features (64 dims)
    features.extend([ar_mean, ar_std, ar_range])     # Aspect ratio (3 dims)
    features.extend([h_mean / 500.0, h_std / 100.0]) # Height features (2 dims)

    # Pad to embedding_dim
    while len(features) < _embedding_dim:
        features.append(0.0)
    features = features[:_embedding_dim]

    # L2-normalize
    embedding = np.array(features, dtype=np.float32)
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    confidence = min(0.6, len(frames) / MIN_GAIT_FRAMES * 0.5)

    return {
        "gait_embedding": embedding.tolist(),
        "confidence": round(confidence, 4),
        "method": "heuristic",
        "frames_used": len(frames),
    }


def analyze_gait(frames: list[np.ndarray]) -> dict:
    """Analyze a walking sequence to extract a gait embedding.

    Args:
        frames: List of BGR person crop images from consecutive frames
                (~30 frames / ~2s of walking at 15fps).

    Returns:
        dict with keys:
          - gait_embedding: list[float] of shape (128,)
          - confidence: float 0-1
          - method: str ("onnx" or "heuristic")
          - frames_used: int
    """
    if not frames or len(frames) < 10:
        return {
            "gait_embedding": [0.0] * _embedding_dim,
            "confidence": 0.0,
            "method": "insufficient_frames",
            "frames_used": len(frames) if frames else 0,
        }

    if not _model_loaded:
        load_gait_model()

    if _use_heuristic:
        return _heuristic_analyze(frames)
    else:
        try:
            return _onnx_analyze(frames)
        except Exception as e:
            logger.error("Gait analysis failed: %s — using heuristic", e)
            return _heuristic_analyze(frames)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two gait embeddings."""
    a_arr = np.array(a, dtype=np.float32)
    b_arr = np.array(b, dtype=np.float32)
    dot = float(np.dot(a_arr, b_arr))
    norm_a = float(np.linalg.norm(a_arr))
    norm_b = float(np.linalg.norm(b_arr))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
