from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import platform
import shutil
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import pandas as pd
import psycopg2
import sklearn
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

try:
    from .model_training import FEATURE_COLUMNS, TARGET_COLUMNS, build_pipeline
    from .recommender import MODEL_DIR, clear_model_cache
except ImportError:
    from model_training import FEATURE_COLUMNS, TARGET_COLUMNS, build_pipeline
    from recommender import MODEL_DIR, clear_model_cache


logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
MODEL_ROOT = Path(MODEL_DIR)
MODEL_SEED_DIR = Path(os.getenv("RACKET_RECOMMENDER_SEED_DIR", "/app/model_seed"))
BASELINE_DATASET_PATH = Path(
    os.getenv(
        "RACKET_RECOMMENDER_BASELINE_DATASET",
        str(BASE_DIR / "training_data" / "dummy_racket_recommendation_data.csv"),
    )
)
if not BASELINE_DATASET_PATH.exists():
    BASELINE_DATASET_PATH = (
        BASE_DIR.parent / "docs" / "prd" / "dummy_racket_recommendation_data.csv"
    )

SNAPSHOT_COLUMNS = FEATURE_COLUMNS + TARGET_COLUMNS + ["source", "source_id"]


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "db"),
        port=os.getenv("DB_PORT", "5432"),
        user=os.getenv("DB_USER", "transcendence"),
        password=os.environ["DB_PASSWORD"],
        dbname=os.getenv("DB_NAME", "transcendence"),
        connect_timeout=int(os.getenv("ML_DB_CONNECT_TIMEOUT", "5")),
    )


@contextmanager
def db_connection():
    connection = get_db_connection()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def ensure_model_storage() -> None:
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    (MODEL_ROOT / "versions").mkdir(parents=True, exist_ok=True)
    if (MODEL_ROOT / "active.json").exists():
        return
    # A source checkout keeps its legacy artifact directly in ml_models. The
    # Docker named volume starts empty and is seeded from the immutable image.
    legacy_model = MODEL_ROOT / "racket_recommender.joblib"
    legacy_metadata = MODEL_ROOT / "model_metadata.json"
    if legacy_model.exists():
        version = "1.0.0"
        try:
            version = str(
                json.loads(legacy_metadata.read_text(encoding="utf-8")).get(
                    "version",
                    version,
                )
            )
        except (OSError, ValueError, TypeError):
            pass
        _activate_manifest(
            version,
            model_path="racket_recommender.joblib",
            metadata_path="model_metadata.json",
        )
        return
    seed_model = MODEL_SEED_DIR / "racket_recommender.joblib"
    seed_metadata = MODEL_SEED_DIR / "model_metadata.json"
    if not seed_model.exists():
        logger.warning("No baseline recommender artifact is available to seed")
        return
    version = "baseline-1.0.0"
    version_dir = MODEL_ROOT / "versions" / version
    version_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(seed_model, version_dir / "racket_recommender.joblib")
    if seed_metadata.exists():
        shutil.copy2(seed_metadata, version_dir / "model_metadata.json")
    else:
        _write_json(
            version_dir / "model_metadata.json",
            {"model_name": "racket_recommender", "version": "1.0.0"},
        )
    _activate_manifest(version)


def requeue_interrupted_runs() -> None:
    with db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE ml_training_runs
                SET status = 'queued', progress = 0, stage = 'Queued',
                    started_at = NULL, error_message = NULL
                WHERE status = 'running'
                """
            )


def claim_next_training_run() -> Optional[int]:
    with db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM ml_training_runs
                WHERE status = 'queued'
                ORDER BY id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """
            )
            row = cursor.fetchone()
            if row is None:
                return None
            run_id = int(row[0])
            cursor.execute(
                """
                UPDATE ml_training_runs
                SET status = 'running', progress = 10,
                    stage = 'Loading baseline data',
                    started_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (run_id,),
            )
            return run_id


def _update_stage(run_id: int, progress: int, stage: str) -> None:
    with db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE ml_training_runs
                SET progress = %s, stage = %s
                WHERE id = %s AND status = 'running'
                """,
                (progress, stage, run_id),
            )


def _load_feedback() -> pd.DataFrame:
    query = """
        SELECT
            age_group, gender, experience_level, play_style, budget_range,
            weight_category AS "weightCategory",
            flexibility_category AS "flexibilityCategory",
            balance_category AS "balanceCategory",
            'transaction_survey' AS source,
            'survey:' || id::text AS source_id
        FROM recommendation_training_feedback
        ORDER BY id
    """
    with db_connection() as conn:
        return pd.read_sql_query(query, conn)


def _evaluate(
    pipeline: Pipeline,
    x_test: pd.DataFrame,
    y_test: pd.DataFrame,
) -> Dict[str, Any]:
    predictions = pipeline.predict(x_test)
    prediction_frame = pd.DataFrame(predictions, columns=TARGET_COLUMNS)
    metrics: Dict[str, Any] = {}
    for target in TARGET_COLUMNS:
        metrics[target] = {
            "accuracy": round(
                float(accuracy_score(y_test[target], prediction_frame[target])),
                4,
            )
        }
    exact_match = (
        prediction_frame.values == y_test[TARGET_COLUMNS].values
    ).all(axis=1).mean()
    metrics["exact_match_accuracy"] = round(float(exact_match), 4)
    return metrics


