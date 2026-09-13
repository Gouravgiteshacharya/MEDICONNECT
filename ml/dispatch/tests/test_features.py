import json
import math
from pathlib import Path
import unittest
from features import encode_dispatch_features, ORDERED_FEATURES, FEATURE_CONTRACT_VERSION

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class FeatureTests(unittest.TestCase):
    def test_shared_fixture(self):
        fixture = json.loads((FIXTURES / "feature-parity.json").read_text())
        self.assertEqual(fixture["featureContractVersion"], FEATURE_CONTRACT_VERSION)
        self.assertEqual(fixture["orderedFeatures"], list(ORDERED_FEATURES))
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                actual = encode_dispatch_features(case["raw"])
                for a, b in zip(actual, case["encoded"]):
                    self.assertAlmostEqual(a, b, delta=fixture["tolerance"])
                self.assertEqual(actual, encode_dispatch_features(case["raw"]))

    def test_exact_order(self):
        self.assertEqual(ORDERED_FEATURES, ("riderDistanceKm", "activeWorkload", "hourSin", "hourCos", "isMonday", "isTuesday", "isWednesday", "isThursday", "isFriday", "isSaturday"))
        contract = json.loads((FIXTURES.parent / "feature-contract.json").read_text())
        self.assertEqual(contract["orderedFeatures"], list(ORDERED_FEATURES))

    def test_invalid_features(self):
        valid = dict(riderDistanceKm=0, activeWorkload=0, hourOfDay=0, dayOfWeek=0)
        for raw in (None, [], {}, {**valid, "accepted": True}):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "invalid_shape"):
                encode_dispatch_features(raw)
        invalid = {"riderDistanceKm": [-1, True, "1", None, math.inf, math.nan, 10**400],
                   "activeWorkload": [-1, .5, True, "1", math.inf],
                   "hourOfDay": [-1, 24, .5, False, "0"], "dayOfWeek": [-1, 7, .5, False, "0"]}
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    encode_dispatch_features({**valid, key: value})

    def test_sunday_and_weekdays(self):
        for day in range(7):
            x = encode_dispatch_features(dict(riderDistanceKm=0, activeWorkload=0, hourOfDay=0, dayOfWeek=day))
            self.assertEqual(x[4:], [int(day == i) for i in range(1, 7)])

    def test_hour_cycle(self):
        for hour, expected in [(0, (0, 1)), (6, (1, 0)), (12, (0, -1)), (18, (-1, 0))]:
            x = encode_dispatch_features(dict(riderDistanceKm=0, activeWorkload=0, hourOfDay=hour, dayOfWeek=0))
            for a, b in zip(x[2:4], expected):
                self.assertAlmostEqual(a, b)
