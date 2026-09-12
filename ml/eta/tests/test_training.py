from copy import deepcopy
from dataclasses import replace
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from model_io import load_dataset, json_bytes, write_outputs
from synthetic import GeneratorConfig, generate_dataset, serialize_rows
from train import (select_model, fit_preprocessing, train_dataset, candidate_key,
                   guardrail_results, Guardrails, ridge_factory)


def config():
    return GeneratorConfig(seed=42, row_count=180, train_start="2026-01-01T00:00:00Z",
        validation_start="2026-02-01T00:00:00Z", test_start="2026-03-01T00:00:00Z",
        test_end="2026-04-01T00:00:00Z", generator_version="eta-synthetic-v1",
        timezone_offset_minutes=330, fallback_speed_kmh=20)


def simple_rows():
    rows, manifest = generate_dataset(config())
    # Deliberately easy synthetic control for selection tests, not model-quality evidence.
    for row in rows:
        row["actualDurationMinutes"] = 30.0
        row["distanceKm"] = 1.0
        row["distanceBaselineMinutes"] = 3
    manifest["jsonlSha256"] = hashlib.sha256(serialize_rows(rows).encode()).hexdigest()
    return rows, manifest


class StubModel:
    """Test double for orchestration only. Not a replacement for sklearn Ridge."""
    def __init__(self, prediction=30):
        self.prediction = prediction
        self.coef_ = np.zeros(10)
        self.intercept_ = float(prediction) if np.isfinite(prediction) else 1.0
        self.fit_calls = []

    def fit(self, values, labels):
        self.fit_calls.append((values.copy(), labels.copy()))
        return self

    def predict(self, values):
        return np.full(len(values), self.prediction, dtype=float)


class DatasetTests(unittest.TestCase):
    def test_valid_dataset(self):
        with tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
            rows, manifest = simple_rows()
            data, meta = self.write_pair(directory, rows, manifest)
            self.assertEqual(load_dataset(data, meta), (rows, manifest))

    @staticmethod
    def write_pair(directory, rows, manifest):
        data, meta = Path(directory) / "data.jsonl", Path(directory) / "manifest.json"
        data.write_bytes(serialize_rows(rows).encode())
        meta.write_bytes(json_bytes(manifest))
        return data, meta

    def test_bad_manifest(self):
        for change in ({"jsonlSha256": "0" * 64}, {"rowCount": 1}, {"schemaVersion": "wrong"},
                       {"dataProvenance": None}, {"splitCounts": {"train": 0, "validation": 0, "test": 0}},
                       {"baseline": {}}, {"generatorConfig": None}):
            with self.subTest(change=change), tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
                rows, manifest = simple_rows()
                data, meta = self.write_pair(directory, rows, {**manifest, **change})
                with self.assertRaises(ValueError):
                    load_dataset(data, meta)

    def test_bad_rows(self):
        changes = ({"schemaVersion": "wrong"}, {"predictionPoint": "PICKUP"}, {"split": "other"},
                   {"orderId": "private"}, {"actualDurationMinutes": 0}, {"itemCount": 0},
                   {"hourOfDay": 24}, {"dayOfWeek": 7}, {"quotedEtaMinutes": -1},
                   {"distanceBaselineMinutes": 999}, {"distanceKm": -1}, {"rowKey": "private"})
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
                rows, manifest = simple_rows()
                rows[0].update(change)
                manifest["jsonlSha256"] = hashlib.sha256(serialize_rows(rows).encode()).hexdigest()
                data, meta = self.write_pair(directory, rows, manifest)
                with self.assertRaises(ValueError):
                    load_dataset(data, meta)

    def test_malformed_json_rejected(self):
        with tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
            rows, manifest = simple_rows()
            data, meta = self.write_pair(directory, rows, manifest)
            data.write_bytes(b"{bad}\n")
            manifest["jsonlSha256"] = hashlib.sha256(data.read_bytes()).hexdigest()
            meta.write_bytes(json_bytes(manifest))
            with self.assertRaises(ValueError):
                load_dataset(data, meta)


