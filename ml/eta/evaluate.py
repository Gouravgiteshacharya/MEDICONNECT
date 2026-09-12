"""Aggregate ETA evaluation. Rates are fractions; error=prediction-actual."""
import math
import statistics

from features import finite_number


def evaluate_eta(observations):
    """Match TypeScript evaluateEta: exclude invalid rows and count them."""
    errors, excluded = [], 0
    for row in observations:
        actual, predicted = row.get("actualMinutes"), row.get("predictedMinutes")
        if not finite_number(actual) or actual <= 0 or not finite_number(predicted) or predicted < 0:
            excluded += 1
        else:
            errors.append(predicted - actual)
    count = len(errors)
    if not count:
        return dict(status="unavailable", reason="no_valid_observations", sampleCount=0, excludedCount=excluded)
    absolute = sorted(abs(error) for error in errors)
    lateness = sorted(-error for error in errors)
    late = [max(value, 0) for value in lateness]
    scale = absolute[-1]

    def mean(values):
        return 0.0 if scale == 0 else max(-1, min(1, sum(value / scale for value in values) / count)) * scale

    def median(values):
        middle = count // 2
        return values[middle] if count % 2 else values[middle - 1] / 2 + values[middle] / 2

    def p90(values):
        return values[math.ceil(0.9 * count) - 1]

    def rate(predicate):
        return sum(predicate(error) for error in errors) / count

    metrics = dict(
        mae=mean(absolute), medianAbsoluteError=median(absolute),
        rmse=0.0 if scale == 0 else math.sqrt(min(1, sum((error / scale) ** 2 for error in errors) / count)) * scale,
        p90AbsoluteError=p90(absolute), meanSignedBias=mean(errors),
        medianSignedLateness=median(lateness), p90SignedLateness=p90(lateness), p90LateMinutes=p90(late),
        within5MinutesRate=rate(lambda error: abs(error) <= 5),
        within10MinutesRate=rate(lambda error: abs(error) <= 10),
        within15MinutesRate=rate(lambda error: abs(error) <= 15),
        overPromiseRate=rate(lambda error: error < 0), underPromiseRate=rate(lambda error: error > 0),
        withinPredictedEtaRate=rate(lambda error: error >= 0),
    )
    return dict(status="evaluated", sampleCount=count, excludedCount=excluded, metrics=metrics)


def prediction_evaluation(rows, predictions, *, model=False):
    if len(rows) != len(predictions):
        raise ValueError("prediction_count_mismatch")
    # Metrics preserve TS >=0 convention. Runtime readiness is stricter: model values must be >0.
    invalid = sum(not finite_number(p) or p <= 0 for p in predictions) if model else sum(not finite_number(p) or p < 0 for p in predictions)
    result = evaluate_eta([dict(actualMinutes=row["actualDurationMinutes"], predictedMinutes=p) for row, p in zip(rows, predictions)])
    return dict(evaluation=result, invalidPredictionCount=invalid,
                predictionAvailability=None if not rows else (len(rows) - invalid) / len(rows))


def evaluate_cohorts(rows, predictions, train_median):
    """Every quote-cohort predictor receives identical quote-present source rows."""
    indices = [i for i, row in enumerate(rows) if row["quotedEtaMinutes"] is not None]

    def cohort(selected, quote=False):
        subset = [rows[i] for i in selected]
        result = dict(
            sampleCount=len(subset),
            ridge=prediction_evaluation(subset, [predictions[i] for i in selected], model=True),
            distance=prediction_evaluation(subset, [row["distanceBaselineMinutes"] for row in subset]),
            median=prediction_evaluation(subset, [train_median] * len(subset)),
        )
        if quote:
            result["quotedEta"] = prediction_evaluation(subset, [row["quotedEtaMinutes"] for row in subset])
        return result

    return dict(fullCohort=cohort(range(len(rows))), quoteCommonCohort=cohort(indices, True))


def generalization_diagnostics(splits):
    def bounds(rows, key):
        values = [row[key] for row in rows]
        return dict(min=min(values), max=max(values)) if values else dict(min=None, max=None)

    result = {}
    for split, rows in splits.items():
        result[split] = dict(distanceKm=bounds(rows, "distanceKm"), itemCount=bounds(rows, "itemCount"),
            hourCounts=[sum(r["hourOfDay"] == i for r in rows) for i in range(24)],
            weekdayCounts=[sum(r["dayOfWeek"] == i for r in rows) for i in range(7)],
            targetDurationMinutes={**bounds(rows, "actualDurationMinutes"),
                "median": statistics.median(r["actualDurationMinutes"] for r in rows) if rows else None})
    outside = {}
    for key in ("distanceKm", "itemCount"):
        training = result["train"][key]
        outside[key] = None if training["min"] is None else dict(
            below=sum(r[key] < training["min"] for r in splits["test"]),
            above=sum(r[key] > training["max"] for r in splits["test"]))
    result["testOutsideTrainingRanges"] = outside
    return result
