"""Per-camera ByteTrack-inspired object tracker.

Implements IoU-based multi-object tracking with persistent track IDs.
Each camera has its own TrackerCamera instance to maintain independent state.

Algorithm (simplified ByteTrack):
  1. High-conf detections matched to active tracks via IoU (Hungarian-style greedy).
  2. Unmatched active tracks enter 'lost' state for up to MAX_AGE frames.
  3. Unmatched high-conf detections spawn new tracks (Tentative → Confirmed after
     MIN_HITS frames).
  4. Low-conf detections used for second-pass matching against lost tracks.
"""

import logging
import time
from typing import Any

import numpy as np

logger = logging.getLogger("ai-sidecar.tracker")

MAX_AGE = 30
MIN_HITS = 3
IOU_THRESHOLD = 0.3
HIGH_CONF_THRESHOLD = 0.5
TRAIL_MAX_LEN = 60


def _compute_iou(bbox_a: list[float], bbox_b: list[float]) -> float:
    """Compute Intersection over Union between two [x1,y1,x2,y2] bboxes."""
    ax1, ay1, ax2, ay2 = bbox_a
    bx1, by1, bx2, by2 = bbox_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    if inter_area == 0.0:
        return 0.0

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union_area = area_a + area_b - inter_area

    if union_area <= 0.0:
        return 0.0

    return inter_area / union_area


