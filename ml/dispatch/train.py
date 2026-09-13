"""Offline train-only logistic fit; selection sees train and validation only."""
import argparse
from dataclasses import dataclass
import warnings
import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from features import encode_dispatch_features, ORDERED_FEATURES, FEATURE_CONTRACT_VERSION, finite_number
from evaluate import metrics, calibration, generalization, stable_sigmoid
from model_io import (RAW_KEYS, SPLITS, DATASET_VERSION, ARTIFACT_VERSION, load_dataset,
                      validate_artifact, write_outputs, utc_instant, nonempty)

DEFAULT_C = (.01, .1, 1., 10., 100.)
MAX_ITER = 2000
BRIER_TOLERANCE = .01  # Predeclared absolute validation Brier tolerance.


def matrix(rows):
    return np.array([encode_dispatch_features({k: r[k] for k in RAW_KEYS}) for r in rows], dtype=float).reshape(-1, 10)


def fit_preprocessing(train):
    x = matrix(train)
    if not len(x):
        raise ValueError("empty_train")
    with np.errstate(over="ignore", invalid="ignore"):
        means, scales = x.mean(axis=0), x.std(axis=0, ddof=0)
    scales[scales == 0] = 1
    if not np.isfinite(means).all() or not np.isfinite(scales).all():
        raise ValueError("nonfinite_preprocessing")
    return means, scales


def constant_rate(train):
    return sum(r["accepted"] for r in train) / len(train) if train else None


def logistic_factory(c):
    # sklearn 1.8 default l1_ratio=0 is pure L2; penalty='l2' is deprecated.
    return LogisticRegression(C=c, solver="lbfgs", l1_ratio=0, max_iter=MAX_ITER, tol=1e-8)


def tie_key(candidate):
    m = candidate["validation"]
    return (m["logLoss"], m["brier"], -m["averagePrecision"], candidate["C"])


def probabilities(model, rows, means, scales):
    with np.errstate(over="ignore", invalid="ignore"):
        z = ((matrix(rows) - means) / scales) @ model.coef_[0] + model.intercept_[0]
    result = [stable_sigmoid(float(value)) for value in z]
    return result


@dataclass(frozen=True)
class Selection:
    model: object
    means: object
    scales: object
    selected_c: object
    candidates: list
    baseline_rate: object
    reason: object


def select_model(train, validation, *, c_values=DEFAULT_C, model_factory=logistic_factory):
    """No test argument, globals, I/O or holdout refit. Returns frozen train-fitted choice."""
    if not c_values or any(not finite_number(c) or c <= 0 for c in c_values) or len(set(c_values)) != len(c_values):
        raise ValueError("invalid_c_grid")
    rate = constant_rate(train)
    if len({r["accepted"] for r in train}) != 2 or len({r["accepted"] for r in validation}) != 2:
        return Selection(None, None, None, None, [], rate, "both_classes_required_in_train_and_validation")
    means, scales = fit_preprocessing(train)
    x, y = (matrix(train) - means) / scales, np.array([r["accepted"] for r in train], dtype=int)
    baseline = metrics([r["accepted"] for r in validation], [rate] * len(validation))
    candidates, eligible = [], []
    for c in sorted(c_values):
        result = {"C": c, "validation": None, "passedGuardrails": False, "rejectionReason": None}
        try:
            model = model_factory(c)
            with warnings.catch_warnings():
                warnings.simplefilter("error", ConvergenceWarning)
                model.fit(x, y)
            if (np.asarray(model.coef_).shape != (1, 10) or np.asarray(model.intercept_).shape != (1,)
                or not np.isfinite(model.coef_).all() or not np.isfinite(model.intercept_).all()
                or list(model.classes_) != [0, 1]):
                raise ValueError("invalid_model_parameters")
            pred = probabilities(model, validation, means, scales)
            score = metrics([r["accepted"] for r in validation], pred)
            result["validation"] = score
            result["passedGuardrails"] = score["logLoss"] < baseline["logLoss"] and score["brier"] <= baseline["brier"] + BRIER_TOLERANCE
            if result["passedGuardrails"]:
                eligible.append((result, model))
            else:
                result["rejectionReason"] = "validation_baseline_guardrails"
        except (ValueError, FloatingPointError, OverflowError, ConvergenceWarning):
            result["rejectionReason"] = "invalid_or_nonconverged_candidate"
        candidates.append(result)
    if not eligible:
        return Selection(None, means, scales, None, candidates, rate, "no_candidate_passed_guardrails")
    chosen, model = min(eligible, key=lambda pair: tie_key(pair[0]))
    return Selection(model, means, scales, chosen["C"], candidates, rate, None)


