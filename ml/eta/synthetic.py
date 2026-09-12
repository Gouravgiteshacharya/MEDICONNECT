"""Seeded prototype delivery simulation. No observed MediConnect data or model fitting."""
import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import random

from features import encode_checkout_features, finite_number, FEATURE_CONTRACT_VERSION

GENERATOR_VERSION = "eta-synthetic-v1"
SCHEMA_VERSION = "eta-checkout-v1"


def utc_instant(value):
    """Strict explicit UTC ISO date, rejecting invalid dates and implicit timezones."""
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("invalid_utc_instant")
    try:
        result = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise ValueError("invalid_utc_instant") from None
    canonical = result.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if value not in (canonical, canonical.replace(".000Z", "Z")):
        raise ValueError("invalid_utc_instant")
    return result


@dataclass(frozen=True)
class GeneratorConfig:
    seed: int
    row_count: int
    train_start: str
    validation_start: str
    test_start: str
    test_end: str
    generator_version: str
    timezone_offset_minutes: int
    fallback_speed_kmh: float
    max_distance_km: float = 15.0
    max_item_count: int = 8
    base_preparation_minutes: float = 8.0
    travel_speed_kmh: float = 18.0
    item_minutes: float = 1.5
    peak_delay_minutes: float = 7.0
    weekend_minutes: float = 3.0
    noise_std_minutes: float = 2.5
    rare_delay_probability: float = 0.05
    shock_minutes: float = 20.0


def validate_config(config):
    if type(config.seed) is not int or type(config.row_count) is not int or config.row_count < 0:
        raise ValueError("invalid_seed_or_count")
    if config.generator_version != GENERATOR_VERSION:
        raise ValueError("unsupported_generator_version")
    if type(config.timezone_offset_minutes) is not int or not -720 <= config.timezone_offset_minutes <= 840:
        raise ValueError("invalid_timezone")
    if type(config.max_item_count) is not int or config.max_item_count <= 0:
        raise ValueError("invalid_item_limit")
    for value in (config.fallback_speed_kmh, config.travel_speed_kmh, config.max_distance_km):
        if not finite_number(value) or value <= 0:
            raise ValueError("invalid_positive_parameter")
    for value in (config.base_preparation_minutes, config.item_minutes, config.peak_delay_minutes,
                  config.weekend_minutes, config.noise_std_minutes, config.shock_minutes):
        if not finite_number(value) or value < 0:
            raise ValueError("invalid_nonnegative_parameter")
    if not finite_number(config.rare_delay_probability) or not 0 <= config.rare_delay_probability <= 1:
        raise ValueError("invalid_delay_probability")
    boundaries = tuple(utc_instant(value) for value in (
        config.train_start, config.validation_start, config.test_start, config.test_end))
    if not all(a < b for a, b in zip(boundaries, boundaries[1:])):
        raise ValueError("invalid_split_order")
    return boundaries


def assign_split(placed_at, boundaries):
    start, validation, test, end = boundaries
    if not start <= placed_at < end:
        raise ValueError("outside_split_window")
    return "train" if placed_at < validation else "validation" if placed_at < test else "test"


def generate_dataset(config):
    """Return rows and sidecar. All randomness is local to seed; no clock is read."""
    boundaries = validate_config(config)
    rng = random.Random(config.seed)
    start, _, _, end = boundaries
    duration = end - start
    span_ms = duration.days * 86_400_000 + duration.seconds * 1000 + duration.microseconds // 1000
    pending = []
    for index in range(config.row_count):
        placed = start + timedelta(milliseconds=rng.randrange(span_ms))
        local = placed + timedelta(minutes=config.timezone_offset_minutes)
        hour, day = local.hour, (local.weekday() + 1) % 7  # Sunday = 0
        distance = config.max_distance_km * rng.betavariate(2, 5)
        count = rng.randint(1, config.max_item_count)
        raw = {"distanceKm": distance, "itemCount": count, "hourOfDay": hour, "dayOfWeek": day}
        encode_checkout_features(raw)
        peak = 8 <= hour < 11 or 17 <= hour < 21
        # Piecewise peak effect, distance interaction and sqrt(count) are not a ridge dot product.
        actual = (config.base_preparation_minutes + distance / config.travel_speed_kmh * 60
                  + config.item_minutes * math.sqrt(count)
                  + (config.peak_delay_minutes * (1 + distance / config.max_distance_km) if peak else 0)
                  + (config.weekend_minutes if day in (0, 6) else 0)
                  + rng.gauss(0, config.noise_std_minutes)
                  + (config.shock_minutes * rng.uniform(0.5, 1.5) if rng.random() < config.rare_delay_probability else 0))
        baseline = distance / config.fallback_speed_kmh * 60
        if not math.isfinite(actual) or not math.isfinite(baseline):
            raise ValueError("generation_overflow")
        pending.append((placed, index, {
            "schemaVersion": SCHEMA_VERSION, "rowKey": "", "predictionPoint": "CHECKOUT",
            "split": assign_split(placed, boundaries), "distanceKm": distance, "itemCount": count,
            "hourOfDay": hour, "dayOfWeek": day, "quotedEtaMinutes": None,
            "distanceBaselineMinutes": math.ceil(baseline), "actualDurationMinutes": max(0.1, actual),
        }))
    pending.sort(key=lambda entry: (entry[0], entry[1]))
    rows = []
    for index, (_, _, row) in enumerate(pending, 1):
        row["rowKey"] = f"row-{index:06d}"
        rows.append(row)
    jsonl = serialize_rows(rows)
    manifest = {
        "schemaVersion": SCHEMA_VERSION, "dataProvenance": "SYNTHETIC",
        "generatorVersion": config.generator_version, "seed": config.seed,
        "generatorConfig": asdict(config), "featureContractVersion": FEATURE_CONTRACT_VERSION,
        "baseline": {"source": "distance_speed_baseline", "fallbackSpeedKmh": config.fallback_speed_kmh},
        "splitCounts": {split: sum(row["split"] == split for row in rows) for split in ("train", "validation", "test")},
        "splitPolicy": "Half-open placement windows; retrospective simulation, no per-split outcome maturity filtering",
        "labelPolicy": "Synthetic preparation + travel + item + peak + weekend + noise + shock; floor 0.1 minutes",
        "randomAlgorithm": "Python random.Random MT19937; reproduce with the same Python version",
        "rowCount": len(rows), "jsonlSha256": hashlib.sha256(jsonl.encode("utf-8")).hexdigest(),
    }
    return rows, manifest


def serialize_rows(rows):
    return "".join(json.dumps(row, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n" for row in rows)


def write_dataset(config, output_directory):
    rows, manifest = generate_dataset(config)
    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    # Exclusive creation; no overwrite. Failure may leave partial files; retry in a fresh directory.
    with (directory / "eta-dataset.jsonl").open("x", encoding="utf-8", newline="\n") as data:
        with (directory / "eta-dataset.manifest.json").open("x", encoding="utf-8", newline="\n") as sidecar:
            data.write(serialize_rows(rows))
            sidecar.write(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate explicitly SYNTHETIC prototype ETA rows; no training")
    parser.add_argument("--config", required=True, help="JSON object matching GeneratorConfig")
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    config = GeneratorConfig(**json.loads(Path(args.config).read_text(encoding="utf-8")))
    manifest = write_dataset(config, args.output_directory)
    print(json.dumps({"dataProvenance": manifest["dataProvenance"], "rowCount": manifest["rowCount"], "splitCounts": manifest["splitCounts"]}))
