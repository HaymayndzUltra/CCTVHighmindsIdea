"""Tapo CCTV Desktop — AI Sidecar Runtime Configuration

Manages runtime settings for the AI sidecar service including
GPU detection, model selection, and detection thresholds.
"""

import logging
import os
import subprocess
from dataclasses import dataclass

logger = logging.getLogger("ai-sidecar.config")


@dataclass
class SidecarConfig:
    """Runtime configuration for the AI sidecar."""

    gpu_enabled: bool = True
    model_name: str = "buffalo_l"
    det_threshold: float = 0.5
    rec_threshold: float = 0.6
    port: int = 8520
    host: str = "127.0.0.1"
    db_path: str = ""
    yolo_enabled: bool = True
    yolo_confidence: float = 0.4
    yolo_classes: str = ""
    quality_gate_enabled: bool = True
    quality_gate_max_yaw: float = 60.0
    quality_gate_max_pitch: float = 40.0
    quality_gate_min_blur: float = 15.0
    quality_gate_min_det_score: float = 0.35
    confirmation_frames: int = 3
    confirmation_ema_alpha: float = 0.4
    night_enhance_enabled: bool = True
    night_luminance_threshold: float = 80.0
    adaptive_threshold_enabled: bool = True
    adaptive_threshold_min: float = 0.45
    adaptive_threshold_max: float = 0.65
    adaptive_threshold_margin: float = 0.08
    auto_enroll_enabled: bool = True
    auto_enroll_min_similarity: float = 0.55
    auto_enroll_min_quality: float = 80.0
    auto_enroll_max_count: int = 5
    negative_gallery_threshold: float = 0.7


_config: SidecarConfig | None = None


def detect_gpu() -> tuple[bool, str, int, int, str]:
    """Detect NVIDIA GPU availability and hardware info.

    Returns a tuple of:
        (gpu_available, gpu_name, vram_total_mb, vram_used_mb, cuda_version)

    Primary: queries onnxruntime available providers.
    Secondary: nvidia-smi for hardware metrics and CUDA version.
    """
    gpu_available = False
    gpu_name = "N/A"
    vram_total_mb = 0
    vram_used_mb = 0
    cuda_version = ""

    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" in providers:
            gpu_available = True
            logger.info("CUDA Execution Provider available via onnxruntime")
        else:
            logger.info(
                "CUDAExecutionProvider not found. Available: %s", providers
            )
    except ImportError:
        logger.warning("onnxruntime not installed — skipping provider check")

    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(",")
            if len(parts) >= 4:
                gpu_name = parts[0].strip()
                vram_total_mb = int(parts[1].strip())
                vram_used_mb = int(parts[2].strip())
                driver_ver = parts[3].strip()
                gpu_available = True
                logger.info(
                    "GPU: %s | VRAM: %d/%d MiB | Driver: %s",
                    gpu_name,
                    vram_used_mb,
                    vram_total_mb,
                    driver_ver,
                )
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError) as exc:
        logger.warning("nvidia-smi query failed: %s", exc)

    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            cuda_version = f"sm_{result.stdout.strip().replace('.', '')}"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    if not cuda_version and gpu_available:
        try:
            import onnxruntime as ort
            cuda_version = f"ORT-{ort.__version__}"
        except ImportError:
            pass

    return gpu_available, gpu_name, vram_total_mb, vram_used_mb, cuda_version


def get_config() -> SidecarConfig:
    """Get or create the singleton runtime configuration.

    Reads initial values from environment variables if set,
    otherwise uses defaults from PRD Section 5.2.
    """
    global _config
    if _config is not None:
        return _config

    _config = SidecarConfig(
        gpu_enabled=os.environ.get("SIDECAR_GPU_ENABLED", "true").lower() == "true",
        model_name=os.environ.get("SIDECAR_MODEL_NAME", "buffalo_l"),
        det_threshold=float(os.environ.get("SIDECAR_DET_THRESHOLD", "0.5")),
        rec_threshold=float(os.environ.get("SIDECAR_REC_THRESHOLD", "0.6")),
        port=int(os.environ.get("SIDECAR_PORT", "8520")),
        host=os.environ.get("SIDECAR_HOST", "127.0.0.1"),
        db_path=os.environ.get("SIDECAR_DB_PATH", ""),
    )
    return _config


def update_config(
    gpu_enabled: bool | None = None,
    model_name: str | None = None,
    det_threshold: float | None = None,
    rec_threshold: float | None = None,
    yolo_enabled: bool | None = None,
    yolo_confidence: float | None = None,
    yolo_classes: str | None = None,
    quality_gate_enabled: bool | None = None,
    night_enhance_enabled: bool | None = None,
    night_luminance_threshold: float | None = None,
    adaptive_threshold_enabled: bool | None = None,
    auto_enroll_enabled: bool | None = None,
    auto_enroll_min_similarity: float | None = None,
    auto_enroll_min_quality: float | None = None,
    auto_enroll_max_count: int | None = None,
    negative_gallery_threshold: float | None = None,
) -> SidecarConfig:
    """Update runtime configuration values.

    Only provided (non-None) fields are updated.
    Returns the updated configuration.
    """
    cfg = get_config()
    if gpu_enabled is not None:
        cfg.gpu_enabled = gpu_enabled
    if model_name is not None:
        cfg.model_name = model_name
    if det_threshold is not None:
        cfg.det_threshold = det_threshold
    if rec_threshold is not None:
        cfg.rec_threshold = rec_threshold
    if yolo_enabled is not None:
        cfg.yolo_enabled = yolo_enabled
    if yolo_confidence is not None:
        cfg.yolo_confidence = yolo_confidence
    if yolo_classes is not None:
        cfg.yolo_classes = yolo_classes
    if quality_gate_enabled is not None:
        cfg.quality_gate_enabled = quality_gate_enabled
    if night_enhance_enabled is not None:
        cfg.night_enhance_enabled = night_enhance_enabled
    if night_luminance_threshold is not None:
        cfg.night_luminance_threshold = night_luminance_threshold
    if adaptive_threshold_enabled is not None:
        cfg.adaptive_threshold_enabled = adaptive_threshold_enabled
    if auto_enroll_enabled is not None:
        cfg.auto_enroll_enabled = auto_enroll_enabled
    if auto_enroll_min_similarity is not None:
        cfg.auto_enroll_min_similarity = auto_enroll_min_similarity
    if auto_enroll_min_quality is not None:
        cfg.auto_enroll_min_quality = auto_enroll_min_quality
    if auto_enroll_max_count is not None:
        cfg.auto_enroll_max_count = auto_enroll_max_count
    if negative_gallery_threshold is not None:
        cfg.negative_gallery_threshold = negative_gallery_threshold
    return cfg
