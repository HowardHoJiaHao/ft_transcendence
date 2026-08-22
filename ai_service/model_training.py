"""Canonical feature contract and estimator factory for RacketBot training."""

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.multioutput import MultiOutputClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

#input features for the racketbot model
FEATURE_COLUMNS = [
    "age_group",
    "gender",
    "experience_level",
    "play_style",
    "budget_range",
]
#expected output columns
TARGET_COLUMNS = [
    "weightCategory",
    "flexibilityCategory",
    "balanceCategory",
]


def build_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore"),
                FEATURE_COLUMNS,
            )
        ],
        remainder="drop",
    )
    model = MultiOutputClassifier(
        RandomForestClassifier(
            n_estimators=250,
            max_depth=None,
            min_samples_leaf=2,
            random_state=42,
            class_weight="balanced_subsample",
        )
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("model", model),
        ]
    )

# this file is the random forest tree definition for the racketbot trainning.
# this does not train or predict, only name column and later build sklearn pipeline