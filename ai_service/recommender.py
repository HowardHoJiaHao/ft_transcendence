import json
import os
import threading
from typing import Any, Dict, List, Optional

try:
    import joblib
except ImportError:  # pragma: no cover - installed by the service image
    joblib = None

try:
    import pandas as pd
except ImportError:  # pragma: no cover - installed by the service image
    pd = None


MODEL_DIR = os.getenv(
    "RACKET_RECOMMENDER_MODEL_DIR",
    os.path.join(os.path.dirname(__file__), "ml_models"),
)
MODEL_PATH = os.getenv(
    "RACKET_RECOMMENDER_MODEL_PATH",
    os.path.join(MODEL_DIR, "racket_recommender.joblib"),
)
MODEL_METADATA_PATH = os.getenv(
    "RACKET_RECOMMENDER_METADATA_PATH",
    os.path.join(MODEL_DIR, "model_metadata.json"),
)

REQUIRED_PROFILE_FIELDS = [
    "age_group",
    "gender",
    "experience_level",
    "play_style",
    "budget_range",
]

OUTPUT_FIELDS = [
    "weightCategory",
    "flexibilityCategory",
    "balanceCategory",
]

PROFILE_VALUE_ALIASES = {
    "age_group": {
        "under-13": "under_13",
        "under_13": "under_13",
        "13-17": "13-17",
        "18-25": "18-25",
        "26-35": "26-35",
        "36-45": "36-45",
        "46+": "46_plus",
        "46_plus": "46_plus",
    },
    "gender": {
        "male": "male",
        "female": "female",
        "prefer_not_to_say": "prefer_not_to_say",
    },
    "experience_level": {
        "less_than_6_months": "less_than_6_months",
        "6_months-1_year": "6_months_1_year",
        "6_months_1_year": "6_months_1_year",
        "1-3_years": "1-3_years",
        "3-5_years": "3-5_years",
        "more_than_5_years": "more_than_5_years",
    },
    "play_style": {
        "attacking": "attacking",
        "offensive": "attacking",
        "defensive": "defensive",
        "defense": "defensive",
        "control": "defensive",
        "balanced": "balanced",
        "all-round": "balanced",
        "all_round": "balanced",
        "all round": "balanced",
        "not_sure": "not_sure",
        "not sure": "not_sure",
    },
    "budget_range": {
        "under-200": "under_200",
        "under_200": "under_200",
        "200-400": "200-400",
        "400-700": "400-700",
        "700+": "700_plus",
        "700_plus": "700_plus",
    },
}


class RecommendationProfileError(ValueError):
    """The structured assessment profile is missing or invalid."""


class ModelUnavailableError(RuntimeError):
    """The serialized recommendation model cannot be loaded."""


class ModelPredictionError(RuntimeError):
    """The model failed to return its documented outputs."""


def validate_profile(profile: Dict[str, Any]) -> Dict[str, str]:
    missing = [
        field
        for field in REQUIRED_PROFILE_FIELDS
        if not str(profile.get(field, "")).strip()
    ]
    if missing:
        raise RecommendationProfileError(
            f"Missing recommendation profile field(s): {', '.join(missing)}"
        )

    clean_profile: Dict[str, str] = {}
    invalid = []
    for field in REQUIRED_PROFILE_FIELDS:
        raw_value = str(profile[field]).strip()
        normalized_value = PROFILE_VALUE_ALIASES[field].get(raw_value)
        if normalized_value is None:
            normalized_value = PROFILE_VALUE_ALIASES[field].get(raw_value.lower())
        if normalized_value is None:
            invalid.append(f"{field}={raw_value}")
        else:
            clean_profile[field] = normalized_value

    if invalid:
        raise RecommendationProfileError(
            f"Invalid recommendation profile value(s): {', '.join(invalid)}"
        )
    return clean_profile


