"""Seeded prototype behavior, not observed MediConnect behavior. Offered riders only."""
import argparse
from dataclasses import asdict, dataclass
from datetime import timedelta
import hashlib
import json
import math
from pathlib import Path
import random
from evaluate import stable_sigmoid
from model_io import DATASET_VERSION, RAW_KEYS, json_bytes, utc_instant, nonempty

GENERATOR_VERSION = "dispatch-synthetic-v1"


@dataclass(frozen=True)
class GeneratorConfig:
    seed: int
    row_count: int
    train_start: str
    validation_start: str
    test_start: str
    test_end: str
    timezone_offset_minutes: int
    generator_version: str
    generated_at: str
    git_commit: str


def validate_config(config):
    if type(config.seed) is not int or type(config.row_count) is not int or config.row_count < 0:
        raise ValueError("invalid_seed_or_count")
    if type(config.timezone_offset_minutes) is not int or not -840 <= config.timezone_offset_minutes <= 840:
        raise ValueError("invalid_timezone")
    if config.generator_version != GENERATOR_VERSION or not nonempty(config.git_commit):
        raise ValueError("invalid_generator_metadata")
    utc_instant(config.generated_at)
    bounds = [utc_instant(x) for x in (config.train_start, config.validation_start, config.test_start, config.test_end)]
    if any(a >= b for a, b in zip(bounds, bounds[1:])):
        raise ValueError("invalid_boundaries")
    return bounds


def synthetic_offer(rng, timestamp, config):
    distance = round(min(30, rng.expovariate(1 / 5)), 6)
    workload = rng.choices(range(7), weights=[30, 25, 20, 12, 7, 4, 2])[0]
    local = timestamp + timedelta(minutes=config.timezone_offset_minutes)
    hour, day = local.hour, (local.weekday() + 1) % 7
    # Quadratic distance, workload interaction, rush-hour step and latent shocks
    # intentionally cannot be represented exactly by the ten-feature logistic model.
    shock = rng.choice([-2.8, 2.1]) if rng.random() < .07 else 0
    z = (2.4 - .20 * distance - .014 * distance ** 2 - .50 * workload
         - .035 * workload * distance - .5 * (17 <= hour <= 20)
         + .35 * math.cos(2 * math.pi * hour / 24) + .25 * (day in (0, 6))
         + rng.gauss(0, .65) + shock)
    accepted_draw = rng.random() < stable_sigmoid(z)
    deadline = timestamp + timedelta(seconds=120)
    accepted_at = timestamp + timedelta(seconds=rng.uniform(0, 119)) if accepted_draw else None
    # False rows are explicit declines or mature recorded timeouts, never unoffered candidates.
    outcome = "accepted" if accepted_draw else rng.choice(["declined", "timedOut"])
    decision_at = (accepted_at if accepted_draw else timestamp + timedelta(seconds=rng.uniform(1, 119))
                   if outcome == "declined" else deadline + timedelta(seconds=5))
    return {"riderDistanceKm": distance, "activeWorkload": workload, "hourOfDay": hour,
            "dayOfWeek": day, "accepted": accepted_at is not None and timestamp <= accepted_at < deadline}, outcome, decision_at


def generate(config):
    bounds = validate_config(config)
    rng = random.Random(config.seed)
    rows, outcomes = [], {"accepted": 0, "declined": 0, "timedOut": 0}
    cutoff = bounds[-1] + timedelta(seconds=125)
    duration_us = int((bounds[-1] - bounds[0]).total_seconds() * 1000000)
    for i in range(config.row_count):
        # Deterministic evenly spaced offered-order instants in [start, end).
        timestamp = bounds[0] + timedelta(microseconds=duration_us * i // max(1, config.row_count))
        split = "train" if timestamp < bounds[1] else "validation" if timestamp < bounds[2] else "test"
        features, outcome, decision_at = synthetic_offer(rng, timestamp, config)
        if decision_at > cutoff:
            raise ValueError("immature_synthetic_outcome")
        outcomes[outcome] += 1
        rows.append({"schemaVersion": DATASET_VERSION, "rowKey": f"row-{i+1:06d}",
                     "orderGroupKey": f"order-group-{i+1:06d}", "split": split,
                     "predictionPoint": "DISPATCH_PRE_OFFER", **features})
    payload = b"".join((json.dumps(r, separators=(",", ":"), allow_nan=False) + "\n").encode("utf8") for r in rows)
    counts = {"sourceCandidates": len(rows), "offeredCandidates": len(rows), "exportedRows": len(rows),
              "acceptedRows": outcomes["accepted"], "declinedRows": outcomes["declined"], "timedOutRows": outcomes["timedOut"],
              "uniqueOrderGroups": len(rows), **{s: sum(r["split"] == s for r in rows) for s in ("train", "validation", "test")},
              "exclusionsByReason": {}, "rowsBySelectionPolicy": {"SYNTHETIC_OFFERED_ONLY": len(rows)}}
    manifest = {"schemaVersion": DATASET_VERSION, "dataProvenance": "SYNTHETIC", "generatorVersion": config.generator_version,
                "seed": config.seed, "generatorConfig": asdict(config), "rowCount": len(rows),
                "classCounts": {"accepted": outcomes["accepted"], "notAccepted": len(rows) - outcomes["accepted"]},
                "groupCount": len(rows), "generatedAt": config.generated_at, "gitCommit": config.git_commit,
                "timezoneOffsetMinutes": config.timezone_offset_minutes,
                "outcomeCutoff": cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "splits": dict(zip(("trainStart", "validationStart", "testStart", "testEnd"),
                                   (config.train_start, config.validation_start, config.test_start, config.test_end))),
                "featureContract": {"rawFeatures": list(RAW_KEYS), "predictionPoint": "DISPATCH_PRE_OFFER"},
                "labelContract": {"positive": "assignedAt <= acceptedAt < immutable offerExpiresAt",
                                  "negative": "explicit decline before deadline or mature recorded timeout; offered only",
                                  "immutableDeadlineRequired": True},
                "counts": counts, "jsonlSha256": hashlib.sha256(payload).hexdigest()}
    return payload, manifest


def write_dataset(directory, payload, manifest):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    paths = [directory / "dispatch-dataset.jsonl", directory / "dispatch-dataset.manifest.json"]
    if any(p.exists() for p in paths):
        raise FileExistsError("output_already_exists")
    for path, data in zip(paths, (payload, json_bytes(manifest))):
        with path.open("xb") as stream:
            stream.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("train-start", "validation-start", "test-start", "test-end", "generator-version", "generated-at", "git-commit", "output-directory"):
        parser.add_argument("--" + arg, required=True)
    for arg in ("seed", "row-count", "timezone-offset-minutes"):
        parser.add_argument("--" + arg, required=True, type=int)
    args = vars(parser.parse_args())
    output = args.pop("output_directory")
    write_dataset(output, *generate(GeneratorConfig(**args)))


if __name__ == "__main__":
    main()
