"""Offline ridge training from validated files. No database or production integration."""
import argparse
from dataclasses import asdict, dataclass
import math
import statistics
from importlib.metadata import version, PackageNotFoundError

import numpy as np

from evaluate import evaluate_cohorts, generalization_diagnostics
from features import encode_checkout_features, finite_number, ORDERED_FEATURES, FEATURE_CONTRACT_VERSION
from model_io import load_dataset, write_outputs, RAW_KEYS
from synthetic import utc_instant  # Date validation only; generation is never called.

DEFAULT_ALPHAS = (0.01, 0.1, 1.0, 10.0, 100.0)


@dataclass(frozen=True)
class Guardrails:
    """PROPOSED prototype selection thresholds, not production service guarantees."""
    p90_relative_tolerance: float = 0.10
    overpromise_absolute_tolerance: float = 0.10
    negative_bias_tolerance_minutes: float = 5.0
    p90_late_relative_tolerance: float | None = None


def matrix(rows):
    return np.asarray([encode_checkout_features({key: row[key] for key in RAW_KEYS}) for row in rows], dtype=float).reshape((-1, 10))


def fit_preprocessing(train):
    if not train:
        raise ValueError("empty_training_split")
    values = matrix(train)
    with np.errstate(over="ignore", invalid="ignore"):
        means, scales = values.mean(axis=0), values.std(axis=0, ddof=0)
    scales[scales == 0] = 1.0
    if not np.isfinite(means).all() or not np.isfinite(scales).all():
        raise ValueError("preprocessing_overflow")
    return means, scales


def ridge_factory(alpha):
    try:
        from sklearn.linear_model import Ridge
    except ImportError:
        raise RuntimeError("scikit-learn is required; install the pinned environment only with authorization") from None
    return Ridge(alpha=alpha, fit_intercept=True, solver="svd")


def guardrail_results(full_cohort, config):
    ridge, distance = full_cohort["ridge"], full_cohort["distance"]
    if ridge["evaluation"]["status"] != "evaluated" or distance["evaluation"]["status"] != "evaluated":
        return dict(passed=False, checks={"metricsAvailable": False})
    model, baseline = ridge["evaluation"]["metrics"], distance["evaluation"]["metrics"]
    checks = dict(
        allPredictionsAvailable=ridge["invalidPredictionCount"] == 0,
        maeImproved=model["mae"] < baseline["mae"],
        p90WithinTolerance=model["p90AbsoluteError"] <= baseline["p90AbsoluteError"] * (1 + config.p90_relative_tolerance),
        overpromiseWithinTolerance=model["overPromiseRate"] <= baseline["overPromiseRate"] + config.overpromise_absolute_tolerance,
        biasWithinTolerance=model["meanSignedBias"] >= baseline["meanSignedBias"] - config.negative_bias_tolerance_minutes,
    )
    if config.p90_late_relative_tolerance is not None:
        checks["p90LateWithinTolerance"] = model["p90LateMinutes"] <= baseline["p90LateMinutes"] * (1 + config.p90_late_relative_tolerance)
    return dict(passed=all(checks.values()), checks=checks)


def candidate_key(candidate):
    metrics = candidate["validation"]["fullCohort"]["ridge"]["evaluation"]["metrics"]
    return (metrics["mae"], metrics["p90AbsoluteError"], abs(metrics["meanSignedBias"]), candidate["alpha"])


def select_model(train, validation, alphas=DEFAULT_ALPHAS, guardrails=Guardrails(), *, model_factory=ridge_factory):
    """Only train and validation are accepted. Never refit after selection."""
    if not train or not validation:
        raise ValueError("nonempty_train_and_validation_required")
    if not alphas or any(not finite_number(a) or a <= 0 for a in alphas) or len(set(alphas)) != len(alphas):
        raise ValueError("alphas_must_be_distinct_finite_positive_values")
    for key, value in asdict(guardrails).items():
        if key == "p90_late_relative_tolerance" and value is None:
            continue
        if not finite_number(value) or value < 0:
            raise ValueError("invalid_guardrail_configuration")
    means, scales = fit_preprocessing(train)
    with np.errstate(over="ignore", invalid="ignore"):
        x_train, x_validation = [(matrix(rows) - means) / scales for rows in (train, validation)]
    if not np.isfinite(x_train).all() or not np.isfinite(x_validation).all():
        raise ValueError("feature_transformation_overflow")
    y_train = np.asarray([r["actualDurationMinutes"] for r in train])
    median = statistics.median(y_train.tolist())
    candidates, fitted = [], {}
    for alpha in sorted(alphas):
        model = model_factory(alpha)
        model.fit(x_train, y_train)
        coefficients = np.asarray(model.coef_)
        if coefficients.shape != (10,) or not np.isfinite(coefficients).all() or not finite_number(float(model.intercept_)):
            candidates.append(dict(alpha=alpha, validation=None, guardrails=dict(passed=False, checks={"finiteModelParameters": False})))
            continue
        predictions = np.asarray(model.predict(x_validation), dtype=float).tolist()
        evaluation = evaluate_cohorts(validation, predictions, median)
        candidate = dict(alpha=alpha, validation=evaluation, guardrails=guardrail_results(evaluation["fullCohort"], guardrails))
        candidates.append(candidate)
        fitted[alpha] = model
    passing = [candidate for candidate in candidates if candidate["guardrails"]["passed"]]
    selected = min(passing, key=candidate_key) if passing else None
    return dict(selected=selected, model=fitted[selected["alpha"]] if selected else None,
                candidates=candidates, means=means, scales=scales, trainMedian=median)


