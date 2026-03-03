"""InsightFace model loading and management.

Handles loading the buffalo_l model with CUDA ExecutionProvider
if available, falling back to CPU. Stores the model as a module-level
singleton for use by detection and recognition services.
"""

import logging
import subprocess
import time
from typing import Any

logger = logging.getLogger("ai-sidecar.model_loader")

_face_app: Any | None = None
_model_loaded: bool = False
_load_time_seconds: float = 0.0
_active_provider: str = "CPUExecutionProvider"


def _get_gpu_info() -> dict[str, Any]:
    """Query GPU name and VRAM via nvidia-smi."""
    info: dict[str, Any] = {"gpu_name": "N/A", "vram_total_mb": 0, "vram_used_mb": 0}
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(",")
            if len(parts) >= 3:
                info["gpu_name"] = parts[0].strip()
                info["vram_total_mb"] = int(parts[1].strip())
                info["vram_used_mb"] = int(parts[2].strip())
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    return info


def load_model(model_name: str = "buffalo_l", gpu_enabled: bool = True) -> Any:
    """Load InsightFace model with CUDA or CPU provider.

    Explicitly requests CUDAExecutionProvider with device_id=0 and
    arena_extend_strategy=kSameAsRequested to prevent fragmentation on
    the RTX 4090's 24 GB frame buffer. Falls back to CPU on any failure.

    Args:
        model_name: InsightFace model pack name (default: buffalo_l).
        gpu_enabled: Whether to attempt GPU acceleration.

    Returns:
        The loaded InsightFace FaceAnalysis app instance.

    Raises:
        RuntimeError: If model loading fails entirely.
    """
    global _face_app, _model_loaded, _load_time_seconds, _active_provider

    start = time.monotonic()
    providers: list[Any] = []
    use_cuda = False

    if gpu_enabled:
        try:
            import onnxruntime as ort

            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                cuda_options = {
                    "device_id": 0,
                    "arena_extend_strategy": "kSameAsRequested",
                    "cudnn_conv_algo_search": "EXHAUSTIVE",
                    "do_copy_in_default_stream": True,
                }
                providers = [
                    ("CUDAExecutionProvider", cuda_options),
                    "CPUExecutionProvider",
                ]
                use_cuda = True
                logger.info(
                    "CUDAExecutionProvider selected (device_id=0). "
                    "ORT version: %s",
                    ort.__version__,
                )
            else:
                providers = ["CPUExecutionProvider"]
                logger.warning(
                    "GPU requested but CUDAExecutionProvider unavailable. "
                    "Falling back to CPU. Available: %s",
                    available,
                )
        except ImportError:
            providers = ["CPUExecutionProvider"]
            logger.warning("onnxruntime not installed — using CPU provider")
    else:
        providers = ["CPUExecutionProvider"]
        logger.info("GPU disabled by config — using CPU provider")

    gpu_info = _get_gpu_info() if use_cuda else {}

    try:
        from insightface.app import FaceAnalysis

        face_app = FaceAnalysis(
            name=model_name,
            providers=providers,
        )
        face_app.prepare(ctx_id=0 if use_cuda else -1)

        _face_app = face_app
        _model_loaded = True
        _load_time_seconds = time.monotonic() - start
        _active_provider = "CUDAExecutionProvider" if use_cuda else "CPUExecutionProvider"

        if use_cuda:
            logger.info(
                "Model '%s' loaded in %.2fs | GPU: %s | VRAM: %d MiB total, %d MiB used | Provider: %s",
                model_name,
                _load_time_seconds,
                gpu_info.get("gpu_name", "N/A"),
                gpu_info.get("vram_total_mb", 0),
                gpu_info.get("vram_used_mb", 0),
                _active_provider,
            )
        else:
            logger.info(
                "Model '%s' loaded in %.2fs | Provider: %s",
                model_name,
                _load_time_seconds,
                _active_provider,
            )
        return face_app

    except Exception as exc:
        _model_loaded = False
        _load_time_seconds = time.monotonic() - start
        _active_provider = "CPUExecutionProvider"
        logger.error("Failed to load model '%s': %s", model_name, exc)
        raise RuntimeError(f"Model loading failed: {exc}") from exc


def get_face_app() -> Any | None:
    """Get the loaded InsightFace app instance.

    Returns None if the model has not been loaded yet.
    """
    return _face_app


def is_model_loaded() -> bool:
    """Check whether the model has been successfully loaded."""
    return _model_loaded


def get_load_time() -> float:
    """Get the model load time in seconds."""
    return _load_time_seconds


def get_active_provider() -> str:
    """Get the active ONNX Runtime execution provider name."""
    return _active_provider
