"""Face quality gate service.

Scores detected faces on pose (yaw/pitch), sharpness, and detection confidence.
Rejects faces that would produce noisy embeddings or false matches.

Scoring dimensions:
  - yaw:   horizontal head rotation (degrees). >35° = side view.
  - pitch: vertical head rotation (degrees). >25° = looking up/down.
  - blur_score: Laplacian variance. Higher = sharper. <60 = too blurry.
  - det_score: InsightFace detection confidence.
"""

import logging
from typing import Any

import cv2
import numpy as np

from config import get_config

logger = logging.getLogger("ai-sidecar.quality_gate")


def _estimate_blur(face_img: np.ndarray) -> float:
    """Estimate image sharpness via Laplacian variance.

    Args:
        face_img: Cropped face region as BGR numpy array.

    Returns:
        Laplacian variance (higher = sharper). Returns 0.0 on failure.
    """
    if face_img is None or face_img.size == 0:
        return 0.0
    try:
        gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception as exc:
        logger.warning("Blur estimation failed: %s", exc)
        return 0.0


def _estimate_pose_from_landmarks(landmarks: np.ndarray | None) -> tuple[float, float]:
    """Estimate yaw and pitch from 5-point facial landmarks.

    Uses the relative positions of eye and nose landmarks to approximate
    head pose without a full 3D model.

    Args:
        landmarks: 5×2 array of (x,y) coordinates: [left_eye, right_eye,
                   nose_tip, left_mouth, right_mouth].

    Returns:
        (yaw_degrees, pitch_degrees). Returns (0.0, 0.0) on failure.
    """
    if landmarks is None or landmarks.shape != (5, 2):
        return 0.0, 0.0

    try:
        left_eye = landmarks[0]
        right_eye = landmarks[1]
        nose = landmarks[2]
        left_mouth = landmarks[3]
        right_mouth = landmarks[4]

        eye_center_x = (left_eye[0] + right_eye[0]) / 2.0
        eye_center_y = (left_eye[1] + right_eye[1]) / 2.0
        mouth_center_x = (left_mouth[0] + right_mouth[0]) / 2.0
        mouth_center_y = (left_mouth[1] + right_mouth[1]) / 2.0

        face_width = float(np.linalg.norm(right_eye - left_eye))
        if face_width < 1.0:
            return 0.0, 0.0

        nose_x_offset = (nose[0] - eye_center_x) / (face_width / 2.0)
        # Cap offset to ±0.85 — values near ±1.0 produce arcsin→90° artifacts
        # from unreliable landmarks (IR/night vision, low-res faces)
        capped_offset = np.clip(nose_x_offset, -0.85, 0.85)
        yaw_deg = float(np.degrees(np.arcsin(capped_offset)))

        face_height = abs(mouth_center_y - eye_center_y)
        nose_y_offset = (nose[1] - eye_center_y) / (face_height + 1e-6)
        pitch_deg = float(np.degrees(np.arctan(nose_y_offset - 0.5)))

        return abs(yaw_deg), abs(pitch_deg)

    except Exception as exc:
        logger.warning("Pose estimation failed: %s", exc)
        return 0.0, 0.0


def score_face(
    face: Any,
    full_frame: np.ndarray | None = None,
) -> dict[str, Any]:
    """Score a detected InsightFace face object for quality.

    Args:
        face: InsightFace Face object with bbox, det_score, kps attributes.
        full_frame: Full BGR frame used to crop the face region for blur analysis.

    Returns:
        Dict with keys:
            - yaw: float (degrees)
            - pitch: float (degrees)
            - blur_score: float (Laplacian variance)
            - det_score: float (InsightFace detection confidence)
            - quality_score: float (0-100 composite score)
            - passes_gate: bool
    """
    cfg = get_config()

    det_score = float(face.det_score) if hasattr(face, "det_score") else 0.0
    landmarks = face.kps if hasattr(face, "kps") and face.kps is not None else None

    yaw_deg, pitch_deg = _estimate_pose_from_landmarks(
        np.array(landmarks, dtype=np.float32) if landmarks is not None else None
    )

    blur_score = 0.0
    if full_frame is not None and hasattr(face, "bbox") and face.bbox is not None:
        try:
            h, w = full_frame.shape[:2]
            x1 = max(0, int(face.bbox[0]))
            y1 = max(0, int(face.bbox[1]))
            x2 = min(w, int(face.bbox[2]))
            y2 = min(h, int(face.bbox[3]))
            if x2 > x1 and y2 > y1:
                crop = full_frame[y1:y2, x1:x2]
                blur_score = _estimate_blur(crop)
        except Exception as exc:
            logger.warning("Failed to crop face for blur analysis: %s", exc)

    yaw_ok = yaw_deg <= cfg.quality_gate_max_yaw
    pitch_ok = pitch_deg <= cfg.quality_gate_max_pitch
    blur_ok = blur_score >= cfg.quality_gate_min_blur
    det_ok = det_score >= cfg.quality_gate_min_det_score

    pose_score = max(0.0, 100.0 - (yaw_deg / cfg.quality_gate_max_yaw) * 50.0
                     - (pitch_deg / cfg.quality_gate_max_pitch) * 30.0)
    blur_normalized = min(100.0, (blur_score / (cfg.quality_gate_min_blur * 3.0)) * 100.0)
    quality_score = round((pose_score * 0.4 + blur_normalized * 0.4 + det_score * 100.0 * 0.2), 1)

    passes_gate = (
        not cfg.quality_gate_enabled
        or (yaw_ok and pitch_ok and blur_ok and det_ok)
    )

    if not passes_gate:
        reasons = []
        if not yaw_ok:
            reasons.append(f"yaw={yaw_deg:.1f}°>{cfg.quality_gate_max_yaw}°")
        if not pitch_ok:
            reasons.append(f"pitch={pitch_deg:.1f}°>{cfg.quality_gate_max_pitch}°")
        if not blur_ok:
            reasons.append(f"blur={blur_score:.1f}<{cfg.quality_gate_min_blur}")
        if not det_ok:
            reasons.append(f"det_score={det_score:.3f}<{cfg.quality_gate_min_det_score}")
        logger.info("Quality gate REJECTED: %s", ", ".join(reasons))

    return {
        "yaw": round(yaw_deg, 2),
        "pitch": round(pitch_deg, 2),
        "blur_score": round(blur_score, 2),
        "det_score": round(det_score, 4),
        "quality_score": quality_score,
        "passes_gate": passes_gate,
    }
