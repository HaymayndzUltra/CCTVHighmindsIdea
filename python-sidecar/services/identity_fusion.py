"""Multi-layer identity fusion service.

Combines face recognition, body Re-ID, and (future) gait/soft biometric
scores into a single fused identity confidence. Degrades gracefully
when individual layers are unavailable.

Default weights (when all 4 layers present):
  face=0.5, body=0.25, gait=0.15, soft=0.1

Degrades gracefully when layers are missing — weights are
normalized across available layers.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("ai-sidecar.identity_fusion")

# Default fusion weights — configurable at runtime
_face_weight: float = 0.5
_body_weight: float = 0.25
_gait_weight: float = 0.15
_soft_weight: float = 0.10


@dataclass
class FusionInput:
    """Input scores for identity fusion.

    Each field is None if the corresponding layer is unavailable.
    """
    face_similarity: Optional[float] = None
    body_similarity: Optional[float] = None
    gait_similarity: Optional[float] = None
    soft_match_score: Optional[float] = None
    face_person_id: Optional[str] = None
    body_global_person_id: Optional[str] = None
    gait_person_id: Optional[str] = None


@dataclass
class FusionResult:
    """Output of the identity fusion process."""
    fused_score: float = 0.0
    identity_method: str = "none"
    person_id: Optional[str] = None
    global_person_id: Optional[str] = None
    layers_used: list[str] = field(default_factory=list)
    layer_scores: dict[str, float] = field(default_factory=dict)
    confidence_level: str = "low"  # low / medium / high


def configure(
    face_weight: Optional[float] = None,
    body_weight: Optional[float] = None,
    gait_weight: Optional[float] = None,
    soft_weight: Optional[float] = None,
) -> None:
    """Update fusion weights at runtime.

    Weights are normalized to sum to 1.0 across active layers.
    """
    global _face_weight, _body_weight, _gait_weight, _soft_weight
    if face_weight is not None:
        _face_weight = face_weight
    if body_weight is not None:
        _body_weight = body_weight
    if gait_weight is not None:
        _gait_weight = gait_weight
    if soft_weight is not None:
        _soft_weight = soft_weight


def fuse_identity(inputs: FusionInput) -> FusionResult:
    """Fuse available identity layers into a single confidence score.

    Applies weighted combination of available layers, normalizing
    weights to account for missing layers.

    Args:
        inputs: FusionInput with available similarity scores.

    Returns:
        FusionResult with fused score, method description, and person IDs.
    """
    layers: list[tuple[str, float, float]] = []  # (name, score, weight)

    if inputs.face_similarity is not None and inputs.face_similarity > 0:
        layers.append(("face", inputs.face_similarity, _face_weight))

    if inputs.body_similarity is not None and inputs.body_similarity > 0:
        layers.append(("body", inputs.body_similarity, _body_weight))

    if inputs.gait_similarity is not None and inputs.gait_similarity > 0:
        layers.append(("gait", inputs.gait_similarity, _gait_weight))

    if inputs.soft_match_score is not None and inputs.soft_match_score > 0:
        layers.append(("soft", inputs.soft_match_score, _soft_weight))

    if not layers:
        return FusionResult(
            fused_score=0.0,
            identity_method="none",
            confidence_level="low",
        )

    # Single-layer fast path
    if len(layers) == 1:
        name, score, _ = layers[0]
        person_id = _resolve_person_id(inputs, name)
        return FusionResult(
            fused_score=round(score, 4),
            identity_method=name,
            person_id=person_id,
            global_person_id=inputs.body_global_person_id,
            layers_used=[name],
            layer_scores={name: round(score, 4)},
            confidence_level=_classify_confidence(score, 1),
        )

    # Multi-layer weighted fusion with normalization
    total_weight = sum(w for _, _, w in layers)
    if total_weight <= 0:
        total_weight = len(layers)  # Equal weights fallback
        layers = [(n, s, 1.0) for n, s, _ in layers]

    fused = sum(score * (weight / total_weight) for _, score, weight in layers)
    fused = round(fused, 4)

    layer_names = [name for name, _, _ in layers]
    layer_scores = {name: round(score, 4) for name, score, _ in layers}

    # Determine best person_id from the highest-confidence face match
    person_id = _resolve_person_id(inputs, _best_layer(layers))

    method = "+".join(layer_names)

    return FusionResult(
        fused_score=fused,
        identity_method=method,
        person_id=person_id,
        global_person_id=inputs.body_global_person_id,
        layers_used=layer_names,
        layer_scores=layer_scores,
        confidence_level=_classify_confidence(fused, len(layers)),
    )


def _resolve_person_id(inputs: FusionInput, preferred_layer: str) -> Optional[str]:
    """Resolve the best person_id from available layers.

    Face recognition person_id takes priority over body/gait.
    """
    if inputs.face_person_id:
        return inputs.face_person_id
    if inputs.gait_person_id:
        return inputs.gait_person_id
    return None


def _best_layer(layers: list[tuple[str, float, float]]) -> str:
    """Return the layer name with the highest score."""
    if not layers:
        return "none"
    return max(layers, key=lambda x: x[1])[0]


def _classify_confidence(score: float, layer_count: int) -> str:
    """Classify fusion confidence level.

    More layers increase confidence at the same score.
    """
    if layer_count >= 3 and score >= 0.5:
        return "high"
    if layer_count >= 2 and score >= 0.55:
        return "high"
    if score >= 0.65:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"
