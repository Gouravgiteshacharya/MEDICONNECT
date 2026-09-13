"""Probability metrics; deterministic fixed bins and numerically stable sigmoid."""
import math
import numpy as np
from sklearn.metrics import roc_auc_score, average_precision_score
from features import finite_number


def stable_sigmoid(z):
    if not finite_number(z):
        raise ValueError("invalid_logit")
    if z >= 0:
        return 1 / (1 + math.exp(-z))
    exp_z = math.exp(z)
    return exp_z / (1 + exp_z)


def checked(labels, probabilities):
    labels, probabilities = list(labels), list(probabilities)
    if len(labels) != len(probabilities) or any(type(y) is not bool for y in labels):
        raise ValueError("invalid_labels")
    if any(not finite_number(p) or not 0 <= p <= 1 for p in probabilities):
        raise ValueError("invalid_probability")
    return np.array(labels, dtype=bool), np.array(probabilities, dtype=float)


def metrics(labels, probabilities):
    y, p = checked(labels, probabilities)
    names = ("logLoss", "brier", "rocAuc", "averagePrecision", "accuracyAt05",
             "precisionAt05", "recallAt05", "predictedPositiveRate", "actualAcceptanceRate")
    result = dict.fromkeys(names)
    result["sampleCount"] = len(y)
    if not len(y):
        return result
    # Fixed float64 machine epsilon; exact 0/1 predictions have finite log loss.
    q = np.clip(p, np.finfo(np.float64).eps, 1 - np.finfo(np.float64).eps)
    pred = p >= .5
    tp = int(np.sum(pred & y))
    result.update(logLoss=float(-np.mean(np.where(y, np.log(q), np.log1p(-q)))),
                  brier=float(np.mean((p - y.astype(float)) ** 2)),
                  rocAuc=float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None,
                  averagePrecision=float(average_precision_score(y, p)) if y.any() else None,
                  accuracyAt05=float(np.mean(pred == y)),
                  precisionAt05=tp / int(pred.sum()) if pred.any() else None,
                  recallAt05=tp / int(y.sum()) if y.any() else None,
                  predictedPositiveRate=float(pred.mean()), actualAcceptanceRate=float(y.mean()))
    return result


def calibration(labels, probabilities):
    y, p = checked(labels, probabilities)
    indexes = np.minimum((p * 10).astype(int), 9)
    bins = []
    for i in range(10):
        mask = indexes == i
        bins.append({"lower": i / 10, "upper": (i + 1) / 10,
                     "upperInclusive": i == 9, "count": int(mask.sum()),
                     "meanPredictedProbability": float(p[mask].mean()) if mask.any() else None,
                     "observedAcceptanceRate": float(y[mask].mean()) if mask.any() else None})
    return bins


def generalization(splits):
    train = splits["train"]
    result = {}
    for name, rows in splits.items():
        summary = {"hourCoverage": sorted({r["hourOfDay"] for r in rows}),
                   "weekdayCoverage": sorted({r["dayOfWeek"] for r in rows}),
                   "classPrevalence": sum(r["accepted"] for r in rows) / len(rows) if rows else None}
        for key in ("riderDistanceKm", "activeWorkload"):
            values, reference = [r[key] for r in rows], [r[key] for r in train]
            summary[key] = {"min": min(values) if values else None, "max": max(values) if values else None,
                            "outsideTrainRange": sum(v < min(reference) or v > max(reference) for v in values) if reference else None}
        result[name] = summary
    return result
