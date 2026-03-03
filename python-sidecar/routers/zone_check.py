"""Zone check endpoint — point-in-polygon + tripwire crossing via Shapely.

POST /zone_check  — check tracked objects against zone definitions, return zone events.
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from shapely.geometry import Point, Polygon

from models.schemas import (
    DetectedObject,
    ZoneCheckRequest,
    ZoneCheckResponse,
    ZoneEvent,
    ZonePolygon,
)

logger = logging.getLogger("ai-sidecar.zone_check")

router = APIRouter(tags=["zone-check"])

# Per-camera, per-track state: {camera_id: {track_id: set(zone_ids)}}
_track_zone_state: dict[str, dict[int, set[str]]] = {}


def _parse_geometry(geometry_str: str) -> dict[str, Any]:
    """Parse zone geometry JSON string.

    Returns dict with either 'points' (polygon) or 'x1/y1/x2/y2' (tripwire).

    Raises:
        ValueError: If geometry cannot be parsed.
    """
    try:
        return json.loads(geometry_str)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(f"Invalid geometry JSON: {exc}") from exc


def _get_foot_point(bbox: list[float]) -> tuple[float, float]:
    """Get bottom-center of bounding box as foot point."""
    x1, y1, x2, y2 = bbox[0], bbox[1], bbox[2], bbox[3]
    return (x1 + x2) / 2.0, y2


def _check_polygon_containment(
    foot_x: float, foot_y: float, geometry: dict[str, Any]
) -> bool:
    """Check if a point is inside a polygon using Shapely."""
    points = geometry.get("points", [])
    if len(points) < 3:
        return False

    coords = [(p["x"], p["y"]) for p in points]
    polygon = Polygon(coords)
    point = Point(foot_x, foot_y)
    return polygon.contains(point)


def _cross_product(
    ax: float, ay: float, bx: float, by: float, cx: float, cy: float
) -> float:
    """2D cross product of vectors AB and AC."""
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def _check_tripwire_crossing(
    prev_x: float,
    prev_y: float,
    curr_x: float,
    curr_y: float,
    geometry: dict[str, Any],
) -> str | None:
    """Check if movement from prev to curr crosses the tripwire line.

    Returns 'IN', 'OUT', or None.
    """
    x1 = geometry.get("x1", 0)
    y1 = geometry.get("y1", 0)
    x2 = geometry.get("x2", 0)
    y2 = geometry.get("y2", 0)
    direction = geometry.get("direction", "left_to_right")

    d1 = _cross_product(x1, y1, x2, y2, prev_x, prev_y)
    d2 = _cross_product(x1, y1, x2, y2, curr_x, curr_y)
    d3 = _cross_product(prev_x, prev_y, curr_x, curr_y, x1, y1)
    d4 = _cross_product(prev_x, prev_y, curr_x, curr_y, x2, y2)

    is_intersecting = d1 * d2 < 0 and d3 * d4 < 0
    if not is_intersecting:
        return None

    if direction == "left_to_right":
        return "zone_enter" if (d1 > 0 and d2 < 0) else "zone_exit"
    else:
        return "zone_enter" if (d1 < 0 and d2 > 0) else "zone_exit"


# Previous foot points per camera per track: {camera_id: {track_id: (x, y)}}
_prev_foot_points: dict[str, dict[int, tuple[float, float]]] = {}


@router.post("/zone_check", response_model=ZoneCheckResponse)
async def zone_check_endpoint(request: ZoneCheckRequest) -> ZoneCheckResponse:
    """Check tracked objects against zone definitions.

    For polygon zones: detect zone_enter and zone_exit based on point-in-polygon.
    For tripwire zones: detect crossing based on segment intersection.

    Returns list of zone events.
    """
    if not request.camera_id:
        raise HTTPException(status_code=400, detail="camera_id is required")

    camera_id = request.camera_id
    events: list[ZoneEvent] = []

    # Initialize per-camera state if needed
    if camera_id not in _track_zone_state:
        _track_zone_state[camera_id] = {}
    if camera_id not in _prev_foot_points:
        _prev_foot_points[camera_id] = {}

    cam_track_state = _track_zone_state[camera_id]
    cam_prev_feet = _prev_foot_points[camera_id]

    seen_track_ids: set[int] = set()

    for obj in request.objects:
        track_id = obj.track_id
        if track_id is None:
            continue

        seen_track_ids.add(track_id)
        foot_x, foot_y = _get_foot_point(obj.bbox)

        # Ensure track has state
        if track_id not in cam_track_state:
            cam_track_state[track_id] = set()

        track_zones = cam_track_state[track_id]
        prev_foot = cam_prev_feet.get(track_id)

        for zone_def in request.zones:
            try:
                geometry = _parse_geometry(zone_def.geometry)
            except ValueError as exc:
                logger.warning(
                    "Invalid geometry for zone %s: %s", zone_def.zone_id, exc
                )
                continue

            zone_id = zone_def.zone_id
            zone_type = zone_def.zone_type.upper()

            if zone_type == "TRIPWIRE":
                # Tripwire needs previous position
                if prev_foot is not None:
                    cross_result = _check_tripwire_crossing(
                        prev_foot[0], prev_foot[1], foot_x, foot_y, geometry
                    )
                    if cross_result:
                        events.append(
                            ZoneEvent(
                                zone_id=zone_id,
                                track_id=track_id,
                                event_type=cross_result,
                            )
                        )
            else:
                # Polygon zone: check containment
                is_inside = _check_polygon_containment(foot_x, foot_y, geometry)
                was_inside = zone_id in track_zones

                if is_inside and not was_inside:
                    track_zones.add(zone_id)
                    events.append(
                        ZoneEvent(
                            zone_id=zone_id,
                            track_id=track_id,
                            event_type="zone_enter",
                        )
                    )
                elif not is_inside and was_inside:
                    track_zones.discard(zone_id)
                    events.append(
                        ZoneEvent(
                            zone_id=zone_id,
                            track_id=track_id,
                            event_type="zone_exit",
                        )
                    )

        # Update previous foot point
        cam_prev_feet[track_id] = (foot_x, foot_y)

    # Clean up tracks no longer seen — emit exit events
    disappeared = [tid for tid in cam_track_state if tid not in seen_track_ids]
    for tid in disappeared:
        for zone_id in cam_track_state[tid]:
            events.append(
                ZoneEvent(zone_id=zone_id, track_id=tid, event_type="zone_exit")
            )
        del cam_track_state[tid]
        cam_prev_feet.pop(tid, None)

    if events:
        logger.info(
            "Camera %s: %d zone events from %d objects",
            camera_id,
            len(events),
            len(request.objects),
        )

    return ZoneCheckResponse(events=events)