class TrainingOrchestrationTests(unittest.TestCase):
    def test_train_only_scaling_and_zero_variance(self):
        rows, _ = simple_rows()
        train = [r for r in rows if r["split"] == "train"]
        means, scales = fit_preprocessing(train)
        self.assertEqual(means[0], 1)
        self.assertEqual(scales[0], 1)
        for row in rows:
            if row["split"] != "train":
                row["distanceKm"] = 10000
        means2, scales2 = fit_preprocessing(train)
        np.testing.assert_array_equal(means, means2)
        np.testing.assert_array_equal(scales, scales2)

    def test_each_alpha_fit_once_and_selection(self):
        rows, _ = simple_rows()
        train, validation = ([r for r in rows if r["split"] == s] for s in ("train", "validation"))
        models = {}
        def factory(alpha):
            models[alpha] = StubModel(30 + alpha)
            return models[alpha]
        selected = select_model(train, validation, [10, 0.1, 1], model_factory=factory)
        self.assertEqual(selected["selected"]["alpha"], 0.1)
        for model in models.values():
            self.assertEqual(len(model.fit_calls), 1)
            self.assertEqual(len(model.fit_calls[0][1]), len(train))
        self.assertEqual(selected["trainMedian"], 30)

    def test_tie_break_order(self):
        def candidate(mae, p90, bias, alpha):
            return dict(alpha=alpha, validation={"fullCohort": {"ridge": {"evaluation": {"metrics": dict(mae=mae, p90AbsoluteError=p90, meanSignedBias=bias)}}}})
        candidates = [candidate(1, 2, 1, 10), candidate(1, 2, -1, 1), candidate(1, 3, 0, 0.1), candidate(2, 0, 0, 0.01)]
        self.assertEqual(min(candidates, key=candidate_key)["alpha"], 1)

    def test_test_labels_never_enter_selection_and_no_refit(self):
        rows, manifest = simple_rows()
        model = StubModel()
        with patch("train.select_model", wraps=select_model) as spy:
            first, _ = train_dataset(rows, manifest, model_version="test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z", alphas=[1], model_factory=lambda _: model)
            train_arg, validation_arg = spy.call_args.args[:2]
            self.assertTrue(all(r["split"] == "train" for r in train_arg))
            self.assertTrue(all(r["split"] == "validation" for r in validation_arg))
        self.assertEqual(len(model.fit_calls), 1)
        changed = deepcopy(rows)
        for row in changed:
            if row["split"] == "test":
                row["actualDurationMinutes"] = 1000
        second, _ = train_dataset(changed, manifest, model_version="test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z", alphas=[1], model_factory=lambda _: StubModel())
        self.assertEqual(first["coefficients"], second["coefficients"])
        self.assertEqual(first["preprocessing"], second["preprocessing"])
        self.assertNotIn("test", inspect.signature(select_model).parameters)

    def test_individual_guardrails(self):
        baseline = dict(mae=10, p90AbsoluteError=20, meanSignedBias=-2, overPromiseRate=0.4, p90LateMinutes=10)
        good = dict(mae=5, p90AbsoluteError=20, meanSignedBias=-1, overPromiseRate=0.4, p90LateMinutes=10)
        def evaluate(metrics, invalid=0):
            return guardrail_results(dict(ridge=dict(evaluation=dict(status="evaluated", metrics=metrics), invalidPredictionCount=invalid),
                                          distance=dict(evaluation=dict(status="evaluated", metrics=baseline))), Guardrails())
        self.assertTrue(evaluate(good)["passed"])
        for key, value, reason in (("mae", 10, "maeImproved"), ("p90AbsoluteError", 23, "p90WithinTolerance"),
                                   ("overPromiseRate", 0.51, "overpromiseWithinTolerance"), ("meanSignedBias", -8, "biasWithinTolerance")):
            result = evaluate({**good, key: value})
            self.assertFalse(result["passed"])
            self.assertFalse(result["checks"][reason])
        self.assertFalse(evaluate(good, 1)["passed"])

    def test_no_model_and_invalid_predictions(self):
        rows, manifest = simple_rows()
        for prediction in (100, -1, 0, float("nan"), float("inf")):
            with self.subTest(prediction=prediction):
                artifact, report = train_dataset(rows, manifest, model_version="test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z", alphas=[1], model_factory=lambda _: StubModel(prediction))
                self.assertIsNone(artifact)
                self.assertEqual(report["modelSelectionStatus"], "NO_MODEL_SELECTED")
                self.assertIsNone(report["test"])
                json_bytes(report)  # no nonfinite data escapes report

    def test_artifact_and_report_contract(self):
        rows, manifest = simple_rows()
        artifact, report = train_dataset(rows, manifest, model_version="test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z", alphas=[1], model_factory=lambda _: StubModel())
        self.assertEqual(artifact["artifactSchemaVersion"], "eta-model-artifact-v1")
        self.assertEqual(artifact["dataProvenance"] if "dataProvenance" in artifact else artifact["trainingMetadata"]["dataProvenance"], "SYNTHETIC")
        self.assertEqual(len(artifact["coefficients"]), 10)
        self.assertEqual(len(artifact["preprocessing"]["means"]), 10)
        self.assertEqual(artifact["preprocessing"]["means"], report["preprocessing"]["means"])
        for forbidden in ("orderId", "customerId", "riderId", "pharmacyId", "rawRows", "rowKey"):
            self.assertNotIn(forbidden, json_bytes(artifact).decode() + json_bytes(report).decode())
        with tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
            saved = write_outputs(directory, artifact, report)
            self.assertEqual(saved["modelArtifactSha256"], hashlib.sha256((Path(directory) / "eta-model.json").read_bytes()).hexdigest())
            with self.assertRaises(FileExistsError):
                write_outputs(directory, artifact, report)
        self.assertEqual(json_bytes(artifact), json_bytes(artifact))

    def test_no_selection_writes_report_only(self):
        with tempfile.TemporaryDirectory(prefix="eta-training-test-") as directory:
            result = write_outputs(directory, None, dict(modelSelectionStatus="NO_MODEL_SELECTED"))
            self.assertIsNone(result["modelArtifactSha256"])
            self.assertFalse((Path(directory) / "eta-model.json").exists())

    def test_empty_training_or_validation_rejected(self):
        with self.assertRaises(ValueError):
            select_model([], [])

    def test_empty_test_is_explicitly_unavailable(self):
        rows, manifest = simple_rows()
        rows = [row for row in rows if row["split"] != "test"]
        artifact, report = train_dataset(rows, manifest, model_version="test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z", alphas=[1], model_factory=lambda _: StubModel())
        self.assertIsNone(artifact["evaluation"]["testMae"])
        self.assertEqual(report["test"]["fullCohort"]["sampleCount"], 0)


@unittest.skipUnless(importlib.util.find_spec("sklearn"), "scikit-learn unavailable; no installation authorized")
class ActualRidgeTests(unittest.TestCase):
    def test_fixed_solver_and_reproducible_fit(self):
        model = ridge_factory(1)
        self.assertEqual(model.get_params()["solver"], "svd")
        self.assertTrue(model.get_params()["fit_intercept"])
        rows, manifest = simple_rows()
        kwargs = dict(model_version="synthetic-test-only", git_commit="test", trained_at="2026-04-03T00:00:00Z")
        first, report = train_dataset(rows, manifest, **kwargs)
        second, report2 = train_dataset(rows, manifest, **kwargs)
        self.assertIsNotNone(first)
        np.testing.assert_allclose(first["coefficients"], second["coefficients"], atol=1e-12)
        self.assertEqual(first, second)
        self.assertEqual(report, report2)
        self.assertTrue(all(np.isfinite(first["coefficients"])))
