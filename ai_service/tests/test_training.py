import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import recommender
import training


class NamedModel:
    def __init__(self, name):
        self.name = name


class RecordingCursor:
    def __init__(self, executions):
        self.executions = executions

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, args=None):
        self.executions.append((query, args))


class RecordingConnection:
    def __init__(self, executions):
        self.executions = executions

    def cursor(self):
        return RecordingCursor(self.executions)


class TrainingTests(unittest.TestCase):
    def test_pipeline_keeps_existing_feature_and_output_contract(self):
        rows = []
        for index in range(20):
            rows.append(
                {
                    "age_group": "18-25" if index % 2 else "26-35",
                    "gender": "male" if index % 3 else "female",
                    "experience_level": "1-3_years",
                    "play_style": "attacking" if index % 2 else "balanced",
                    "budget_range": "200-400",
                    "weightCategory": "4U" if index % 2 else "5U",
                    "flexibilityCategory": "Medium Flex",
                    "balanceCategory": "Head Heavy" if index % 2 else "Even Balance",
                }
            )
        frame = pd.DataFrame(rows)
        pipeline = training.build_pipeline()
        pipeline.fit(
            frame[training.FEATURE_COLUMNS],
            frame[training.TARGET_COLUMNS],
        )
        prediction = pipeline.predict(frame[training.FEATURE_COLUMNS].head(1))
        self.assertEqual(len(prediction[0]), 3)

    def test_model_manager_reloads_when_active_version_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for version in ("one", "two"):
                version_dir = root / "versions" / version
                version_dir.mkdir(parents=True)
                (version_dir / "racket_recommender.joblib").write_bytes(b"fixture")
                (version_dir / "model_metadata.json").write_text(
                    json.dumps({"version": version}),
                    encoding="utf-8",
                )

            def activate(version):
                (root / "active.json").write_text(
                    json.dumps(
                        {
                            "version": version,
                            "model_path": f"versions/{version}/racket_recommender.joblib",
                            "metadata_path": f"versions/{version}/model_metadata.json",
                        }
                    ),
                    encoding="utf-8",
                )

            activate("one")
            with patch.object(recommender, "MODEL_DIR", str(root)), patch.object(
                recommender.joblib,
                "load",
                side_effect=[NamedModel("one"), NamedModel("two")],
            ):
                recommender.clear_model_cache()
                first = recommender.load_model()
                activate("two")
                second = recommender.load_model()

            self.assertEqual(first.name, "one")
            self.assertEqual(second.name, "two")

    def test_active_manifest_rejects_paths_outside_model_root(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            recommender,
            "MODEL_DIR",
            directory,
        ):
            Path(directory, "active.json").write_text(
                json.dumps(
                    {
                        "version": "unsafe",
                        "model_path": "../outside.joblib",
                        "metadata_path": "../outside.json",
                    }
                ),
                encoding="utf-8",
            )
            model_path, _, key = recommender._resolve_active_paths()
            self.assertEqual(model_path, recommender.MODEL_PATH)
            self.assertEqual(key[0], "legacy")

    def test_training_job_combines_feedback_and_creates_active_artifact(self):
        feedback = pd.DataFrame(
            [
                {
                    "age_group": "18-25",
                    "gender": "prefer_not_to_say",
                    "experience_level": "1-3_years",
                    "play_style": "attacking",
                    "budget_range": "200-400",
                    "weightCategory": "4U",
                    "flexibilityCategory": "Medium Flex",
                    "balanceCategory": "Head Heavy",
                    "source": "transaction_survey",
                    "source_id": "survey:1",
                }
            ]
        )
        stages = []
        executions = []

        @contextmanager
        def fake_db_connection():
            yield RecordingConnection(executions)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            training,
            "MODEL_ROOT",
            Path(directory),
        ), patch.object(
            training,
            "_load_feedback",
            return_value=feedback,
        ), patch.object(
            training,
            "_update_stage",
            side_effect=lambda _run, progress, stage: stages.append(
                (progress, stage)
            ),
        ), patch.object(
            training,
            "db_connection",
            fake_db_connection,
        ):
            training.run_training_job(8)
            manifest = json.loads(
                Path(directory, "active.json").read_text(encoding="utf-8")
            )
            version_dir = Path(directory, "versions", manifest["version"])
            snapshot = pd.read_csv(version_dir / "training_snapshot.csv")
            candidate = training.joblib.load(
                version_dir / "racket_recommender.joblib"
            )
            prediction = candidate.predict(
                snapshot[training.FEATURE_COLUMNS].tail(1)
            )

        self.assertEqual(len(snapshot), 1001)
        self.assertEqual(snapshot.iloc[-1]["source"], "transaction_survey")
        self.assertEqual(len(prediction[0]), 3)
        self.assertEqual(
            [progress for progress, _ in stages],
            [25, 40, 55, 75, 90],
        )
        self.assertTrue(
            any("status = 'succeeded'" in query for query, _ in executions)
        )


if __name__ == "__main__":
    unittest.main()
