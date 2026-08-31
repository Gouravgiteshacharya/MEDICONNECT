"""Reproducible prototype training on synthetic—not commercial—delivery data."""
import json
import numpy as np

SEED = 20260831
SAMPLES = 5000
rng = np.random.default_rng(SEED)
rider_distance = rng.uniform(0, 15, SAMPLES)
workload = rng.integers(0, 5, SAMPLES)
customer_distance = rng.uniform(0.5, 20, SAMPLES)
peak_hour = rng.binomial(1, 0.35, SAMPLES)
batched = rng.binomial(1, 0.2, SAMPLES)
noise = rng.normal(0, 4, SAMPLES)
target = 8 + 2.4*rider_distance + 6.2*workload + 2.8*customer_distance + 7.5*peak_hour + 5*batched + noise
features = np.column_stack([rider_distance, workload, customer_distance, peak_hour, batched])
indices = rng.permutation(SAMPLES)
train, test = indices[:4000], indices[4000:]
design = np.column_stack([np.ones(len(train)), features[train]])
coefficients = np.linalg.lstsq(design, target[train], rcond=None)[0]
predictions = np.column_stack([np.ones(len(test)), features[test]]) @ coefficients
errors = target[test] - predictions
metrics = {
    "maeMinutes": float(np.mean(np.abs(errors))),
    "rmseMinutes": float(np.sqrt(np.mean(errors**2))),
    "r2": float(1 - np.sum(errors**2) / np.sum((target[test] - np.mean(target[test]))**2)),
}
print(json.dumps({"seed": SEED, "samples": SAMPLES, "trainSamples": len(train), "testSamples": len(test), "coefficients": coefficients.tolist(), "metrics": metrics}, indent=2))
