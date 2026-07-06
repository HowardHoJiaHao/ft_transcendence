#!/usr/bin/env python3
"""
Generate logical dummy training data for the RacketBot recommendation model.

The generated CSV follows the PRD fields for a button-based assessment:
- age_group
- gender
- experience_level
- play_style
- budget_range

Targets:
- weightCategory
- flexibilityCategory
- balanceCategory

The rules are intentionally obvious enough for a machine learning model to
learn, but include weighted randomness so the dataset feels natural instead of
perfectly deterministic.

Example:
    python docs/prd/generate_dummy_recommendation_data.py
    python docs/prd/generate_dummy_recommendation_data.py --rows 2000 --output /tmp/racket_data.csv
"""

from __future__ import annotations

import argparse
import csv
import random
from dataclasses import dataclass
from pathlib import Path


AGE_GROUPS = ["under_13", "13-17", "18-25", "26-35", "36-45", "46_plus"]
GENDERS = ["male", "female", "prefer_not_to_say"]
EXPERIENCE_LEVELS = [
    "less_than_6_months",
    "6_months_1_year",
    "1-3_years",
    "3-5_years",
    "more_than_5_years",
]
PLAY_STYLES = ["attacking", "defensive", "balanced", "not_sure"]
BUDGET_RANGES = ["under_200", "200-400", "400-700", "700_plus"]

WEIGHT_CATEGORIES = ["1U", "2U", "3U", "4U", "5U", "6U", "7U", "8U"]
FLEXIBILITY_CATEGORIES = ["Stiff Shaft", "Medium Flex", "High Flexibility"]
BALANCE_CATEGORIES = ["Head Heavy", "Even Balance", "Head Light"]

DEFAULT_OUTPUT = Path(__file__).with_name("dummy_racket_recommendation_data.csv")


@dataclass(frozen=True)
class Profile:
    age_group: str
    gender: str
    experience_level: str
    play_style: str
    budget_range: str


def weighted_choice(options: list[tuple[str, int]]) -> str:
    values = [value for value, _ in options]
    weights = [weight for _, weight in options]
    return random.choices(values, weights=weights, k=1)[0]


def generate_profile() -> Profile:
    """Generate a realistic user profile distribution."""
    age_group = weighted_choice(
        [
            ("under_13", 6),
            ("13-17", 18),
            ("18-25", 34),
            ("26-35", 24),
            ("36-45", 12),
            ("46_plus", 6),
        ]
    )

    gender = weighted_choice(
        [
            ("male", 54),
            ("female", 42),
            ("prefer_not_to_say", 4),
        ]
    )

    experience_by_age = {
        "under_13": [
            ("less_than_6_months", 30),
            ("6_months_1_year", 28),
            ("1-3_years", 30),
            ("3-5_years", 10),
            ("more_than_5_years", 2),
        ],
        "13-17": [
            ("less_than_6_months", 18),
            ("6_months_1_year", 24),
            ("1-3_years", 38),
            ("3-5_years", 16),
            ("more_than_5_years", 4),
        ],
        "18-25": [
            ("less_than_6_months", 12),
            ("6_months_1_year", 18),
            ("1-3_years", 36),
            ("3-5_years", 22),
            ("more_than_5_years", 12),
        ],
        "26-35": [
            ("less_than_6_months", 10),
            ("6_months_1_year", 16),
            ("1-3_years", 32),
            ("3-5_years", 24),
            ("more_than_5_years", 18),
        ],
        "36-45": [
            ("less_than_6_months", 12),
            ("6_months_1_year", 16),
            ("1-3_years", 28),
            ("3-5_years", 24),
            ("more_than_5_years", 20),
        ],
        "46_plus": [
            ("less_than_6_months", 18),
            ("6_months_1_year", 18),
            ("1-3_years", 26),
            ("3-5_years", 20),
            ("more_than_5_years", 18),
        ],
    }
    experience_level = weighted_choice(experience_by_age[age_group])

    if experience_level in ("less_than_6_months", "6_months_1_year"):
        play_style = weighted_choice(
            [
                ("not_sure", 42),
                ("balanced", 32),
                ("defensive", 14),
                ("attacking", 12),
            ]
        )
    elif age_group in ("under_13", "46_plus"):
        play_style = weighted_choice(
            [
                ("defensive", 34),
                ("balanced", 34),
                ("not_sure", 18),
                ("attacking", 14),
            ]
        )
    else:
        play_style = weighted_choice(
            [
                ("attacking", 34),
                ("balanced", 32),
                ("defensive", 24),
                ("not_sure", 10),
            ]
        )

    if experience_level in ("less_than_6_months", "6_months_1_year"):
        budget_range = weighted_choice(
            [
                ("under_200", 36),
                ("200-400", 42),
                ("400-700", 18),
                ("700_plus", 4),
            ]
        )
    elif experience_level == "1-3_years":
        budget_range = weighted_choice(
            [
                ("under_200", 16),
                ("200-400", 38),
                ("400-700", 34),
                ("700_plus", 12),
            ]
        )
    else:
        budget_range = weighted_choice(
            [
                ("under_200", 6),
                ("200-400", 24),
                ("400-700", 42),
                ("700_plus", 28),
            ]
        )

    return Profile(
        age_group=age_group,
        gender=gender,
        experience_level=experience_level,
        play_style=play_style,
        budget_range=budget_range,
    )