def _greedy_iou_match(
    tracks: list["Track"],
    detections: list[dict[str, Any]],
    iou_threshold: float,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Greedy IoU matching between tracks and detections.

    Returns:
        matched: list of (track_idx, det_idx) pairs
        unmatched_tracks: list of track indices with no match
        unmatched_dets: list of detection indices with no match
    """
    if not tracks or not detections:
        return [], list(range(len(tracks))), list(range(len(detections)))

    iou_matrix = np.zeros((len(tracks), len(detections)), dtype=np.float32)
    for t_idx, track in enumerate(tracks):
        for d_idx, det in enumerate(detections):
            iou_matrix[t_idx, d_idx] = _compute_iou(track.bbox, det["bbox"])

    matched: list[tuple[int, int]] = []
    used_tracks: set[int] = set()
    used_dets: set[int] = set()

    flat_indices = np.argsort(-iou_matrix, axis=None)
    for flat_idx in flat_indices:
        t_idx = int(flat_idx // len(detections))
        d_idx = int(flat_idx % len(detections))

        if iou_matrix[t_idx, d_idx] < iou_threshold:
            break

        if t_idx in used_tracks or d_idx in used_dets:
            continue

        matched.append((t_idx, d_idx))
        used_tracks.add(t_idx)
        used_dets.add(d_idx)

    unmatched_tracks = [i for i in range(len(tracks)) if i not in used_tracks]
    unmatched_dets = [i for i in range(len(detections)) if i not in used_dets]

    return matched, unmatched_tracks, unmatched_dets


class Track:
    """Single tracked object with persistent ID and trail."""

    def __init__(
        self,
        track_id: int,
        bbox: list[float],
        object_class: str,
        confidence: float,
        timestamp: float,
    ) -> None:
        self.track_id = track_id
        self.bbox = bbox
        self.object_class = object_class
        self.confidence = confidence
        self.age = 0
        self.hits = 1
        self.is_confirmed = False
        self.trail: list[dict[str, float]] = []
        self._add_trail_point(bbox, timestamp)

    def update(self, bbox: list[float], confidence: float, timestamp: float) -> None:
        """Update track with a new matched detection."""
        self.bbox = bbox
        self.confidence = confidence
        self.age = 0
        self.hits += 1
        if self.hits >= MIN_HITS:
            self.is_confirmed = True
        self._add_trail_point(bbox, timestamp)

    def mark_missed(self) -> None:
        """Increment age when no detection matched this track."""
        self.age += 1

    def is_lost(self) -> bool:
        """True if track has been unmatched for too long."""
        return self.age > MAX_AGE

    def _add_trail_point(self, bbox: list[float], timestamp: float) -> None:
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        self.trail.append({"x": round(cx, 1), "y": round(cy, 1), "timestamp": timestamp})
        if len(self.trail) > TRAIL_MAX_LEN:
            self.trail.pop(0)

    def to_dict(self) -> dict[str, Any]:
        """Serialize track state for API response."""
        return {
            "track_id": self.track_id,
            "object_class": self.object_class,
            "bbox": self.bbox,
            "confidence": round(self.confidence, 4),
            "trail": self.trail,
        }


class TrackerCamera:
    """ByteTrack-inspired tracker for a single camera stream."""

    def __init__(self, camera_id: str) -> None:
        self.camera_id = camera_id
        self._tracks: list[Track] = []
        self._next_id = 1

    def update(
        self,
        detections: list[dict[str, Any]],
        timestamp: float | None = None,
    ) -> list[dict[str, Any]]:
        """Update tracker with new detections and return tracked objects.

        Args:
            detections: Output from object_detection.detect_objects().
            timestamp: Frame timestamp (seconds). Defaults to current time.

        Returns:
            List of tracked object dicts with track_id assigned.
        """
        if timestamp is None:
            timestamp = time.time()

        high_conf = [d for d in detections if d["confidence"] >= HIGH_CONF_THRESHOLD]
        low_conf = [d for d in detections if d["confidence"] < HIGH_CONF_THRESHOLD]

        active_tracks = [t for t in self._tracks if not t.is_lost()]
        lost_tracks = [t for t in self._tracks if t.is_lost()]

        matched_1, unmatched_tracks_1, unmatched_dets_1 = _greedy_iou_match(
            active_tracks, high_conf, IOU_THRESHOLD
        )

        for t_idx, d_idx in matched_1:
            active_tracks[t_idx].update(
                high_conf[d_idx]["bbox"],
                high_conf[d_idx]["confidence"],
                timestamp,
            )

        remaining_active = [active_tracks[i] for i in unmatched_tracks_1]
        remaining_high = [high_conf[i] for i in unmatched_dets_1]

        matched_2, unmatched_active_2, unmatched_low = _greedy_iou_match(
            remaining_active, low_conf, IOU_THRESHOLD
        )

        for t_idx, d_idx in matched_2:
            remaining_active[t_idx].update(
                low_conf[d_idx]["bbox"],
                low_conf[d_idx]["confidence"],
                timestamp,
            )

        unmatched_remaining_active = [remaining_active[i] for i in unmatched_active_2]

        matched_3, _, unmatched_new = _greedy_iou_match(
            lost_tracks, remaining_high, IOU_THRESHOLD
        )

        for t_idx, d_idx in matched_3:
            lost_tracks[t_idx].update(
                remaining_high[d_idx]["bbox"],
                remaining_high[d_idx]["confidence"],
                timestamp,
            )

        for t in unmatched_remaining_active:
            t.mark_missed()

        for lost_t in lost_tracks:
            is_re_matched = any(lt == lost_t for lt, _ in [(lost_tracks[ti], di) for ti, di in matched_3])
            if not is_re_matched:
                lost_t.mark_missed()

        for det_idx in unmatched_new:
            det = remaining_high[det_idx]
            new_track = Track(
                track_id=self._next_id,
                bbox=det["bbox"],
                object_class=det["object_class"],
                confidence=det["confidence"],
                timestamp=timestamp,
            )
            self._next_id += 1
            self._tracks.append(new_track)

        self._tracks = [t for t in self._tracks if not t.is_lost()]

        output: list[dict[str, Any]] = []
        for track in self._tracks:
            if track.is_confirmed:
                det_dict = track.to_dict()
                output.append(det_dict)

        return output

    def get_state(self) -> list[dict[str, Any]]:
        """Return all confirmed active tracks with trails."""
        return [t.to_dict() for t in self._tracks if t.is_confirmed]

    def reset(self) -> None:
        """Clear all tracking state for this camera."""
        self._tracks = []
        self._next_id = 1


class TrackerService:
    """Manages per-camera tracker instances."""

    def __init__(self) -> None:
        self._cameras: dict[str, TrackerCamera] = {}

    def _get_camera(self, camera_id: str) -> TrackerCamera:
        if camera_id not in self._cameras:
            logger.info("Creating new tracker for camera %s", camera_id)
            self._cameras[camera_id] = TrackerCamera(camera_id)
        return self._cameras[camera_id]

    def update(
        self,
        camera_id: str,
        detections: list[dict[str, Any]],
        timestamp: float | None = None,
    ) -> list[dict[str, Any]]:
        """Update tracker for a camera and return tracked objects with IDs.

        Args:
            camera_id: Unique camera identifier.
            detections: Raw detections from YOLO.
            timestamp: Frame timestamp in seconds.

        Returns:
            List of confirmed tracked objects with persistent track_id.
        """
        if not camera_id:
            logger.warning("update() called with empty camera_id")
            return []

        camera = self._get_camera(camera_id)
        return camera.update(detections, timestamp)

    def get_state(self, camera_id: str) -> list[dict[str, Any]]:
        """Return current track state for a camera.

        Args:
            camera_id: Unique camera identifier.

        Returns:
            List of active confirmed tracks with trail history.
        """
        if camera_id not in self._cameras:
            return []
        return self._cameras[camera_id].get_state()

    def reset_camera(self, camera_id: str) -> None:
        """Reset tracking state for a specific camera."""
        if camera_id in self._cameras:
            self._cameras[camera_id].reset()
            logger.info("Reset tracker for camera %s", camera_id)

    def list_cameras(self) -> list[str]:
        """Return all camera IDs with active trackers."""
        return list(self._cameras.keys())


tracker_service = TrackerService()
