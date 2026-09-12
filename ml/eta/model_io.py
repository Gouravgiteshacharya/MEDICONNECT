"""Strict artifact-file input validation and exclusive deterministic output."""
import hashlib
import json
import math
from pathlib import Path

from features import encode_checkout_features, finite_number
from synthetic import GeneratorConfig, validate_config, utc_instant

ROW_KEYS = {"schemaVersion", "rowKey", "predictionPoint", "split", "distanceKm", "itemCount", "hourOfDay", "dayOfWeek", "quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes"}
RAW_KEYS = ("distanceKm", "itemCount", "hourOfDay", "dayOfWeek")


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate_json_key")
            result[key] = value
        return result

    def reject_constant(_):
        raise ValueError("nonfinite_json")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=reject_constant)


def load_dataset(dataset_path, manifest_path):
    data = Path(dataset_path).read_bytes()
    manifest = strict_json(Path(manifest_path).read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "eta-checkout-v1":
        raise ValueError("invalid_manifest_schema")
    if manifest.get("dataProvenance") not in ("REAL", "SYNTHETIC", "MIXED"):
        raise ValueError("invalid_provenance")
    if manifest.get("jsonlSha256") != hashlib.sha256(data).hexdigest():
        raise ValueError("checksum_mismatch")
    baseline = manifest.get("baseline", {})
    if not isinstance(baseline, dict) or baseline.get("source") != "distance_speed_baseline":
        raise ValueError("invalid_baseline_metadata")
    speed = baseline.get("fallbackSpeedKmh")
    if not finite_number(speed) or speed <= 0:
        raise ValueError("invalid_baseline_speed")
    if "generatorConfig" in manifest:
        try:
            config = GeneratorConfig(**manifest["generatorConfig"])
            validate_config(config)
        except (TypeError, ValueError):
            raise ValueError("invalid_generator_configuration") from None
        if config.fallback_speed_kmh != speed:
            raise ValueError("inconsistent_baseline_configuration")
    else:
        splits = manifest.get("splits")
        if not isinstance(splits, dict):
            raise ValueError("missing_dataset_configuration")
        try:
            boundaries = [utc_instant(splits[key]) for key in ("trainStart", "validationStart", "testStart", "testEnd")]
        except (KeyError, ValueError):
            raise ValueError("invalid_split_configuration") from None
        offset = manifest.get("timezoneOffsetMinutes")
        if not all(a < b for a, b in zip(boundaries, boundaries[1:])) or type(offset) is not int or not -720 <= offset <= 840:
            raise ValueError("invalid_split_configuration")
    if data.startswith(b"\xef\xbb\xbf") or (data and not data.endswith(b"\n")):
        raise ValueError("invalid_jsonl_framing")
    rows, seen = [], set()
    previous_split = -1
    for line in data.decode("utf-8").splitlines():
        row = strict_json(line)
        if not isinstance(row, dict) or set(row) != ROW_KEYS or row["schemaVersion"] != "eta-checkout-v1" or row["predictionPoint"] != "CHECKOUT":
            raise ValueError("invalid_row_schema")
        if row["split"] not in ("train", "validation", "test"):
            raise ValueError("invalid_split")
        rank = ("train", "validation", "test").index(row["split"])
        if rank < previous_split:
            raise ValueError("non_temporal_split_order")
        previous_split = rank
        key = row["rowKey"]
        if not isinstance(key, str) or key != f"row-{len(rows) + 1:06d}" or key in seen:
            raise ValueError("invalid_row_key")
        seen.add(key)
        encode_checkout_features({key: row[key] for key in RAW_KEYS})
        actual, quoted, predicted = (row[k] for k in ("actualDurationMinutes", "quotedEtaMinutes", "distanceBaselineMinutes"))
        if not finite_number(actual) or actual <= 0:
            raise ValueError("invalid_label")
        if quoted is not None and (not finite_number(quoted) or quoted < 0 or quoted % 1 != 0):
            raise ValueError("invalid_quoted_eta")
        expected = row["distanceKm"] / speed * 60
        if not math.isfinite(expected) or not finite_number(predicted) or predicted < 0 or predicted % 1 != 0 or predicted != math.ceil(expected):
            raise ValueError("invalid_distance_baseline")
        rows.append(row)
    if type(manifest.get("rowCount")) is not int or manifest["rowCount"] != len(rows):
        raise ValueError("row_count_mismatch")
    counts = {split: sum(row["split"] == split for row in rows) for split in ("train", "validation", "test")}
    if "splitCounts" in manifest and (manifest["splitCounts"] != counts or any(type(n) is not int for n in manifest["splitCounts"].values())):
        raise ValueError("split_count_mismatch")
    return rows, manifest


def json_bytes(value):
    """Sorted keys, two-space indentation, UTF-8, one final LF, no NaN/Infinity."""
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def write_outputs(output_directory, artifact, report):
    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    model_path = directory / "eta-model.json"
    report_path = directory / "eta-evaluation.report.json"
    # Also reject stale model files for a NO_MODEL_SELECTED report.
    if model_path.exists() or report_path.exists():
        raise FileExistsError("output_exists")
    model_bytes = json_bytes(artifact) if artifact is not None else None
    report = dict(report, modelArtifactSha256=hashlib.sha256(model_bytes).hexdigest() if model_bytes is not None else None)
    report_bytes = json_bytes(report)
    # Exclusive file creation; failures can leave a partial pair. Retry in a fresh directory.
    with report_path.open("xb") as output:
        if model_bytes is not None:
            with model_path.open("xb") as model:
                model.write(model_bytes)
        output.write(report_bytes)
    return report
