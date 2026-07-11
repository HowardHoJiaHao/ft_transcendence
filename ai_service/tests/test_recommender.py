import unittest
from unittest.mock import patch

import recommender


VALID_PROFILE = {
    "age_group": "18-25",
    "gender": "prefer_not_to_say",
    "experience_level": "less_than_6_months",
    "play_style": "defensive",
    "budget_range": "200-400",
}


class FakeModel:
    def predict(self, _features):
        return [["5U", "High Flexibility", "Head Light"]]

    def predict_proba(self, _features):
        return [
            [[0.1, 0.9]],
            [[0.25, 0.75]],
            [[0.4, 0.6]],
        ]


class RecommenderTests(unittest.TestCase):
    def test_profile_validation_accepts_model_style_aliases_case_insensitively(self):
        profile = dict(VALID_PROFILE)
        profile["play_style"] = "Defensive"
        normalized = recommender.validate_profile(profile)
        self.assertEqual(normalized["play_style"], "defensive")

    def test_profile_validation_rejects_missing_fields(self):
        with self.assertRaises(recommender.RecommendationProfileError):
            recommender.validate_profile({"age_group": "18-25"})

    def test_prediction_returns_separate_confidence(self):
        with patch.object(recommender, "load_model", return_value=FakeModel()), patch.object(
            recommender,
            "load_model_metadata",
            return_value={"model_name": "fixture", "version": "test"},
        ):
            result = recommender.predict_racket_specs(VALID_PROFILE)

        self.assertEqual(result["predictions"]["weightCategory"], "5U")
        self.assertEqual(
            result["confidence_by_output"],
            {
                "weightCategory": 0.9,
                "flexibilityCategory": 0.75,
                "balanceCategory": 0.6,
            },
        )
        self.assertNotIn("confidence", result)

    def test_committed_model_artifact_matches_runtime_contract(self):
        result = recommender.predict_racket_specs(VALID_PROFILE)
        self.assertEqual(set(result["predictions"]), set(recommender.OUTPUT_FIELDS))
        self.assertEqual(result["model"]["version"], "1.0.0")
        self.assertFalse(result["model"]["confidence_calibrated"])


if __name__ == "__main__":
    unittest.main()
