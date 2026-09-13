from dataclasses import replace
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import random
import tempfile
import unittest
from synthetic import GeneratorConfig, GENERATOR_VERSION, generate, synthetic_offer, write_dataset
from model_io import ROW_KEYS, load_dataset, utc_instant


def config(**overrides):
    c = GeneratorConfig(seed=31, row_count=1200, train_start="2026-01-01T00:00:00Z",
        validation_start="2026-03-01T00:00:00Z", test_start="2026-04-01T00:00:00Z",
        test_end="2026-05-01T00:00:00Z", timezone_offset_minutes=330,
        generator_version=GENERATOR_VERSION, generated_at="2026-05-02T00:00:00Z", git_commit="fixture")
    return replace(c, **overrides)


class SyntheticTests(unittest.TestCase):
    def test_same_seed_stable(self):
        self.assertEqual(generate(config()), generate(config()))

    def test_different_seed_differs(self):
        self.assertNotEqual(generate(config())[0], generate(config(seed=32))[0])

    def test_class_diversity(self):
        data, manifest = generate(config())
        rows = [json.loads(s) for s in data.splitlines()]
        for split in ("train", "validation", "test"):
            self.assertEqual({r["accepted"] for r in rows if r["split"] == split}, {True, False})
        self.assertEqual(manifest["classCounts"]["accepted"], sum(r["accepted"] for r in rows))

    def test_group_integrity_and_no_pii(self):
        data, manifest = generate(config())
        rows = [json.loads(s) for s in data.splitlines()]
        self.assertEqual(len({r["orderGroupKey"] for r in rows}), len(rows))
        for row in rows:
            self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(manifest["counts"]["offeredCandidates"], len(rows))
        self.assertEqual(manifest["dataProvenance"], "SYNTHETIC")
        self.assertEqual(manifest["generatorConfig"]["seed"], 31)

    def test_temporal_boundaries_and_offset(self):
        c = config(row_count=8, train_start="2026-01-01T00:00:00Z", validation_start="2026-01-01T02:00:00Z", test_start="2026-01-01T05:00:00Z", test_end="2026-01-01T08:00:00Z")
        rows = [json.loads(s) for s in generate(c)[0].splitlines()]
        self.assertEqual([r["split"] for r in rows], ["train"] * 2 + ["validation"] * 3 + ["test"] * 3)
        self.assertEqual([r["hourOfDay"] for r in rows], list(range(5, 13)))
        self.assertTrue(all(r["dayOfWeek"] == 4 for r in rows))

    def test_checksum_and_roundtrip(self):
        data, manifest = generate(config())
        self.assertEqual(manifest["jsonlSha256"], hashlib.sha256(data).hexdigest())
        with tempfile.TemporaryDirectory() as tmp:
            write_dataset(tmp, data, manifest)
            rows, actual = load_dataset(Path(tmp) / "dispatch-dataset.jsonl", Path(tmp) / "dispatch-dataset.manifest.json")
            self.assertEqual(len(rows), 1200)
            self.assertEqual(actual, manifest)
            with self.assertRaises(FileExistsError):
                write_dataset(tmp, data, manifest)

    def test_invalid_config(self):
        for changes in ({"seed": True}, {"row_count": -1}, {"timezone_offset_minutes": 900}, {"generator_version": "v0"}, {"train_start": "yesterday"}, {"test_end": "2026-01-01T00:00:00Z"}, {"git_commit": " "}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                generate(config(**changes))

    def test_deadline_semantics(self):
        now = utc_instant(config().train_start)
        rng = random.Random(1)
        outcomes = set()
        for _ in range(500):
            row, outcome, decision = synthetic_offer(rng, now, config())
            outcomes.add(outcome)
            self.assertEqual(row["accepted"], outcome == "accepted")
            if outcome == "accepted":
                self.assertTrue(now <= decision < now + timedelta(seconds=120))
            elif outcome == "declined":
                self.assertTrue(now < decision < now + timedelta(seconds=120))
            else:
                self.assertGreaterEqual(decision, now + timedelta(seconds=120))
        self.assertEqual(outcomes, {"accepted", "declined", "timedOut"})

    def test_empty_dataset(self):
        data, manifest = generate(config(row_count=0))
        self.assertEqual(data, b"")
        self.assertEqual(manifest["counts"]["exportedRows"], 0)