def load_model_metadata() -> Dict[str, Any]:
    _, metadata_path, _ = _resolve_active_paths()
    metadata: Dict[str, Any] = {
        "model_name": "racket_recommender",
        "version": "unknown",
        "trained_at": None,
        "confidence_calibrated": False,
    }
    try:
        with open(metadata_path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            metadata.update(loaded)
    except (OSError, json.JSONDecodeError):
        pass
    return metadata


def load_model():
    return _model_manager.load()


def clear_model_cache() -> None:
    _model_manager.clear()


def _resolve_active_paths():
    manifest_path = os.path.join(MODEL_DIR, "active.json")
    try:
        with open(manifest_path, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        model_path = _safe_model_path(manifest["model_path"])
        metadata_path = _safe_model_path(manifest["metadata_path"])
        cache_key = (
            str(manifest.get("version", "unknown")),
            model_path,
            os.path.getmtime(manifest_path),
        )
        return model_path, metadata_path, cache_key
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        cache_key = (
            "legacy",
            MODEL_PATH,
            os.path.getmtime(MODEL_PATH) if os.path.exists(MODEL_PATH) else None,
        )
        return MODEL_PATH, MODEL_METADATA_PATH, cache_key


def _safe_model_path(relative_path: str) -> str:
    root = os.path.realpath(MODEL_DIR)
    candidate = os.path.realpath(os.path.join(root, str(relative_path)))
    if os.path.commonpath([root, candidate]) != root:
        raise ValueError("Model manifest path escapes the model directory")
    return candidate

# define a class, so that can create object around loading and keeping joblib file
# oop wrapper for "load this joblib once and reuse it"
class _ModelManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._cache_key = None
        self._model = None

    def clear(self) -> None:
        with self._lock:
            self._cache_key = None
            self._model = None

    def load(self):
        model_path, _, cache_key = _resolve_active_paths()
        with self._lock:
            if self._model is not None and self._cache_key == cache_key:
                return self._model
            if joblib is None:
                raise ModelUnavailableError("joblib is not installed")
            if not os.path.exists(model_path):
                raise ModelUnavailableError("Recommendation model artifact is missing")
            try:
                candidate = joblib.load(model_path)
            except Exception as exc:
                raise ModelUnavailableError(
                    "Recommendation model could not be loaded"
                ) from exc
            self._model = candidate
            self._cache_key = cache_key
            return self._model


_model_manager = _ModelManager()


def _legacy_load_model():
    """Compatibility helper retained for older direct imports."""
    if joblib is None:
        raise ModelUnavailableError("joblib is not installed")
    if not os.path.exists(MODEL_PATH):
        raise ModelUnavailableError("Recommendation model artifact is missing")
    try:
        return joblib.load(MODEL_PATH)
    except Exception as exc:
        raise ModelUnavailableError("Recommendation model could not be loaded") from exc


def _as_feature_frame(profile: Dict[str, str]):
    if pd is not None:
        return pd.DataFrame([profile], columns=REQUIRED_PROFILE_FIELDS)
    return [profile]


def _first_prediction_row(raw_prediction: Any) -> List[Any]:
    if hasattr(raw_prediction, "tolist"):
        raw_prediction = raw_prediction.tolist()
    if isinstance(raw_prediction, tuple):
        raw_prediction = list(raw_prediction)
    if isinstance(raw_prediction, list) and raw_prediction:
        first = raw_prediction[0]
        if isinstance(first, (list, tuple)):
            return list(first)
        return raw_prediction
    raise ModelPredictionError("Model returned an empty prediction")


def _confidence_by_output(model: Any, feature_frame: Any) -> Optional[Dict[str, float]]:
    """Return independent output confidence when the estimator exposes it.

    The values are deliberately not averaged: weight, flexibility, and balance
    are separate predictions with potentially different uncertainty. They are
    also not described as calibrated unless model metadata proves calibration.
    """

    if not hasattr(model, "predict_proba"):
        return None
    try:
        probability_outputs = model.predict_proba(feature_frame) #return the probabilities for each possible class
        if not isinstance(probability_outputs, (list, tuple)):
            return None
        result: Dict[str, float] = {}
        for index, output_probs in enumerate(probability_outputs[: len(OUTPUT_FIELDS)]):
            first_row = output_probs[0]
            if hasattr(first_row, "tolist"):
                first_row = first_row.tolist()
            if first_row:
                result[OUTPUT_FIELDS[index]] = round(float(max(first_row)), 4)
        return result or None
    except Exception:
        return None

#this is agent tools
#take a player profile, validate , run ml model, return the categories
def predict_racket_specs(profile: Dict[str, Any]) -> Dict[str, Any]:
    clean_profile = validate_profile(profile)
    model = load_model()
    feature_frame = _as_feature_frame(clean_profile) #formatting

    try:
        prediction_row = _first_prediction_row(model.predict(feature_frame)) #this is a normalizer, turn messy predict output to one list of 3 label, and predict method (library, it is actually pass the input to the model)
    except ModelPredictionError:
        raise
    except Exception as exc:
        raise ModelPredictionError("Model prediction failed") from exc

    if len(prediction_row) < len(OUTPUT_FIELDS):
        raise ModelPredictionError(
            f"Model returned {len(prediction_row)} output(s), expected {len(OUTPUT_FIELDS)}"
        )

	#this is about to give name to the result, because model.predict will return index only
    predictions = {
        field: str(prediction_row[index])
        for index, field in enumerate(OUTPUT_FIELDS)
    }
    result: Dict[str, Any] = {
        "predictions": predictions,
        "model": load_model_metadata(),
    } #attach the predictionn to the result from above

    confidence = _confidence_by_output(model, feature_frame)
    if confidence:
        result["confidence_by_output"] = confidence
    return result

# this is for runtime ml