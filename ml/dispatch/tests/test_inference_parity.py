"""Manual portable inference: standard library and feature encoder only, no sklearn."""
import json
import math
from pathlib import Path
import unittest
from features import encode_dispatch_features

ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = ROOT / "backend/test/fixtures/dispatch-model-artifact.synthetic.test.json"
PARITY = ROOT / "ml/dispatch/fixtures/prediction-parity.json"


def manual_probability(artifact, raw):
    encoded = encode_dispatch_features(raw)
    z = sum((x-m)/s*w for x,m,s,w in zip(encoded, artifact["preprocessing"]["means"],
            artifact["preprocessing"]["scales"], artifact["coefficients"])) + artifact["intercept"]
    return 1/(1+math.exp(-z)) if z >= 0 else math.exp(z)/(1+math.exp(z))


class InferenceParityTests(unittest.TestCase):
    def test_manual_portable_parity(self):
        artifact = json.loads(ARTIFACT.read_text())
        fixture = json.loads(PARITY.read_text())
        self.assertEqual(artifact, fixture["artifact"])
        errors = []
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(case["modelVersion"], artifact["modelVersion"])
                p = manual_probability(artifact, case["rawFeatures"])
                self.assertTrue(math.isfinite(p) and 0 <= p <= 1)
                errors.append(abs(p - case["expectedAcceptanceProbability"]))
                self.assertLessEqual(errors[-1], 1e-12)
        print(f"Python portable parity max absolute difference: {max(errors):.17g}")

    def test_extreme_logits_and_test_provenance(self):
        artifact, fixture = json.loads(ARTIFACT.read_text()), json.loads(PARITY.read_text())
        self.assertEqual(artifact["trainingMetadata"]["dataProvenance"], "SYNTHETIC")
        self.assertIn("TEST-ONLY", artifact["modelVersion"])
        self.assertTrue(any(c["expectedLogit"] > 999 for c in fixture["cases"]))
        self.assertTrue(any(c["expectedLogit"] < -999 for c in fixture["cases"]))
        for case in fixture["cases"][-2:]:
            self.assertEqual(manual_probability(artifact, case["rawFeatures"]), 1 if case["expectedLogit"] > 0 else 0)
