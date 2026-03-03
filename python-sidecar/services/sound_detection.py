"""Sound event detection service — audio intelligence layer.

Uses YAMNet (or equivalent) model for audio classification.
Detects security-relevant sounds: glass_break, gunshot, scream, dog_bark, horn.

If no model is available, the service reports as unavailable.
"""

import logging
import os
from typing import List, Optional

import numpy as np

logger = logging.getLogger("sound_detection")

_model = None
_model_loaded = False

# YAMNet AudioSet ontology — class index → name mapping for 521 classes.
# Only security-relevant indices are listed; full list at
# https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
YAMNET_CLASS_INDEX: dict[int, str] = {
    0: "Speech", 1: "Child speech, kid speaking", 2: "Conversation", 3: "Narration, monologue",
    4: "Babbling", 5: "Speech synthesizer", 6: "Shout", 7: "Bellow", 8: "Whoop",
    9: "Yell", 10: "Children shouting", 13: "Screaming", 14: "Whispering",
    27: "Laughter", 28: "Baby laughter", 29: "Giggle", 30: "Snicker", 31: "Belly laugh",
    66: "Dog", 67: "Bark", 68: "Yip", 69: "Howl", 70: "Bow-wow", 71: "Growling",
    72: "Whimper (dog)",
    288: "Vehicle horn, car horn, honking", 289: "Air horn, truck horn",
    290: "Reversing beeps", 291: "Ice cream truck, ice cream van",
    393: "Glass", 394: "Chink, clink", 395: "Shatter",
    399: "Breaking",
    427: "Gunshot, gunfire", 428: "Machine gun", 429: "Fusillade",
    430: "Artillery fire", 431: "Cap gun", 432: "Fireworks", 433: "Firecracker",
    434: "Burst, pop", 436: "Eruption", 437: "Boom",
    462: "Alarm", 463: "Buzzer", 464: "Alarm clock",
    467: "Siren", 468: "Civil defense siren", 469: "Smoke detector, smoke alarm",
    470: "Fire alarm", 471: "Foghorn",
    494: "Explosion", 495: "Gunshot, gunfire",
    506: "Car alarm",
}

# Reverse lookup: class name → set of indices
_CLASS_NAME_TO_INDICES: dict[str, set[int]] = {}
for _idx, _name in YAMNET_CLASS_INDEX.items():
    _CLASS_NAME_TO_INDICES.setdefault(_name, set()).add(_idx)

# Security sound classes mapped to YAMNet class names
SECURITY_SOUND_CLASSES = {
    "glass_break": ["Breaking", "Shatter", "Glass"],
    "gunshot": ["Gunshot, gunfire", "Machine gun", "Firecracker"],
    "scream": ["Screaming", "Shout", "Yell"],
    "dog_bark": ["Bark", "Dog", "Growling"],
    "horn": ["Vehicle horn, car horn, honking", "Air horn, truck horn"],
}

# Pre-compute per-event-type index sets for fast lookup at inference time
SECURITY_CLASS_INDICES: dict[str, set[int]] = {}
for _evt, _names in SECURITY_SOUND_CLASSES.items():
    _indices: set[int] = set()
    for _n in _names:
        _indices |= _CLASS_NAME_TO_INDICES.get(_n, set())
    SECURITY_CLASS_INDICES[_evt] = _indices


def load_sound_model(gpu_enabled: bool = True) -> bool:
    """Load the sound classification model if available."""
    global _model, _model_loaded

    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")

    # Try ONNX model first
    onnx_path = os.path.join(models_dir, "yamnet.onnx")
    if os.path.exists(onnx_path):
        try:
            import onnxruntime as ort

            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if gpu_enabled else ["CPUExecutionProvider"]
            _model = ort.InferenceSession(onnx_path, providers=providers)
            _model_loaded = True
            logger.info("YAMNet ONNX model loaded: %s", onnx_path)
            return True
        except Exception as e:
            logger.error("Failed to load YAMNet ONNX model: %s", e)

    # Try TFLite model
    tflite_path = os.path.join(models_dir, "yamnet.tflite")
    if os.path.exists(tflite_path):
        try:
            import tflite_runtime.interpreter as tflite

            interpreter = tflite.Interpreter(model_path=tflite_path)
            interpreter.allocate_tensors()
            _model = interpreter
            _model_loaded = True
            logger.info("YAMNet TFLite model loaded: %s", tflite_path)
            return True
        except ImportError:
            logger.warning("tflite_runtime not installed — cannot load TFLite model")
        except Exception as e:
            logger.error("Failed to load YAMNet TFLite model: %s", e)

    logger.warning("No sound detection model found in %s — sound detection unavailable", models_dir)
    _model_loaded = False
    return False