def run_training_job(run_id: int) -> None:
    temporary_dir: Optional[Path] = None
    try:
        baseline = pd.read_csv(BASELINE_DATASET_PATH)
        required = FEATURE_COLUMNS + TARGET_COLUMNS
        missing = [column for column in required if column not in baseline.columns]
        if missing:
            raise ValueError(f"Baseline dataset is missing columns: {missing}")
        baseline = baseline[required].dropna().reset_index(drop=True)
        baseline["source"] = "synthetic"
        baseline["source_id"] = [
            f"synthetic:{index}" for index in range(1, len(baseline) + 1)
        ]

        _update_stage(run_id, 25, "Loading transaction surveys")
        feedback = _load_feedback()
        combined = pd.concat(
            [baseline[SNAPSHOT_COLUMNS], feedback[SNAPSHOT_COLUMNS]],
            ignore_index=True,
        )

        _update_stage(run_id, 40, "Building combined snapshot")
        version = (
            f"model-{run_id}-"
            f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        )
        versions_dir = MODEL_ROOT / "versions"
        versions_dir.mkdir(parents=True, exist_ok=True)
        temporary_dir = Path(
            tempfile.mkdtemp(prefix=f".{version}-", dir=str(versions_dir))
        )
        snapshot_path = temporary_dir / "training_snapshot.csv"
        combined.to_csv(snapshot_path, index=False)
        dataset_sha256 = _sha256(snapshot_path)

        _update_stage(run_id, 55, "Training random forest")
        pipeline = build_pipeline()
        x = combined[FEATURE_COLUMNS]
        y = combined[TARGET_COLUMNS]
        x_train, x_test, y_train, y_test = train_test_split(
            x,
            y,
            test_size=0.2,
            random_state=42,
        )
        pipeline.fit(x_train, y_train)

        _update_stage(run_id, 75, "Evaluating candidate")
        metrics = _evaluate(pipeline, x_test, y_test)
        # Evaluation trains the candidate on the training split. Refit on every
        # available row before exporting the production demonstration artifact.
        pipeline.fit(combined[FEATURE_COLUMNS], combined[TARGET_COLUMNS])

        _update_stage(run_id, 90, "Saving and validating joblib")
        model_path = temporary_dir / "racket_recommender.joblib"
        joblib.dump(pipeline, model_path)
        artifact_sha256 = _sha256(model_path)
        loaded = joblib.load(model_path)
        contract_prediction = loaded.predict(combined[FEATURE_COLUMNS].head(1))
        if len(contract_prediction) != 1 or len(contract_prediction[0]) != len(
            TARGET_COLUMNS
        ):
            raise ValueError("Candidate model failed the three-output contract")

        metadata = {
            "model_name": "racket_recommender",
            "model_type": "MultiOutput Random Forest Classifier",
            "version": version,
            "features": FEATURE_COLUMNS,
            "outputs": TARGET_COLUMNS,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "synthetic_rows": int(len(baseline)),
            "survey_rows": int(len(feedback)),
            "training_rows": int(len(combined)),
            "dataset_sha256": dataset_sha256,
            "artifact_sha256": artifact_sha256,
            "metrics": metrics,
            "confidence_calibrated": False,
            "runtime": {
                "python": platform.python_version(),
                "scikit_learn": sklearn.__version__,
                "pandas": pd.__version__,
                "joblib": joblib.__version__,
            },
        }
        _write_json(temporary_dir / "model_metadata.json", metadata)

        final_dir = versions_dir / version
        os.replace(temporary_dir, final_dir)
        temporary_dir = None
        _activate_manifest(version)
        clear_model_cache()

        with db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE ml_training_runs SET is_active = FALSE WHERE is_active"
                )
                cursor.execute(
                    """
                    UPDATE ml_training_runs
                    SET status = 'succeeded', progress = 100, stage = 'Activated',
                        synthetic_rows = %s, survey_rows = %s, total_rows = %s,
                        model_version = %s, metrics = %s::jsonb,
                        dataset_sha256 = %s, artifact_sha256 = %s,
                        error_message = NULL, is_active = TRUE,
                        finished_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                    """,
                    (
                        len(baseline),
                        len(feedback),
                        len(combined),
                        version,
                        json.dumps(metrics),
                        dataset_sha256,
                        artifact_sha256,
                        run_id,
                    ),
                )
        logger.info("Activated retrained racket model version=%s", version)
    except Exception as exc:
        logger.exception("ML retraining run %s failed", run_id)
        if temporary_dir is not None:
            shutil.rmtree(temporary_dir, ignore_errors=True)
        try:
            with db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE ml_training_runs
                        SET status = 'failed', stage = 'Failed',
                            error_message = %s, finished_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                        """,
                        (f"Retraining failed: {type(exc).__name__}", run_id),
                    )
        except Exception:
            logger.exception("Could not record failed ML retraining run")


async def training_worker() -> None:
    try:
        await asyncio.to_thread(requeue_interrupted_runs)
    except Exception:
        logger.warning("Could not requeue interrupted ML runs; will retry polling")
    while True:
        try:
            run_id = await asyncio.to_thread(claim_next_training_run)
            if run_id is None:
                await asyncio.sleep(1)
                continue
            await asyncio.to_thread(run_training_job, run_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("ML training worker poll failed: %s", type(exc).__name__)
            await asyncio.sleep(2)


def _activate_manifest(
    version: str,
    model_path: Optional[str] = None,
    metadata_path: Optional[str] = None,
) -> None:
    manifest = {
        "version": version,
        "model_path": model_path
        or f"versions/{version}/racket_recommender.joblib",
        "metadata_path": metadata_path
        or f"versions/{version}/model_metadata.json",
        "activated_at": datetime.now(timezone.utc).isoformat(),
    }
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = MODEL_ROOT / ".active.json.tmp"
    _write_json(temporary, manifest)
    os.replace(temporary, MODEL_ROOT / "active.json")


def _write_json(path: Path, value: Dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
