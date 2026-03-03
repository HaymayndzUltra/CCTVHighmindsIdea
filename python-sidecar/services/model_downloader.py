"""ONNX Model Download & Verification

Downloads required ONNX models at sidecar startup if they are missing.
Models are stored in the `models/` directory relative to the sidecar root.
"""

import hashlib
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ai-sidecar.model_downloader")

# Models directory — sibling of this file's parent
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Registry of required models with download URLs and expected SHA256 checksums.
# Set sha256 to None to skip checksum verification.
MODEL_REGISTRY: list[dict] = [
    {
        "name": "yamnet.onnx",
        "url": None,  # TODO: Replace with actual YAMNet ONNX download URL (previous URL pointed to emotion-ferplus model)
        "sha256": None,
        "description": "YAMNet audio classification (provide correct URL before enabling)",
        "required": False,
    },
    # InsightFace buffalo_l is downloaded by insightface library itself.
    # YOLO is downloaded by ultralytics library itself.
    # The entries below are for custom ONNX models only.
    {
        "name": "osnet_ain_x1_0.onnx",
        "url": None,  # Must be exported manually from torchreid
        "sha256": None,
        "description": "OSNet-AIN Re-ID model (export from torchreid if available)",
        "required": False,
    },
    {
        "name": "gaitgl.onnx",
        "url": None,  # Must be exported manually
        "sha256": None,
        "description": "GaitGL gait recognition model (export if available)",
        "required": False,
    },
]


def _sha256_file(filepath: Path) -> str:
    """Compute SHA256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_file(url: str, dest: Path) -> bool:
    """Download a file from URL to dest path. Returns True on success."""
    try:
        import urllib.request

        logger.info("Downloading %s → %s", url, dest.name)
        os.makedirs(dest.parent, exist_ok=True)

        # Download to temp file first, then rename atomically
        tmp_path = dest.with_suffix(".tmp")
        urllib.request.urlretrieve(url, str(tmp_path))

        if tmp_path.exists() and tmp_path.stat().st_size > 0:
            tmp_path.rename(dest)
            logger.info("Downloaded %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
            return True
        else:
            logger.error("Download produced empty file: %s", dest.name)
            if tmp_path.exists():
                tmp_path.unlink()
            return False

    except Exception as exc:
        logger.error("Download failed for %s: %s", url, exc)
        tmp_path = dest.with_suffix(".tmp")
        if tmp_path.exists():
            tmp_path.unlink()
        return False


def verify_model(name: str, expected_sha256: Optional[str] = None) -> bool:
    """Check if a model file exists and optionally verify its checksum."""
    model_path = MODELS_DIR / name
    if not model_path.exists():
        return False
    if expected_sha256:
        actual = _sha256_file(model_path)
        if actual != expected_sha256:
            logger.warning(
                "Checksum mismatch for %s: expected %s, got %s",
                name, expected_sha256[:12], actual[:12],
            )
            return False
    return True


def ensure_models() -> dict:
    """Ensure all required models are present. Download missing ones if URL is available.

    Returns a status dict: { model_name: "ok" | "missing" | "downloaded" | "error" }
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    status: dict[str, str] = {}

    for entry in MODEL_REGISTRY:
        name = entry["name"]
        url = entry.get("url")
        sha256 = entry.get("sha256")
        required = entry.get("required", False)

        if verify_model(name, sha256):
            status[name] = "ok"
            continue

        if url:
            success = _download_file(url, MODELS_DIR / name)
            if success:
                if sha256 and not verify_model(name, sha256):
                    status[name] = "checksum_fail"
                    logger.error("Downloaded %s but checksum verification failed", name)
                else:
                    status[name] = "downloaded"
            else:
                status[name] = "download_failed"
                if required:
                    logger.error("REQUIRED model %s could not be downloaded", name)
        else:
            status[name] = "missing"
            level = logging.WARNING if required else logging.INFO
            logger.log(level, "Model %s not found and no download URL configured", name)

    return status


def get_model_path(name: str) -> Optional[Path]:
    """Get the path to a model file, or None if it doesn't exist."""
    path = MODELS_DIR / name
    return path if path.exists() else None