def evaluate_final_model(selection, test):
    """Called only after selection with the unchanged fitted model."""
    if not test:
        predictions = []
    else:
        with np.errstate(over="ignore", invalid="ignore"):
            values = (matrix(test) - selection["means"]) / selection["scales"]
        predictions = [float("nan")] * len(test) if not np.isfinite(values).all() else selection["model"].predict(values).tolist()
    return evaluate_cohorts(test, predictions, selection["trainMedian"])


def train_dataset(rows, manifest, *, model_version, git_commit, trained_at,
                  alphas=DEFAULT_ALPHAS, guardrails=Guardrails(), model_factory=ridge_factory):
    if not isinstance(model_version, str) or not model_version.strip() or not isinstance(git_commit, str) or not git_commit.strip():
        raise ValueError("model_version_and_git_commit_required")
    utc_instant(trained_at)
    splits = {name: [row for row in rows if row["split"] == name] for name in ("train", "validation", "test")}
    selection = select_model(splits["train"], splits["validation"], alphas, guardrails, model_factory=model_factory)
    selected = selection["selected"]
    # No test predictions or diagnostics are computed before selection.
    final = evaluate_final_model(selection, splits["test"]) if selected else None
    means, scales = selection["means"].tolist(), selection["scales"].tolist()
    counts = {key: len(value) for key, value in splits.items()}
    try:
        sklearn_version = version("scikit-learn")
    except PackageNotFoundError:
        sklearn_version = None
    report = dict(
        reportSchemaVersion="eta-evaluation-report-v1", modelSelectionStatus="MODEL_SELECTED" if selected else "NO_MODEL_SELECTED",
        modelVersion=model_version, datasetSchemaVersion="eta-checkout-v1", datasetSha256=manifest["jsonlSha256"],
        dataProvenance=manifest["dataProvenance"], featureContractVersion=FEATURE_CONTRACT_VERSION,
        artifactSchemaVersion="eta-model-artifact-v1", gitCommit=git_commit, trainedAt=trained_at, rowCounts=counts,
        selectedHyperparameters=dict(alpha=selected["alpha"], solver="svd", fitIntercept=True) if selected else None,
        preprocessing=dict(orderedFeatures=list(ORDERED_FEATURES), means=means, scales=scales),
        validation=selected["validation"] if selected else None, test=final,
        candidateResults=selection["candidates"], guardrailResults=selected["guardrails"] if selected else None,
        guardrailPolicy=dict(kind="PROPOSED_PROTOTYPE", **asdict(guardrails)),
        invalidPredictionCounts=dict(validation=selected["validation"]["fullCohort"]["ridge"]["invalidPredictionCount"] if selected else None,
                                     test=final["fullCohort"]["ridge"]["invalidPredictionCount"] if final else None),
        generalizationDiagnostics=generalization_diagnostics(splits),
        splitPolicy="Preserve exported temporal labels; snapshot maturity policy inherited from dataset",
        trainMedianBaseline=selection["trainMedian"],
        trainingEnvironment=dict(numpyVersion=np.__version__, sklearnVersion=sklearn_version),
    )
    artifact = None
    if selected:
        model = selection["model"]
        test_metrics = final["fullCohort"]["ridge"]["evaluation"]
        artifact = dict(
            artifactSchemaVersion="eta-model-artifact-v1", modelType="ridge", modelVersion=model_version,
            datasetSchemaVersion="eta-checkout-v1", featureContractVersion=FEATURE_CONTRACT_VERSION,
            orderedFeatures=list(ORDERED_FEATURES), preprocessing=dict(means=means, scales=scales),
            coefficients=model.coef_.tolist(), intercept=float(model.intercept_), output=dict(unit="minutes"),
            trainingMetadata=dict(dataProvenance=manifest["dataProvenance"], datasetSha256=manifest["jsonlSha256"],
                gitCommit=git_commit, trainedAt=trained_at, trainingRows=counts["train"], validationRows=counts["validation"], testRows=counts["test"]),
            evaluation=dict(validationMae=selected["validation"]["fullCohort"]["ridge"]["evaluation"]["metrics"]["mae"],
                            testMae=test_metrics["metrics"]["mae"] if test_metrics["status"] == "evaluated" else None),
        )
    return artifact, report


def main():
    parser = argparse.ArgumentParser(description="Offline ETA ridge prototype; no database access")
    for flag in ("dataset", "manifest", "output-directory", "model-version", "git-commit", "trained-at"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--alphas", nargs="+", type=float, default=DEFAULT_ALPHAS)
    parser.add_argument("--p90-relative-tolerance", type=float, default=0.10)
    parser.add_argument("--overpromise-absolute-tolerance", type=float, default=0.10)
    parser.add_argument("--negative-bias-tolerance-minutes", type=float, default=5.0)
    parser.add_argument("--p90-late-relative-tolerance", type=float)
    args = parser.parse_args()
    rows, manifest = load_dataset(args.dataset, args.manifest)
    artifact, report = train_dataset(rows, manifest, model_version=args.model_version,
        git_commit=args.git_commit, trained_at=args.trained_at, alphas=args.alphas,
        guardrails=Guardrails(args.p90_relative_tolerance, args.overpromise_absolute_tolerance,
                              args.negative_bias_tolerance_minutes, args.p90_late_relative_tolerance))
    write_outputs(args.output_directory, artifact, report)
    print(report["modelSelectionStatus"])


if __name__ == "__main__":
    main()
