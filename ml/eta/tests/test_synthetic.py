from dataclasses import replace
from datetime import timedelta
import hashlib
import json
import math
from pathlib import Path
import tempfile
import unittest

from features import encode_checkout_features
from synthetic import GeneratorConfig, generate_dataset, serialize_rows, assign_split, validate_config, write_dataset


def config(**changes):
    return replace(GeneratorConfig(
        seed=42, row_count=300, train_start="2026-01-01T00:00:00Z",
        validation_start="2026-02-01T00:00:00Z", test_start="2026-03-01T00:00:00Z",
        test_end="2026-04-01T00:00:00Z", generator_version="eta-synthetic-v1",
        timezone_offset_minutes=330, fallback_speed_kmh=20,
    ), **changes)


class SyntheticTests(unittest.TestCase):
    def test_seed_determinism(self):
        first = generate_dataset(config())
        self.assertEqual(first, generate_dataset(config()))
        self.assertNotEqual(first[0], generate_dataset(config(seed=43))[0])
        self.assertEqual(serialize_rows(first[0]), serialize_rows(generate_dataset(config())[0]))

    def test_exact_row_contract_and_validity(self):
        rows, manifest = generate_dataset(config())
        keys = {"schemaVersion", "rowKey", "predictionPoint", "split", "distanceKm", "itemCount", "hourOfDay", "dayOfWeek", "quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes"}
        self.assertEqual(len(rows), 300)
        for index, row in enumerate(rows, 1):
            self.assertEqual(set(row), keys)
            self.assertEqual(row["schemaVersion"], "eta-checkout-v1")
            self.assertEqual(row["predictionPoint"], "CHECKOUT")
            self.assertEqual(row["rowKey"], f"row-{index:06d}")
            self.assertIn(row["split"], ("train", "validation", "test"))
            self.assertGreater(row["actualDurationMinutes"], 0)
            self.assertTrue(math.isfinite(row["actualDurationMinutes"]))
            self.assertIsNone(row["quotedEtaMinutes"])
            self.assertEqual(row["distanceBaselineMinutes"], math.ceil(row["distanceKm"] / 20 * 60))
            encode_checkout_features({key: row[key] for key in ("distanceKm", "itemCount", "hourOfDay", "dayOfWeek")})
        split_order = {"train": 0, "validation": 1, "test": 2}
        self.assertEqual([split_order[r["split"]] for r in rows], sorted(split_order[r["split"]] for r in rows))
        self.assertEqual(sum(manifest["splitCounts"].values()), 300)

    def test_half_open_boundaries(self):
        bounds = validate_config(config())
        start, validation, test, end = bounds
        for instant, expected in ((start, "train"), (validation - timedelta(milliseconds=1), "train"),
                                  (validation, "validation"), (test - timedelta(milliseconds=1), "validation"),
                                  (test, "test"), (end - timedelta(milliseconds=1), "test")):
            self.assertEqual(assign_split(instant, bounds), expected)
        for instant in (start - timedelta(milliseconds=1), end):
            with self.assertRaises(ValueError):
                assign_split(instant, bounds)

    def test_generated_time_features_and_split_follow_placement(self):
        # A one-millisecond overall window is impossible with three splits; use three milliseconds.
        cfg = config(train_start="2026-01-03T20:00:00.000Z", validation_start="2026-01-03T20:00:00.001Z",
                     test_start="2026-01-03T20:00:00.002Z", test_end="2026-01-03T20:00:00.003Z")
        rows, _ = generate_dataset(cfg)
        self.assertEqual({r["dayOfWeek"] for r in rows}, {0})
        self.assertEqual({r["hourOfDay"] for r in rows}, {1})
        self.assertEqual({r["split"] for r in rows}, {"train", "validation", "test"})

    def test_provenance_checksum_and_privacy(self):
        rows, manifest = generate_dataset(config())
        text = serialize_rows(rows)
        self.assertEqual(manifest["dataProvenance"], "SYNTHETIC")
        self.assertEqual(manifest["seed"], 42)
        self.assertEqual(manifest["generatorVersion"], "eta-synthetic-v1")
        self.assertEqual(manifest["rowCount"], 300)
        self.assertEqual(manifest["jsonlSha256"], hashlib.sha256(text.encode("utf-8")).hexdigest())
        for forbidden in ("orderId", "customerId", "riderId", "pharmacyId", "latitude", "longitude", "address", "phone", "prescription", "placedAt", "deliveredAt", "completedAt", "2026-"):
            self.assertNotIn(forbidden, text)

    def test_baseline_speed_does_not_change_labels(self):
        rows, _ = generate_dataset(config())
        faster, _ = generate_dataset(config(fallback_speed_kmh=40))
        self.assertEqual([r["actualDurationMinutes"] for r in rows], [r["actualDurationMinutes"] for r in faster])
        self.assertNotEqual([r["distanceBaselineMinutes"] for r in rows], [r["distanceBaselineMinutes"] for r in faster])

    def test_empty_output(self):
        rows, manifest = generate_dataset(config(row_count=0))
        self.assertEqual(rows, [])
        self.assertEqual(serialize_rows(rows), "")
        self.assertEqual(manifest["rowCount"], 0)

    def test_output_bytes_and_no_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="eta-synthetic-test-") as directory:
            manifest = write_dataset(config(row_count=3), directory)
            data = (Path(directory) / "eta-dataset.jsonl").read_bytes()
            self.assertTrue(data.endswith(b"\n"))
            self.assertNotIn(b"\r", data)
            self.assertFalse(data.startswith(b"\xef\xbb\xbf"))
            self.assertEqual(manifest["jsonlSha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(json.loads((Path(directory) / "eta-dataset.manifest.json").read_text()), manifest)
            with self.assertRaises(FileExistsError):
                write_dataset(config(row_count=3), directory)

    def test_invalid_configuration(self):
        for change in ({"row_count": -1}, {"seed": True}, {"fallback_speed_kmh": 0},
                       {"timezone_offset_minutes": 841}, {"generator_version": "unknown"},
                       {"train_start": "2026-03-01T00:00:00Z"}, {"test_end": "invalid"},
                       {"rare_delay_probability": 2}, {"noise_std_minutes": -1}, {"max_item_count": 0}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                generate_dataset(config(**change))
