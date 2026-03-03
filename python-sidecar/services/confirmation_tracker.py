"""Multi-frame recognition confirmation tracker.

Requires N consecutive positive recognitions for the same person on the same
track before emitting an alert. Uses Exponential Moving Average (EMA) smoothing
to reduce noise from single-frame mismatches.

Per-camera, per-track state is maintained as a dict of ConfirmationState objects.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from config import get_config

logger = logging.getLogger("ai-sidecar.confirmation_tracker")

CONFIRMATION_EXPIRY_SEC = 10.0


@dataclass
class ConfirmationState:
    """Tracks recognition state for a single (camera, track) pair."""

    person_id: str | None = None
    person_name: str | None = None
    hit_count: int = 0
    ema_confidence: float = 0.0
    is_confirmed: bool = False
    last_updated: float = field(default_factory=time.time)

    def reset(self) -> None:
        """Clear state (called when person_id changes or track is lost)."""
        self.person_id = None
        self.person_name = None
        self.hit_count = 0
        self.ema_confidence = 0.0
        self.is_confirmed = False
        self.last_updated = time.time()


class ConfirmationTracker:
    """Per-camera multi-frame confirmation of face recognition results."""

    def __init__(self) -> None:
        self._states: dict[str, dict[int, ConfirmationState]] = {}

    def _get_state(self, camera_id: str, track_id: int) -> ConfirmationState:
        if camera_id not in self._states:
            self._states[camera_id] = {}
        if track_id not in self._states[camera_id]:
            self._states[camera_id][track_id] = ConfirmationState()
        return self._states[camera_id][track_id]

    def update(
        self,
        camera_id: str,
        track_id: int,
        recognition_result: dict[str, Any],
    ) -> dict[str, Any]:
        """Update confirmation state with a new recognition result.

        Args:
            camera_id: Camera that produced this recognition.
            track_id: ByteTrack track ID for this person.
            recognition_result: Dict from recognize_face() with keys:
                matched, person_id, person_name, confidence.

        Returns:
            Dict with keys:
                - confirmed: bool — whether N consecutive frames agree
                - person_id: str | None
                - person_name: str | None
                - ema_confidence: float
                - hit_count: int
        """
        if not camera_id:
            logger.warning("update() called with empty camera_id")
            return self._no_confirmation()

        cfg = get_config()
        state = self._get_state(camera_id, track_id)
        state.last_updated = time.time()

        is_matched = recognition_result.get("matched", False)
        new_person_id = recognition_result.get("person_id")
        new_person_name = recognition_result.get("person_name")
        new_confidence = float(recognition_result.get("confidence", 0.0))

        if is_matched and new_person_id:
            if state.person_id != new_person_id:
                state.person_id = new_person_id
                state.person_name = new_person_name
                state.hit_count = 1
                state.ema_confidence = new_confidence
                state.is_confirmed = False
            else:
                state.hit_count += 1
                alpha = cfg.confirmation_ema_alpha
                state.ema_confidence = alpha * new_confidence + (1.0 - alpha) * state.ema_confidence

                if state.hit_count >= cfg.confirmation_frames:
                    state.is_confirmed = True
        else:
            state.hit_count = max(0, state.hit_count - 1)
            if state.hit_count == 0:
                state.reset()

        return {
            "confirmed": state.is_confirmed,
            "person_id": state.person_id,
            "person_name": state.person_name,
            "ema_confidence": round(state.ema_confidence, 4),
            "hit_count": state.hit_count,
        }

    def is_confirmed(self, camera_id: str, track_id: int) -> bool:
        """Check if a track's recognition is confirmed."""
        state = self._get_state(camera_id, track_id)
        return state.is_confirmed

    def reset_track(self, camera_id: str, track_id: int) -> None:
        """Reset confirmation state for a specific track."""
        if camera_id in self._states and track_id in self._states[camera_id]:
            self._states[camera_id][track_id].reset()

    def purge_stale(self, max_age_sec: float = CONFIRMATION_EXPIRY_SEC) -> int:
        """Remove confirmation states not updated within max_age_sec.

        Returns the number of states purged.
        """
        now = time.time()
        purged = 0
        for camera_id in list(self._states.keys()):
            stale_tracks = [
                track_id
                for track_id, state in self._states[camera_id].items()
                if (now - state.last_updated) > max_age_sec
            ]
            for track_id in stale_tracks:
                del self._states[camera_id][track_id]
                purged += 1
            if not self._states[camera_id]:
                del self._states[camera_id]

        if purged:
            logger.debug("Purged %d stale confirmation states", purged)
        return purged

    @staticmethod
    def _no_confirmation() -> dict[str, Any]:
        return {
            "confirmed": False,
            "person_id": None,
            "person_name": None,
            "ema_confidence": 0.0,
            "hit_count": 0,
        }


confirmation_tracker = ConfirmationTracker()
