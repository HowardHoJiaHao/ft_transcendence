import os
from functools import lru_cache
from typing import Any, Dict, List, Optional

try:
    import joblib
except ImportError:  # pragma: no cover - dependency is installed in Docker image
    joblib = None

try:
    import pandas as pd
except ImportError:  # pragma: no cover - dependency is installed in Docker image
    pd = None


MODEL_PATH = os.getenv(
    "RACKET_RECOMMENDER_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "ml_models", "racket_recommender.joblib"),
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
        "defensive": "defensive",
        "balanced": "balanced",
        "not_sure": "not_sure",
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
    pass


class ModelUnavailableError(RuntimeError):
    pass


class ModelPredictionError(RuntimeError):
    pass


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

    clean_profile = {}
    invalid = []
    for field in REQUIRED_PROFILE_FIELDS:
        raw_value = str(profile[field]).strip()
        normalized_value = PROFILE_VALUE_ALIASES[field].get(raw_value)
        if normalized_value is None:
            invalid.append(f"{field}={raw_value}")
        else:
            clean_profile[field] = normalized_value

    if invalid:
        raise RecommendationProfileError(
            f"Invalid recommendation profile value(s): {', '.join(invalid)}"
        )

    return clean_profile


@lru_cache(maxsize=1)
def load_model():
    if joblib is None:
        raise ModelUnavailableError("joblib is not installed")
    if not os.path.exists(MODEL_PATH):
        raise ModelUnavailableError(f"Model file not found at {MODEL_PATH}")
    return joblib.load(MODEL_PATH)


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


def _prediction_confidence(model: Any, feature_frame: Any) -> Optional[float]:
    if not hasattr(model, "predict_proba"):
        return None

    try:
        probabilities = model.predict_proba(feature_frame)
        confidences = []
        for output_probs in probabilities:
            first_row = output_probs[0]
            if hasattr(first_row, "tolist"):
                first_row = first_row.tolist()
            if first_row:
                confidences.append(max(first_row))
        if confidences:
            return round(sum(confidences) / len(confidences), 2)
    except Exception:
        return None

    return None


def predict_racket_specs(profile: Dict[str, Any]) -> Dict[str, Any]:
    clean_profile = validate_profile(profile)
    model = load_model()
    feature_frame = _as_feature_frame(clean_profile)

    try:
        prediction_row = _first_prediction_row(model.predict(feature_frame))
    except Exception as exc:
        raise ModelPredictionError(str(exc)) from exc

    if len(prediction_row) < len(OUTPUT_FIELDS):
        raise ModelPredictionError(
            f"Model returned {len(prediction_row)} output(s), expected {len(OUTPUT_FIELDS)}"
        )

    specs = {
        field: str(prediction_row[index])
        for index, field in enumerate(OUTPUT_FIELDS)
    }
    confidence = _prediction_confidence(model, feature_frame)
    if confidence is not None:
        specs["confidence"] = confidence
    return specs
