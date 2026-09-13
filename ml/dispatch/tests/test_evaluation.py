import json
import math
from pathlib import Path
import unittest
from evaluate import metrics, calibration, generalization, stable_sigmoid
from features import encode_dispatch_features

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class EvaluationTests(unittest.TestCase):
    def test_metrics_fixture(self):
        fixture = json.loads((FIXTURES / "metrics-parity.json").read_text())
        actual = metrics(fixture["labels"], fixture["probabilities"])
        self.assertEqual(set(actual), set(fixture["expected"]))
        for key, value in fixture["expected"].items():
            with self.subTest(metric=key):
                self.assertAlmostEqual(actual[key], value, places=12)

    def test_single_class(self):
        m = metrics([False, False], [.1, .2])
        self.assertIsNone(m["rocAuc"])
        self.assertIsNone(m["averagePrecision"])
        self.assertIsNone(m["recallAt05"])
        self.assertIsNone(m["precisionAt05"])
        positive = metrics([True, True], [.8, .9])
        self.assertIsNone(positive["rocAuc"])
        self.assertEqual(positive["averagePrecision"], 1)

    def test_empty(self):
        m = metrics([], [])
        self.assertEqual(m.pop("sampleCount"), 0)
        self.assertTrue(all(v is None for v in m.values()))

    def test_calibration_boundaries(self):
        bins = calibration([False, True, False, True], [0, .1, .9, 1])
        self.assertEqual(len(bins), 10)
        self.assertEqual(sum(b["count"] for b in bins), 4)
        self.assertEqual(bins[0]["count"], 1)
        self.assertEqual(bins[1]["count"], 1)
        self.assertEqual(bins[9]["count"], 2)
        self.assertAlmostEqual(bins[9]["meanPredictedProbability"], .95)
        self.assertEqual(bins[9]["observedAcceptanceRate"], .5)
        self.assertIsNone(bins[2]["meanPredictedProbability"])

    def test_probability_bounds(self):
        for p in (-.01, 1.01, math.nan, math.inf, "0.5", True, None):
            for fn in (metrics, calibration):
                with self.subTest(p=p, fn=fn), self.assertRaises(ValueError):
                    fn([True], [p])
        self.assertTrue(math.isfinite(metrics([True, False], [0, 1])["logLoss"]))
        with self.assertRaises(ValueError):
            metrics([True], [])
        with self.assertRaises(ValueError):
            metrics([1], [.5])

    def test_extreme_logits(self):
        fixture = json.loads((FIXTURES / "metrics-parity.json").read_text())
        for case in fixture["extremeSigmoid"]:
            self.assertEqual(stable_sigmoid(case["logit"]), case["probability"])
        self.assertEqual(stable_sigmoid(-1000), 0)
        self.assertEqual(stable_sigmoid(1000), 1)
        for z in (math.inf, math.nan, True):
            with self.assertRaises(ValueError):
                stable_sigmoid(z)

    def test_prediction_fixture(self):
        f = json.loads((FIXTURES / "prediction-parity.json").read_text())
        a = f["artifact"]
        for case in f["cases"]:
            x = encode_dispatch_features(case["raw"])
            z = sum((v-m)/s*w for v,m,s,w in zip(x, a["preprocessing"]["means"], a["preprocessing"]["scales"], a["coefficients"])) + a["intercept"]
            self.assertAlmostEqual(stable_sigmoid(z), case["probability"], places=14)

    def test_generalization(self):
        row = dict(riderDistanceKm=1, activeWorkload=1, hourOfDay=0, dayOfWeek=0, accepted=True)
        d = generalization({"train": [row], "validation": [{**row, "riderDistanceKm": 2, "activeWorkload": 0}], "test": []})
        self.assertEqual(d["validation"]["riderDistanceKm"]["outsideTrainRange"], 1)
        self.assertEqual(d["validation"]["activeWorkload"]["outsideTrainRange"], 1)
        self.assertEqual(d["train"]["hourCoverage"], [0])
        self.assertIsNone(d["test"]["classPrevalence"])
