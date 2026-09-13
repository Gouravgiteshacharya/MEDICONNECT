import copy
import hashlib
import inspect
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from sklearn.linear_model import LogisticRegression
import train
from train import (fit_preprocessing, select_model, tie_key, constant_rate, train_and_evaluate,
                   DEFAULT_C, probabilities, logistic_factory, matrix)
from model_io import load_dataset, json_bytes, validate_artifact, write_outputs, strict_json
from synthetic import generate, write_dataset
from test_synthetic import config


class TrainingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        payload, cls.manifest = generate(config())
        cls.rows = [json.loads(s) for s in payload.splitlines()]
        cls.parts = {s: [r for r in cls.rows if r["split"] == s] for s in ("train", "validation", "test")}

    def run_training(self, rows=None):
        return train_and_evaluate(self.rows if rows is None else rows, self.manifest,
            model_version="test-only", git_commit="fixture", trained_at="2026-05-02T00:00:00Z")

    def test_train_only_scaler(self):
        rows = [dict(riderDistanceKm=d, activeWorkload=0, hourOfDay=0, dayOfWeek=0) for d in (0, 2)]
        means, scales = fit_preprocessing(rows)
        self.assertEqual(means[0], 1)
        self.assertEqual(scales[0], 1)  # Population, not sample SD.
        np.testing.assert_array_equal(scales[1:], np.ones(9))
        selected = select_model(self.parts["train"], self.parts["validation"])
        np.testing.assert_allclose(selected.means, matrix(self.parts["train"]).mean(axis=0))
        altered = [{**r, "riderDistanceKm": 10000} for r in self.parts["validation"]]
        other = select_model(self.parts["train"], altered)
        np.testing.assert_array_equal(selected.means, other.means)
        np.testing.assert_array_equal(selected.scales, other.scales)

    def test_c_candidates_and_no_refit(self):
        calls = []
        class RecordingModel:
            def __init__(self, c):
                self.inner, self.c = logistic_factory(c), c
            def fit(self, x, y):
                calls.append((self.c, x.copy(), y.copy()))
                self.inner.fit(x, y)
                self.coef_, self.intercept_, self.classes_ = self.inner.coef_, self.inner.intercept_, self.inner.classes_
                return self
        selection = select_model(self.parts["train"], self.parts["validation"], model_factory=RecordingModel)
        self.assertEqual([c for c, _, _ in calls], list(DEFAULT_C))
        self.assertTrue(all(len(x) == len(self.parts["train"]) for _, x, _ in calls))
        self.assertEqual(len(selection.candidates), 5)
        self.assertIsNotNone(selection.model)
        coefficients = selection.model.coef_.copy()
        probabilities(selection.model, self.parts["test"], selection.means, selection.scales)
        np.testing.assert_array_equal(coefficients, selection.model.coef_)
        self.assertEqual(len(calls), 5)

    def test_validation_selection(self):
        s = select_model(self.parts["train"], self.parts["validation"])
        expected = min((c for c in s.candidates if c["passedGuardrails"]), key=tie_key)
        self.assertEqual(s.selected_c, expected["C"])
        baseline = train.metrics([r["accepted"] for r in self.parts["validation"]], [s.baseline_rate] * len(self.parts["validation"]))
        self.assertLess(expected["validation"]["logLoss"], baseline["logLoss"])
        self.assertLessEqual(expected["validation"]["brier"], baseline["brier"] + .01)

    def test_tie_break_order(self):
        def c(loss, brier, ap, regularization):
            return {"C": regularization, "validation": {"logLoss": loss, "brier": brier, "averagePrecision": ap}}
        expected = c(.3, .2, .8, .01)
        cases = [c(.4, .1, .9, .001), c(.3, .3, .9, .001), c(.3, .2, .7, .001), c(.3, .2, .8, 1), expected]
        self.assertEqual(min(reversed(cases), key=tie_key), expected)

    def test_test_excluded_structurally_and_behaviorally(self):
        params = inspect.signature(select_model).parameters
        self.assertEqual(list(params), ["train", "validation", "c_values", "model_factory"])
        source = inspect.getsource(select_model)
        self.assertNotIn('splits["test"]', source)
        events = []
        real_select, real_metrics = train.select_model, train.metrics
        def selecting(*args, **kwargs):
            result = real_select(*args, **kwargs)
            events.append("frozen")
            return result
        test_count = len(self.parts["test"])
        def evaluating(labels, pred):
            if len(labels) == test_count:
                self.assertIn("frozen", events)
                events.append("test")
            return real_metrics(labels, pred)
        with patch.object(train, "select_model", side_effect=selecting), patch.object(train, "metrics", side_effect=evaluating):
            _, artifact = self.run_training()
        self.assertIn("test", events)
        changed = [{**r, "accepted": not r["accepted"], "riderDistanceKm": 100} if r["split"] == "test" else r for r in self.rows]
        _, other = self.run_training(changed)
        for key in ("coefficients", "intercept", "preprocessing"):
            self.assertEqual(artifact[key], other[key])

    def test_constant_baseline_train_only(self):
        report, _ = self.run_training()
        expected = constant_rate(self.parts["train"])
        self.assertEqual(report["constantTrainAcceptanceRate"], expected)
        self.assertEqual(constant_rate([{"accepted": True}, {"accepted": False}, {"accepted": True}]), 2/3)
        changed = [{**r, "accepted": True} if r["split"] != "train" else r for r in self.rows]
        other, _ = self.run_training(changed)
        self.assertEqual(other["constantTrainAcceptanceRate"], expected)

    def test_artifact_and_report(self):
        report, artifact = self.run_training()
        self.assertEqual(report["modelSelectionStatus"], "MODEL_SELECTED")
        self.assertEqual(validate_artifact(artifact), artifact)
        self.assertEqual(len(artifact["coefficients"]), 10)
        self.assertTrue(all(s > 0 for s in artifact["preprocessing"]["scales"]))
        self.assertEqual(artifact["trainingMetadata"]["trainingRows"], len(self.parts["train"]))
        self.assertIsNone(report["deterministicBaseline"]["offeredRiderRankDistribution"])
        for forbidden in ('"rowKey"', '"orderGroupKey"', '"riderId"', '"rows"'):
            self.assertNotIn(forbidden, json.dumps([report, artifact]))
        with tempfile.TemporaryDirectory() as tmp:
            written = write_outputs(tmp, report, artifact)
            data = (Path(tmp) / "dispatch-model.json").read_bytes()
            self.assertEqual(written["artifactSha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(strict_json(data), artifact)
            with self.assertRaises(FileExistsError):
                write_outputs(tmp, report, artifact)

    def test_reproducible_coefficients(self):
        self.assertEqual(self.run_training(), self.run_training())

    def test_python_sigmoid_matches_sklearn(self):
        s = select_model(self.parts["train"], self.parts["validation"])
        x = (matrix(self.parts["test"]) - s.means) / s.scales
        np.testing.assert_allclose(probabilities(s.model, self.parts["test"], s.means, s.scales), s.model.predict_proba(x)[:, 1], rtol=1e-14, atol=1e-14)

    def test_no_model_single_class(self):
        rows = [{**r, "accepted": False} for r in self.rows]
        report, artifact = self.run_training(rows)
        self.assertEqual(report["modelSelectionStatus"], "NO_MODEL_SELECTED")
        self.assertIsNone(artifact)
        self.assertIsNone(report["test"]["logistic"])
        with tempfile.TemporaryDirectory() as tmp:
            written = write_outputs(tmp, report, artifact)
            self.assertFalse((Path(tmp) / "dispatch-model.json").exists())
            self.assertIsNone(written["artifactSha256"])
        s = select_model(self.parts["train"], [{**r, "accepted": True} for r in self.parts["validation"]])
        self.assertIsNone(s.model)

    def test_no_model_guardrail(self):
        class ConstantModel:
            def __init__(self, _):
                self.coef_, self.intercept_, self.classes_ = np.zeros((1, 10)), np.zeros(1), [0, 1]
            def fit(self, x, y):
                rate = float(y.mean())
                self.intercept_[0] = np.log(rate / (1-rate))
                return self
        s = select_model(self.parts["train"], self.parts["validation"], model_factory=ConstantModel)
        self.assertIsNone(s.model)
        self.assertTrue(all(not c["passedGuardrails"] for c in s.candidates))

    def test_bad_candidates_rejected(self):
        class BadModel:
            def __init__(self, _):
                self.coef_, self.intercept_, self.classes_ = np.full((1, 10), np.nan), np.zeros(1), [0, 1]
            def fit(self, x, y):
                return self
        s = select_model(self.parts["train"], self.parts["validation"], model_factory=BadModel)
        self.assertIsNone(s.model)
        self.assertTrue(all(c["rejectionReason"] == "invalid_or_nonconverged_candidate" for c in s.candidates))
        for grid in ([], [0], [True], [float("nan")], [1, 1]):
            with self.assertRaises(ValueError):
                select_model(self.parts["train"], self.parts["validation"], c_values=grid)

    def test_artifact_validation(self):
        a = json.loads((Path(__file__).resolve().parents[1] / "fixtures/prediction-parity.json").read_text())["artifact"]
        self.assertEqual(validate_artifact(a), a)
        changes = [{"modelType": "ridge"}, {"artifactSchemaVersion": "v0"}, {"modelVersion": " "},
            {"datasetSchemaVersion": "v0"}, {"featureContractVersion": "v0"}, {"orderedFeatures": list(reversed(a["orderedFeatures"]))},
            {"coefficients": [1]}, {"coefficients": [float("nan")] * 10}, {"intercept": True}, {"rawRows": []},
            {"preprocessing": {"means": [0] * 10, "scales": [0] * 10}},
            {"output": {"type": "acceptance_probability", "positiveClass": "delivered"}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_artifact({**a, **change})
        for key, values in {"dataProvenance": ["unknown"], "datasetSha256": ["", "bad"], "gitCommit": [" "], "trainedAt": ["2026-02-30T00:00:00Z", "2026-01-01"], "trainingRows": [-1, True, .5]}.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate_artifact({**a, "trainingMetadata": {**a["trainingMetadata"], key: value}})
        for key in a["evaluation"]:
            for v in (-1, float("inf"), "0"):
                with self.subTest(key=key, v=v), self.assertRaises(ValueError):
                    validate_artifact({**a, "evaluation": {**a["evaluation"], key: v}})

    def test_malformed_dataset_rejected(self):
        payload, manifest = generate(config(row_count=12))
        original = [json.loads(s) for s in payload.splitlines()]
        def check(rows, m, checksum=True):
            data = b"".join((json.dumps(r) + "\n").encode() for r in rows)
            m = copy.deepcopy(m)
            if checksum:
                m["jsonlSha256"] = hashlib.sha256(data).hexdigest()
            with tempfile.TemporaryDirectory() as tmp:
                write_dataset(tmp, data, m)
                return load_dataset(Path(tmp) / "dispatch-dataset.jsonl", Path(tmp) / "dispatch-dataset.manifest.json")
        self.assertEqual(len(check(original, manifest)[0]), 12)
        # REAL Phase12B-compatible envelope has counts.exportedRows, not rowCount.
        real = {k: v for k, v in manifest.items() if k not in ("rowCount", "classCounts", "groupCount", "generatorConfig", "generatorVersion", "seed")}
        real["dataProvenance"] = "REAL"
        real["counts"] = {**manifest["counts"], "rowsBySelectionPolicy": {"DETERMINISTIC_FALLBACK": 12, "ML_ASSISTED": 0}}
        self.assertEqual(len(check(original, real)[0]), 12)
        for update in ({"schemaVersion": "v0"}, {"dataProvenance": None}, {"counts": {**manifest["counts"], "train": 99}}, {"rowCount": 99}, {"counts": {**manifest["counts"], "acceptedRows": True}}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                check(original, {**manifest, **update})
        for update in ({"schemaVersion": "v0"}, {"accepted": 1}, {"split": "bad"}, {"predictionPoint": "AFTER"}, {"riderDistanceKm": -1}, {"activeWorkload": "0"}, {"riderId": "private"}, {"rowKey": "row-000002"}, {"orderGroupKey": "order-group-000999"}):
            rows = copy.deepcopy(original)
            rows[0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                check(rows, manifest)
        rows = copy.deepcopy(original)
        next(r for r in rows if r["split"] == "test")["orderGroupKey"] = "order-group-000001"
        with self.assertRaisesRegex(ValueError, "cross_split_group"):
            check(rows, manifest)
        with self.assertRaisesRegex(ValueError, "checksum_mismatch"):
            check(original, {**manifest, "jsonlSha256": "0" * 64}, checksum=False)

    def test_strict_json(self):
        for text in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
            with self.assertRaises(ValueError):
                strict_json(text)

    def test_empty_training_report(self):
        report, artifact = self.run_training([])
        self.assertIsNone(artifact)
        self.assertEqual(report["rowCounts"], {"train": 0, "validation": 0, "test": 0})
        self.assertIsNone(report["test"]["constantBaseline"])
