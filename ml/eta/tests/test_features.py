import json
from pathlib import Path
import unittest

from features import encode_checkout_features, FEATURE_CONTRACT_VERSION, ORDERED_FEATURES


class FeatureTests(unittest.TestCase):
    def test_shared_parity(self):
        root = Path(__file__).resolve().parents[1]
        fixture = json.loads((root / "fixtures/feature-parity.json").read_text())
        contract = json.loads((root / "feature-contract.json").read_text())
        self.assertEqual(FEATURE_CONTRACT_VERSION, contract["featureContractVersion"])
        self.assertEqual(FEATURE_CONTRACT_VERSION, fixture["featureContractVersion"])
        self.assertEqual(list(ORDERED_FEATURES), contract["orderedFeatures"])
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                vector = encode_checkout_features(case["raw"])
                self.assertEqual(len(vector), 10)
                for actual, expected in zip(vector, case["expected"]):
                    self.assertLessEqual(abs(actual - expected), fixture["absoluteTolerance"])

    def test_invalid_fields(self):
        base = dict(distanceKm=5, itemCount=2, hourOfDay=12, dayOfWeek=1)
        invalid = {
            "distanceKm": [-1, float("nan"), float("inf"), -float("inf"), "5", True, None],
            "itemCount": [0, -1, 1.5, True, float("inf"), "2"],
            "hourOfDay": [-1, 24, 1.5, None, True], "dayOfWeek": [-1, 7, 1.5, "1", True],
        }
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    encode_checkout_features({**base, key: value})

    def test_strict_shape_and_no_leakage(self):
        base = dict(distanceKm=5, itemCount=2, hourOfDay=12, dayOfWeek=1)
        for key in ("quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes", "split", "orderId", "workload", "batched"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "invalid_shape"):
                encode_checkout_features({**base, key: 1})
        for value in (None, [], {}, {"distanceKm": 1}):
            with self.assertRaises(ValueError):
                encode_checkout_features(value)

    def test_deterministic_and_immutable(self):
        row = dict(distanceKm=5.25, itemCount=2.0, hourOfDay=12.0, dayOfWeek=1.0)
        before = json.dumps(row)
        self.assertEqual(encode_checkout_features(row), encode_checkout_features(row))
        self.assertEqual(json.dumps(row), before)
