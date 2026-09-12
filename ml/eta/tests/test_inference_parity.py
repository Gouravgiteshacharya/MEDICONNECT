import json
from pathlib import Path
import unittest

from features import encode_checkout_features, ORDERED_FEATURES


class InferenceParityTests(unittest.TestCase):
    def test_portable_fixture_without_sklearn(self):
        eta = Path(__file__).resolve().parents[1]
        repository = eta.parents[1]
        artifact = json.loads((repository / "backend/test/fixtures/eta-model-artifact.synthetic.test.json").read_text())
        fixture = json.loads((eta / "fixtures/prediction-parity.json").read_text())
        self.assertEqual(artifact["modelVersion"], fixture["modelVersion"])
        self.assertEqual(artifact["orderedFeatures"], list(ORDERED_FEATURES))
        self.assertEqual(artifact["trainingMetadata"]["dataProvenance"], "SYNTHETIC")
        for case in fixture["cases"]:
            with self.subTest(raw=case["raw"]):
                encoded = encode_checkout_features(case["raw"])
                standardized = [(value - mean) / scale for value, mean, scale in zip(encoded, artifact["preprocessing"]["means"], artifact["preprocessing"]["scales"])]
                predicted = artifact["intercept"] + sum(coefficient * value for coefficient, value in zip(artifact["coefficients"], standardized))
                self.assertLessEqual(abs(predicted - case["expectedPrediction"]), fixture["absoluteTolerance"])
