"""Strict offline dataset and portable JSON I/O. Never connects to a database."""
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from features import encode_dispatch_features, finite_number, ORDERED_FEATURES, FEATURE_CONTRACT_VERSION

DATASET_VERSION = "dispatch-acceptance-v1"
ARTIFACT_VERSION = "dispatch-model-artifact-v1"
RAW_KEYS = ("riderDistanceKm", "activeWorkload", "hourOfDay", "dayOfWeek")
ROW_KEYS = set(RAW_KEYS) | {"schemaVersion", "rowKey", "orderGroupKey", "split", "predictionPoint", "accepted"}
SPLITS = ("train", "validation", "test")


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate_json_key")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("nonfinite_json")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf8")


def utc_instant(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", value):
        raise ValueError("invalid_utc_instant")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def count(value):
    return finite_number(value) and value % 1 == 0 and 0 <= value <= 9007199254740991


def validate_artifact(a):
    keys = {"artifactSchemaVersion", "modelType", "modelVersion", "datasetSchemaVersion", "featureContractVersion", "orderedFeatures", "preprocessing", "coefficients", "intercept", "output", "trainingMetadata", "evaluation"}
    if not isinstance(a, dict) or set(a) != keys:
        raise ValueError("invalid_artifact_shape")
    if (a["artifactSchemaVersion"] != ARTIFACT_VERSION or a["modelType"] != "logistic_regression"
        or a["datasetSchemaVersion"] != DATASET_VERSION or a["featureContractVersion"] != FEATURE_CONTRACT_VERSION
        or a["orderedFeatures"] != list(ORDERED_FEATURES)
        or a["output"] != {"type": "acceptance_probability", "positiveClass": "accepted_before_expiry"}):
        raise ValueError("incompatible_artifact")
    prep = a["preprocessing"]
    if not isinstance(prep, dict) or set(prep) != {"means", "scales"}:
        raise ValueError("invalid_preprocessing")
    for v in (prep["means"], prep["scales"], a["coefficients"]):
        if not isinstance(v, list) or len(v) != 10 or not all(finite_number(x) for x in v):
            raise ValueError("invalid_parameters")
    if any(s <= 0 for s in prep["scales"]) or not finite_number(a["intercept"]):
        raise ValueError("invalid_parameters")
    m = a["trainingMetadata"]
    if not isinstance(m, dict) or set(m) != {"dataProvenance", "datasetSha256", "gitCommit", "trainedAt", "trainingRows", "validationRows", "testRows"}:
        raise ValueError("invalid_metadata")
    if (not nonempty(a["modelVersion"]) or m["dataProvenance"] not in ("REAL", "SYNTHETIC", "MIXED")
        or not isinstance(m["datasetSha256"], str) or not re.fullmatch("[a-fA-F0-9]{64}", m["datasetSha256"])
        or not nonempty(m["gitCommit"]) or not all(count(m[k]) for k in ("trainingRows", "validationRows", "testRows"))):
        raise ValueError("invalid_metadata")
    utc_instant(m["trainedAt"])
    ev = a["evaluation"]
    if not isinstance(ev, dict) or set(ev) != {"validationLogLoss", "testLogLoss", "validationBrier", "testBrier"} or any(v is not None and (not finite_number(v) or v < 0) for v in ev.values()):
        raise ValueError("invalid_evaluation")
    return a


def load_dataset(jsonl_path, manifest_path):
    payload = Path(jsonl_path).read_bytes()
    manifest = strict_json(Path(manifest_path).read_text(encoding="utf8"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != DATASET_VERSION or manifest.get("dataProvenance") not in ("REAL", "SYNTHETIC", "MIXED"):
        raise ValueError("invalid_manifest_contract")
    if manifest.get("jsonlSha256") != hashlib.sha256(payload).hexdigest():
        raise ValueError("checksum_mismatch")
    bounds = manifest.get("splits")
    if not isinstance(bounds, dict) or set(bounds) != {"trainStart", "validationStart", "testStart", "testEnd"}:
        raise ValueError("invalid_boundaries")
    times = [utc_instant(bounds[k]) for k in ("trainStart", "validationStart", "testStart", "testEnd")]
    if any(a >= b for a, b in zip(times, times[1:])):
        raise ValueError("invalid_boundaries")
    offset = manifest.get("timezoneOffsetMinutes")
    if not finite_number(offset) or offset % 1 != 0 or not -840 <= offset <= 840:
        raise ValueError("invalid_timezone")
    if manifest.get("featureContract") != {"rawFeatures": list(RAW_KEYS), "predictionPoint": "DISPATCH_PRE_OFFER"}:
        raise ValueError("invalid_feature_contract")
    if not isinstance(manifest.get("labelContract"), dict) or manifest["labelContract"].get("immutableDeadlineRequired") is not True:
        raise ValueError("invalid_label_contract")
    utc_instant(manifest.get("generatedAt"))
    if not nonempty(manifest.get("gitCommit")):
        raise ValueError("invalid_git_commit")
    if payload.startswith(b"\xef\xbb\xbf") or (payload and not payload.endswith(b"\n")) or b"\r" in payload:
        raise ValueError("invalid_jsonl_encoding")
    rows = [strict_json(line) for line in payload.decode("utf8").splitlines()]
    groups, previous_split = {}, -1
    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) != ROW_KEYS:
            raise ValueError("invalid_row_shape")
        if row["schemaVersion"] != DATASET_VERSION or row["predictionPoint"] != "DISPATCH_PRE_OFFER" or row["split"] not in SPLITS or type(row["accepted"]) is not bool:
            raise ValueError("invalid_row_contract")
        encode_dispatch_features({k: row[k] for k in RAW_KEYS})
        if row["rowKey"] != f"row-{i:06d}" or not isinstance(row["orderGroupKey"], str) or not re.fullmatch(r"order-group-\d{6,}", row["orderGroupKey"]):
            raise ValueError("invalid_export_keys")
        group = row["orderGroupKey"]
        if group in groups and groups[group] != row["split"]:
            raise ValueError("cross_split_group")
        if group not in groups:
            if group != f"order-group-{len(groups)+1:06d}":
                raise ValueError("nonsequential_group")
            groups[group] = row["split"]
        split_index = SPLITS.index(row["split"])
        if split_index < previous_split:
            raise ValueError("non_temporal_split_order")
        previous_split = split_index
    counts = manifest.get("counts")
    if not isinstance(counts, dict):
        raise ValueError("invalid_counts")
    expected = {"exportedRows": len(rows), "acceptedRows": sum(r["accepted"] for r in rows), "uniqueOrderGroups": len(groups), **{s: sum(r["split"] == s for r in rows) for s in SPLITS}}
    if any(not count(counts.get(k)) or counts[k] != v for k, v in expected.items()):
        raise ValueError("count_mismatch")
    if any(not count(counts.get(k)) for k in ("declinedRows", "timedOutRows")) or counts["declinedRows"] + counts["timedOutRows"] != len(rows) - expected["acceptedRows"]:
        raise ValueError("class_count_mismatch")
    policies = counts.get("rowsBySelectionPolicy")
    if not isinstance(policies, dict) or not policies or not all(count(v) for v in policies.values()) or sum(policies.values()) != len(rows):
        raise ValueError("invalid_policy_counts")
    if "rowCount" in manifest and (not count(manifest["rowCount"]) or manifest["rowCount"] != len(rows)):
        raise ValueError("row_count_mismatch")
    return rows, manifest


def write_outputs(directory, report, artifact):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    model_path, report_path = directory / "dispatch-model.json", directory / "dispatch-evaluation.report.json"
    if model_path.exists() or report_path.exists():
        raise FileExistsError("output_already_exists")
    report = dict(report)
    report["artifactSha256"] = None
    if artifact is not None:
        data = json_bytes(validate_artifact(artifact))
        report["artifactSha256"] = hashlib.sha256(data).hexdigest()
        with model_path.open("xb") as stream:
            stream.write(data)
    with report_path.open("xb") as stream:
        stream.write(json_bytes(report))
    return report