def experience_score(experience_level: str) -> int:
    return {
        "less_than_6_months": 0,
        "6_months_1_year": 1,
        "1-3_years": 2,
        "3-5_years": 3,
        "more_than_5_years": 4,
    }[experience_level]


def budget_score(budget_range: str) -> int:
    return {
        "under_200": 0,
        "200-400": 1,
        "400-700": 2,
        "700_plus": 3,
    }[budget_range]


def age_strength_bias(age_group: str) -> int:
    """Rough common-sense proxy for handling heavier rackets."""
    return {
        "under_13": -2,
        "13-17": -1,
        "18-25": 1,
        "26-35": 1,
        "36-45": 0,
        "46_plus": -1,
    }[age_group]


def recommend_weight(profile: Profile) -> str:
    exp = experience_score(profile.experience_level)
    budget = budget_score(profile.budget_range)
    strength = age_strength_bias(profile.age_group)

    if exp <= 1:
        options = [
            ("5U", 26),
            ("6U", 30),
            ("7U", 22),
            ("4U", 12),
            ("8U", 8),
            ("3U", 2),
        ]
    elif exp == 2:
        options = [
            ("4U", 34),
            ("5U", 25),
            ("3U", 14),
            ("6U", 16),
            ("7U", 7),
            ("2U", 2),
            ("8U", 2),
        ]
    else:
        options = [
            ("3U", 30),
            ("4U", 30),
            ("5U", 16),
            ("2U", 10),
            ("6U", 8),
            ("1U", 3),
            ("7U", 3),
        ]

    if profile.play_style == "attacking" and exp >= 2:
        options.extend([("3U", 16), ("4U", 10), ("2U", 5)])
    elif profile.play_style == "defensive":
        options.extend([("5U", 14), ("6U", 13), ("7U", 8)])
    elif profile.play_style == "balanced":
        options.extend([("4U", 14), ("5U", 10)])

    if strength <= -1:
        options.extend([("5U", 12), ("6U", 12), ("7U", 8)])
    elif strength >= 1 and exp >= 2:
        options.extend([("3U", 8), ("4U", 8)])

    if budget >= 2 and exp >= 2:
        options.extend([("3U", 4), ("4U", 6), ("5U", 3)])

    return weighted_choice(options)