def is_loaded() -> bool:
    """Check if sound detection model is available."""
    return _model_loaded


def classify_audio(
    audio_data: np.ndarray,
    sample_rate: int = 16000,
    confidence_threshold: float = 0.3,
    target_classes: Optional[List[str]] = None,
) -> List[dict]:
    """Classify audio segment for security-relevant sounds.

    Args:
        audio_data: Audio samples as float32 numpy array (mono, normalized -1 to 1)
        sample_rate: Sample rate in Hz (YAMNet expects 16000)
        confidence_threshold: Minimum confidence to report a detection
        target_classes: List of security sound types to filter for.
                       If None, uses all SECURITY_SOUND_CLASSES.

    Returns:
        List of detected sound events:
        [{"class": "glass_break", "confidence": 0.85, "start_ms": 0, "end_ms": 960}]
    """
    if not _model_loaded or _model is None:
        return []

    if audio_data is None or audio_data.size == 0:
        return []

    if target_classes is None:
        target_classes = list(SECURITY_SOUND_CLASSES.keys())

    try:
        # Ensure audio is float32 and mono
        if audio_data.dtype != np.float32:
            audio_data = audio_data.astype(np.float32)

        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)

        # Resample if needed (YAMNet expects 16kHz)
        if sample_rate != 16000:
            ratio = 16000 / sample_rate
            new_len = int(len(audio_data) * ratio)
            indices = np.linspace(0, len(audio_data) - 1, new_len).astype(int)
            audio_data = audio_data[indices]

        # Normalize to [-1, 1]
        max_val = np.abs(audio_data).max()
        if max_val > 0:
            audio_data = audio_data / max_val

        # YAMNet processes 0.96s frames with 0.48s hop
        frame_length = int(16000 * 0.96)
        hop_length = int(16000 * 0.48)

        detections = []

        for start_sample in range(0, len(audio_data) - frame_length + 1, hop_length):
            frame = audio_data[start_sample:start_sample + frame_length]
            start_ms = int(start_sample / 16000 * 1000)
            end_ms = int((start_sample + frame_length) / 16000 * 1000)

            # Run inference
            scores = _run_inference(frame)
            if scores is None:
                continue

            # Match against security sound classes using proper index mapping
            for event_type in target_classes:
                if event_type not in SECURITY_CLASS_INDICES:
                    continue

                target_indices = SECURITY_CLASS_INDICES[event_type]
                if not target_indices:
                    continue

                # Find max score only across the indices belonging to this event type
                max_score = 0.0
                for idx in target_indices:
                    if idx < len(scores):
                        max_score = max(max_score, float(scores[idx]))

                if max_score >= confidence_threshold:
                    detections.append({
                        "class": event_type,
                        "confidence": round(max_score, 4),
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                    })

        return detections

    except Exception as e:
        logger.error("Audio classification failed: %s", e)
        return []


def _run_inference(frame: np.ndarray) -> Optional[np.ndarray]:
    """Run model inference on a single audio frame."""
    if _model is None:
        return None

    try:
        # ONNX Runtime inference
        if hasattr(_model, "run"):
            input_name = _model.get_inputs()[0].name
            input_data = np.expand_dims(frame, axis=0)
            outputs = _model.run(None, {input_name: input_data})
            return outputs[0][0] if outputs else None

        # TFLite inference
        if hasattr(_model, "get_input_details"):
            input_details = _model.get_input_details()
            output_details = _model.get_output_details()
            input_data = np.expand_dims(frame, axis=0).astype(np.float32)
            _model.set_tensor(input_details[0]["index"], input_data)
            _model.invoke()
            return _model.get_tensor(output_details[0]["index"])[0]

    except Exception as e:
        logger.error("Sound model inference failed: %s", e)

    return None
