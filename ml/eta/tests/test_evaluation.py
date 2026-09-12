import json
import math
from pathlib import Path
import sys
import unittest

from evaluate import evaluate_eta, evaluate_cohorts, prediction_evaluation, generalization_diagnostics


class EvaluationTests(unittest.TestCase):
    def test_shared_metric_fixture(self):
        fixture = json.loads((Path(__file__).resolve().parents[1] / "fixtures/metrics-parity.json").read_text())
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                result = evaluate_eta(case["observations"])
                expected = case["expected"]
                self.assertEqual(set(result), set(expected))
                for key in expected:
                    if key == "metrics":
                        self.assertEqual(set(result[key]), set(expected[key]))
                        for name, value in expected[key].items():
                            self.assertLessEqual(abs(result[key][name] - value), fixture["absoluteTolerance"])
                    else:
                        self.assertEqual(result[key], expected[key])

    def test_p90_and_even_median(self):
        metrics = evaluate_eta([dict(actualMinutes=i, predictedMinutes=0) for i in range(1, 11)])["metrics"]
        self.assertEqual(metrics["p90AbsoluteError"], 9)
        self.assertEqual(metrics["medianAbsoluteError"], 5.5)
        self.assertEqual(metrics["p90SignedLateness"], 9)
        self.assertEqual(metrics["p90LateMinutes"], 9)

    def test_negative_lateness_and_exact(self):
        metrics = evaluate_eta([dict(actualMinutes=10, predictedMinutes=p) for p in (20, 30)])["metrics"]
        self.assertEqual(metrics["medianSignedLateness"], -15)
        self.assertEqual(metrics["p90SignedLateness"], -10)
        self.assertEqual(metrics["p90LateMinutes"], 0)
        exact = evaluate_eta([dict(actualMinutes=10, predictedMinutes=10)])["metrics"]
        self.assertEqual(exact["rmse"], 0)
        self.assertEqual(exact["withinPredictedEtaRate"], 1)

    def test_invalid_rows_counted(self):
        for actual, predicted in ((0, 1), (-1, 1), (float("nan"), 1), (1, float("inf")), (1, -1), (True, 1), (1, "1")):
            result = evaluate_eta([dict(actualMinutes=actual, predictedMinutes=predicted)])
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["excludedCount"], 1)

    def test_extreme_finite_metrics(self):
        metrics = evaluate_eta([dict(actualMinutes=sys.float_info.max, predictedMinutes=0)] * 2)["metrics"]
        self.assertTrue(all(math.isfinite(value) for value in metrics.values()))
        self.assertEqual(metrics["mae"], sys.float_info.max)

    def test_invalid_model_predictions_not_clipped(self):
        rows = [dict(actualDurationMinutes=10)] * 4
        result = prediction_evaluation(rows, [-1, 0, float("inf"), 10], model=True)
        self.assertEqual(result["invalidPredictionCount"], 3)
        self.assertEqual(result["predictionAvailability"], 0.25)
        self.assertEqual(result["evaluation"]["sampleCount"], 2)

    def test_common_cohort_baselines(self):
        rows = [dict(actualDurationMinutes=10, distanceBaselineMinutes=5, quotedEtaMinutes=None),
                dict(actualDurationMinutes=20, distanceBaselineMinutes=10, quotedEtaMinutes=21)]
        result = evaluate_cohorts(rows, [11, 22], 15)
        self.assertEqual(result["fullCohort"]["sampleCount"], 2)
        common = result["quoteCommonCohort"]
        self.assertEqual(common["sampleCount"], 1)
        for key in ("ridge", "distance", "median", "quotedEta"):
            self.assertEqual(common[key]["evaluation"]["sampleCount"], 1)
        self.assertEqual(common["quotedEta"]["evaluation"]["metrics"]["mae"], 1)
        self.assertEqual(result["fullCohort"]["distance"]["evaluation"]["metrics"]["mae"], 7.5)
        self.assertEqual(result["fullCohort"]["median"]["evaluation"]["metrics"]["mae"], 5)

    def test_empty_quote_and_test(self):
        result = evaluate_cohorts([], [], 15)
        self.assertEqual(result["quoteCommonCohort"]["ridge"]["evaluation"]["status"], "unavailable")
        self.assertIsNone(result["fullCohort"]["ridge"]["predictionAvailability"])

    def test_aggregate_diagnostics(self):
        row = dict(distanceKm=2, itemCount=2, hourOfDay=12, dayOfWeek=0, actualDurationMinutes=20)
        result = generalization_diagnostics(dict(train=[row], validation=[], test=[{**row, "distanceKm": 3, "itemCount": 1}]))
        self.assertEqual(result["testOutsideTrainingRanges"]["distanceKm"]["above"], 1)
        self.assertEqual(result["testOutsideTrainingRanges"]["itemCount"]["below"], 1)
        self.assertEqual(result["train"]["weekdayCounts"][0], 1)