def recommend_flex(profile: Profile) -> str:
    exp = experience_score(profile.experience_level)

    if exp <= 1:
        options = [
            ("High Flexibility", 46),
            ("Medium Flex", 42),
            ("Stiff Shaft", 12),
        ]
    elif exp == 2:
        options = [
            ("Medium Flex", 50),
            ("High Flexibility", 25),
            ("Stiff Shaft", 25),
        ]
    else:
        options = [
            ("Stiff Shaft", 44),
            ("Medium Flex", 40),
            ("High Flexibility", 16),
        ]

    if profile.play_style == "attacking" and exp >= 2:
        options.extend([("Stiff Shaft", 20), ("Medium Flex", 8)])
    elif profile.play_style == "defensive":
        options.extend([("Medium Flex", 16), ("High Flexibility", 10)])
    elif profile.play_style == "not_sure":
        options.extend([("Medium Flex", 16), ("High Flexibility", 16)])

    if profile.age_group in ("under_13", "46_plus"):
        options.extend([("High Flexibility", 12), ("Medium Flex", 10)])

    return weighted_choice(options)


def recommend_balance(profile: Profile) -> str:
    exp = experience_score(profile.experience_level)

    if exp <= 1:
        options = [
            ("Even Balance", 42),
            ("Head Light", 40),
            ("Head Heavy", 18),
        ]
    else:
        options = [
            ("Even Balance", 36),
            ("Head Heavy", 34),
            ("Head Light", 30),
        ]

    if profile.play_style == "attacking":
        options.extend([("Head Heavy", 28), ("Even Balance", 8)])
    elif profile.play_style == "defensive":
        options.extend([("Head Light", 28), ("Even Balance", 8)])
    elif profile.play_style == "balanced":
        options.extend([("Even Balance", 28)])
    elif profile.play_style == "not_sure":
        options.extend([("Even Balance", 22), ("Head Light", 10)])

    if profile.age_group in ("under_13", "46_plus"):
        options.extend([("Head Light", 12), ("Even Balance", 8)])

    return weighted_choice(options)


def suitability_note(profile: Profile, weight: str, flex: str, balance: str) -> str:
    reasons = []

    if profile.experience_level in ("less_than_6_months", "6_months_1_year"):
        reasons.append("beginner-friendly handling")
    elif profile.experience_level in ("3-5_years", "more_than_5_years"):
        reasons.append("supports experienced technique")
    else:
        reasons.append("balanced upgrade path")

    if profile.play_style == "attacking":
        reasons.append("extra power for attacking play")
    elif profile.play_style == "defensive":
        reasons.append("fast response for defensive rallies")
    elif profile.play_style == "balanced":
        reasons.append("versatile all-round setup")
    else:
        reasons.append("safe choice while play style develops")

    reasons.append(f"{weight}, {flex}, {balance}")
    return "; ".join(reasons)


def generate_row(row_id: int) -> dict[str, str]:
    profile = generate_profile()
    weight = recommend_weight(profile)
    flex = recommend_flex(profile)
    balance = recommend_balance(profile)

    return {
        "id": str(row_id),
        "age_group": profile.age_group,
        "gender": profile.gender,
        "experience_level": profile.experience_level,
        "play_style": profile.play_style,
        "budget_range": profile.budget_range,
        "weightCategory": weight,
        "flexibilityCategory": flex,
        "balanceCategory": balance,
        "suitability_note": suitability_note(profile, weight, flex, balance),
    }


def write_csv(output: Path, rows: int, seed: int) -> None:
    random.seed(seed)
    output.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "id",
        "age_group",
        "gender",
        "experience_level",
        "play_style",
        "budget_range",
        "weightCategory",
        "flexibilityCategory",
        "balanceCategory",
        "suitability_note",
    ]

    with output.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for row_id in range(1, rows + 1):
            writer.writerow(generate_row(row_id))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate dummy racket recommendation training data."
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=1000,
        help="Number of rows to generate. Default: 1000.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output CSV path. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible data. Default: 42.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.rows <= 0:
        raise SystemExit("--rows must be greater than 0")

    write_csv(args.output, args.rows, args.seed)
    print(f"Generated {args.rows} rows: {args.output}")


if __name__ == "__main__":
    main()
