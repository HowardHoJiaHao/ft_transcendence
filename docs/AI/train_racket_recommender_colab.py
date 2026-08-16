"""
Google Colab training script for the RacketBot recommendation model.

Expected dataset columns:
- age_group
- gender
- experience_level
- play_style
- budget_range
- weightCategory
- flexibilityCategory
- balanceCategory

Recommended usage in Colab:
1. Generate/upload `dummy_racket_recommendation_data.csv`.
2. Clone the repository in Colab, or upload this script together with
   `ai_service/model_training.py`.
3. Run this script and download the generated model files:
   - racket_recommender.joblib
   - model_metadata.json

The exported joblib contains the full preprocessing + model pipeline.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

try:
    # Canonical implementation when this script is run from a repository clone.
    from ai_service.model_training import (
        FEATURE_COLUMNS,
        TARGET_COLUMNS,
        build_pipeline,
    )
except ImportError:
    # Colab users may upload ai_service/model_training.py beside this script.
    from model_training import FEATURE_COLUMNS, TARGET_COLUMNS, build_pipeline


DATASET_PATH = Path("/content/dummy_racket_recommendation_data.csv")
MODEL_OUTPUT_PATH = Path("/content/racket_recommender.joblib")
METADATA_OUTPUT_PATH = Path("/content/model_metadata.json")

def load_dataset(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}\n"
            "Upload or generate dummy_racket_recommendation_data.csv first."
        )

    df = pd.read_csv(path)
    required_columns = FEATURE_COLUMNS + TARGET_COLUMNS
    missing = [col for col in required_columns if col not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")

    return df[required_columns].dropna().reset_index(drop=True)


def evaluate_model(pipeline, x_test: pd.DataFrame, y_test: pd.DataFrame) -> dict:
    predictions = pipeline.predict(x_test)
    pred_df = pd.DataFrame(predictions, columns=TARGET_COLUMNS)

    metrics = {}
    print("\nEvaluation")
    print("=" * 60)

    for target in TARGET_COLUMNS:
        accuracy = accuracy_score(y_test[target], pred_df[target])
        metrics[target] = {"accuracy": round(float(accuracy), 4)}

        print(f"\nTarget: {target}")
        print(f"Accuracy: {accuracy:.4f}")
        print(classification_report(y_test[target], pred_df[target]))

    exact_match = (pred_df.values == y_test[TARGET_COLUMNS].values).all(axis=1).mean()
    metrics["exact_match_accuracy"] = round(float(exact_match), 4)

    print("\nExact full-spec match accuracy:")
    print(f"{exact_match:.4f}")

    return metrics


def show_prediction_examples(pipeline) -> None:
    examples = pd.DataFrame(
        [
            {
                "age_group": "18-25",
                "gender": "male",
                "experience_level": "more_than_5_years",
                "play_style": "attacking",
                "budget_range": "700_plus",
            },
            {
                "age_group": "13-17",
                "gender": "female",
                "experience_level": "1-3_years",
                "play_style": "defensive",
                "budget_range": "200-400",
            },
            {
                "age_group": "46_plus",
                "gender": "prefer_not_to_say",
                "experience_level": "less_than_6_months",
                "play_style": "not_sure",
                "budget_range": "under_200",
            },
        ]
    )

    predictions = pipeline.predict(examples)
    pred_df = pd.DataFrame(predictions, columns=TARGET_COLUMNS)

    print("\nPrediction examples")
    print("=" * 60)
    print(pd.concat([examples, pred_df], axis=1).to_string(index=False))


def save_metadata(metrics: dict, row_count: int) -> None:
    metadata = {
        "model_name": "racket_recommender",
        "model_type": "MultiOutput Random Forest Classifier",
        "version": "1.0.0",
        "features": FEATURE_COLUMNS,
        "outputs": TARGET_COLUMNS,
        "training_rows": row_count,
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_path": str(DATASET_PATH),
        "model_path": str(MODEL_OUTPUT_PATH),
    }

    METADATA_OUTPUT_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main() -> None:
    df = load_dataset(DATASET_PATH)

    x = df[FEATURE_COLUMNS]
    y = df[TARGET_COLUMNS]

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=42,
    )

    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)

    metrics = evaluate_model(pipeline, x_test, y_test)
    show_prediction_examples(pipeline)

    joblib.dump(pipeline, MODEL_OUTPUT_PATH)
    save_metadata(metrics, row_count=len(df))

    print("\nSaved files")
    print("=" * 60)
    print(f"Model: {MODEL_OUTPUT_PATH}")
    print(f"Metadata: {METADATA_OUTPUT_PATH}")
    print("\nCopy these into the project later:")
    print("ai_service/ml_models/racket_recommender.joblib")
    print("ai_service/ml_models/model_metadata.json")


if __name__ == "__main__":
    main()