def train_and_evaluate(rows, manifest, *, model_version, git_commit, trained_at, c_values=DEFAULT_C):
    if not nonempty(model_version) or not nonempty(git_commit):
        raise ValueError("invalid_training_metadata")
    utc_instant(trained_at)
    splits = {s: [r for r in rows if r["split"] == s] for s in SPLITS}
    # Freeze selection before computing any test scores or test diagnostics.
    selection = select_model(splits["train"], splits["validation"], c_values=c_values)
    evaluation, bins = {}, {}
    for name in ("validation", "test"):
        part = splits[name]
        labels = [r["accepted"] for r in part]
        baseline_p = [selection.baseline_rate] * len(part) if selection.baseline_rate is not None else None
        pred = probabilities(selection.model, part, selection.means, selection.scales) if selection.model is not None else None
        evaluation[name] = {"logistic": metrics(labels, pred) if pred is not None else None,
                            "constantBaseline": metrics(labels, baseline_p) if baseline_p is not None else None}
        bins[name] = {"logistic": calibration(labels, pred) if pred is not None else None,
                      "constantBaseline": calibration(labels, baseline_p) if baseline_p is not None else None}
    artifact = None
    if selection.model is not None:
        artifact = validate_artifact({"artifactSchemaVersion": ARTIFACT_VERSION, "modelType": "logistic_regression",
            "modelVersion": model_version, "datasetSchemaVersion": DATASET_VERSION, "featureContractVersion": FEATURE_CONTRACT_VERSION,
            "orderedFeatures": list(ORDERED_FEATURES), "preprocessing": {"means": selection.means.tolist(), "scales": selection.scales.tolist()},
            "coefficients": selection.model.coef_[0].tolist(), "intercept": float(selection.model.intercept_[0]),
            "output": {"type": "acceptance_probability", "positiveClass": "accepted_before_expiry"},
            "trainingMetadata": {"dataProvenance": manifest["dataProvenance"], "datasetSha256": manifest["jsonlSha256"],
                "gitCommit": git_commit, "trainedAt": trained_at, "trainingRows": len(splits["train"]),
                "validationRows": len(splits["validation"]), "testRows": len(splits["test"])},
            "evaluation": {"validationLogLoss": evaluation["validation"]["logistic"]["logLoss"],
                           "testLogLoss": evaluation["test"]["logistic"]["logLoss"],
                           "validationBrier": evaluation["validation"]["logistic"]["brier"],
                           "testBrier": evaluation["test"]["logistic"]["brier"]}})
    report = {"reportSchemaVersion": "dispatch-evaluation-report-v1", "modelSelectionStatus": "MODEL_SELECTED" if artifact else "NO_MODEL_SELECTED",
        "selectionReason": selection.reason, "modelVersion": model_version, "datasetSchemaVersion": DATASET_VERSION,
        "datasetSha256": manifest["jsonlSha256"], "dataProvenance": manifest["dataProvenance"],
        "featureContractVersion": FEATURE_CONTRACT_VERSION, "artifactSchemaVersion": ARTIFACT_VERSION,
        "gitCommit": git_commit, "trainedAt": trained_at, "rowCounts": {s: len(r) for s, r in splits.items()},
        "classCounts": {s: {"accepted": sum(r["accepted"] for r in part), "notAccepted": sum(not r["accepted"] for r in part)} for s, part in splits.items()},
        "selectedHyperparameters": {"C": selection.selected_c, "penalty": "l2", "solver": "lbfgs", "maxIter": MAX_ITER, "tol": 1e-8} if artifact else None,
        "selectionPolicy": {"primaryMetric": "validation_log_loss", "tieBreak": ["logLoss_asc", "brier_asc", "averagePrecision_desc", "C_asc"],
                            "brierAbsoluteTolerance": BRIER_TOLERANCE, "requiresStrictLogLossImprovement": True, "trainOnlyFit": True},
        "constantTrainAcceptanceRate": selection.baseline_rate, "candidateResults": selection.candidates, **evaluation,
        "calibrationDiagnostics": bins, "generalizationDiagnostics": generalization(splits),
        "deterministicBaseline": {"offeredRiderRankDistribution": None,
            "rankUnavailableReason": "dispatch-acceptance-v1 has no rank field; synthetic generator does not simulate candidate ranking",
            "selectionPolicyCounts": manifest["counts"]["rowsBySelectionPolicy"],
            "scope": "offered-rider selection context only; deterministic score is not a probability; no counterfactual uplift"},
        "artifactSha256": None}
    return report, artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("dataset", "manifest", "output-directory", "model-version", "git-commit", "trained-at"):
        parser.add_argument("--" + arg, required=True)
    parser.add_argument("--c-values", nargs="+", type=float, default=list(DEFAULT_C))
    args = parser.parse_args()
    rows, manifest = load_dataset(args.dataset, args.manifest)
    report, artifact = train_and_evaluate(rows, manifest, model_version=args.model_version, git_commit=args.git_commit,
                                         trained_at=args.trained_at, c_values=args.c_values)
    written = write_outputs(args.output_directory, report, artifact)
    print(written["modelSelectionStatus"])


if __name__ == "__main__":
    main()
