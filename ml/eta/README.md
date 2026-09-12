# Checkout ETA prototype infrastructure

## Phase 11D: isolated Node inference

`CheckoutEtaModel` validates and copies a portable JSON artifact, encodes the four checkout features, then computes `intercept + sum(coefficient[i] * (encoded[i] - mean[i]) / scale[i])`. It returns continuous minutes and the artifact's exact model version. There is no rounding, clipping or baseline call. Invalid artifacts/features, nonfinite or nonpositive predictions, and predictions above an optional explicit caller limit return typed unavailable results. Production fallback orchestration remains deferred to 11E; no quote, dispatch or app wiring is added.

`loadEtaModelArtifact` reads only an explicit filesystem path through an injectable UTF-8 reader. It maps missing files, read failures, malformed JSON and invalid contracts to allowlisted reasons without raw errors. URLs and empty paths are rejected. A configurable 65,536-byte default cap is checked after reading and before parsing; it is not a streaming memory limit. Optional checksum verification is not implemented. No environment lookup, discovery, network fetch, executable serialization or dynamic code is used.

`backend/test/fixtures/eta-model-artifact.synthetic.test.json` is a hand-calculable SYNTHETIC test-only contract fixture, not a fitted model or the 11C artifact. Its zero row counts, empty-content checksum and explicit test-only version identify that purpose. `fixtures/prediction-parity.json` is shared by Python and TypeScript tests at `1e-9` tolerance. These tests do not depend on ignored generated files or sklearn inference.

Phase 11A defines contracts and synthetic generation only. No model is trained or loaded into production. The prediction point is `CHECKOUT`; the target is successful delivery time minus order placement time, in fractional minutes. A future ridge model will consume exported datasets without querying a live database. Node inference will consume a validated portable JSON artifact, never pickle/joblib.

## Features and artifact

`feature-contract.json` specifies `eta-checkout-features-v1`. Raw inputs are exactly `distanceKm` (finite, nonnegative), `itemCount` (positive integer item-line count), `hourOfDay` (integer 0–23), and `dayOfWeek` (integer 0–6; Sunday=0). Extra keys, strings and booleans are rejected. A training reader must explicitly select these four fields from dataset rows.

Encoded order is `distanceKm, itemCount, hourSin, hourCos, isMonday, isTuesday, isWednesday, isThursday, isFriday, isSaturday`. Hour terms are `sin(2*pi*hour/24)` and `cos(2*pi*hour/24)`; Sunday has all weekday indicators zero. No scaling is applied by the encoder. Future training must fit scaling on train only. Shared synthetic fixtures in `fixtures/feature-parity.json` verify Python/TypeScript parity with absolute tolerance `1e-12`.

The TypeScript contract `eta-model-artifact-v1` specifies ridge coefficients, intercept, ten means/scales, exact feature order, minutes output, provenance, checksum and training/evaluation metadata. Validation rejects unknown fields, incompatible versions, nonfinite numbers, nonpositive scales, invalid row counts and malformed metadata. Training time must be a canonical UTC ISO instant with seconds and optional three-digit milliseconds. No fitted artifact is included.

## Python environment and tests

Use Python 3.12. Phase 11A uses only the standard library; no installation is needed. From `ml/eta` run:

```text
python -B -m unittest discover -s tests -v
```

If Python is not on PATH, substitute the full path of an available interpreter. The implementation environment provides bundled Python 3.12.14, NumPy 2.3.5 and pandas 3.0.1; scikit-learn is absent. `requirements.txt` pins direct dependencies for future training, not a verified transitive environment lock. No packages were installed. The future scikit-learn 1.8.0 pin supports Python 3.12 according to its [release metadata](https://pypi.org/project/scikit-learn/1.8.0/); integration remains to be tested in 11B.

## Synthetic generation

`synthetic.py` models assumed behavior, not observed MediConnect behavior. Synthetic results are prototype-only; real and synthetic metrics must stay separate. No PII, domain identifiers, database calls or map/routing providers are used. Exact internally generated placement timestamps are omitted from rows. Quotes are always null and labels never depend on quoted ETA or the distance baseline.

Supply an explicit JSON configuration with these required fields (example only; no configuration or dataset is generated automatically):

```json
{
  "seed": 42,
  "row_count": 1000,
  "train_start": "2026-01-01T00:00:00Z",
  "validation_start": "2026-02-01T00:00:00Z",
  "test_start": "2026-03-01T00:00:00Z",
  "test_end": "2026-04-01T00:00:00Z",
  "generator_version": "eta-synthetic-v1",
  "timezone_offset_minutes": 330,
  "fallback_speed_kmh": 20
}
```

From `ml/eta`, explicitly run `python -B synthetic.py --config PATH_TO_CONFIG.json --output-directory generated/demo` when a prototype dataset is wanted. Imported modules perform no output. Functions also return rows/manifest in memory for tests.

Documented optional defaults:

| Parameter | Default / semantics |
|---|---|
| `max_distance_km` | 15; distance = maximum × Beta(2,5) draw |
| `max_item_count` | 8; uniform integer from 1 to maximum |
| `base_preparation_minutes` | 8 |
| `travel_speed_kmh` | 18; label travel term = distance / speed × 60 |
| `item_minutes` | 1.5 × square root of item count |
| `peak_delay_minutes` | 7 × (1 + distance / maximum distance) during hours [8,11) or [17,21) |
| `weekend_minutes` | 3 on Sunday/Saturday |
| `noise_std_minutes` | 2.5; zero-mean Gaussian noise |
| `rare_delay_probability` | 0.05 |
| `shock_minutes` | 20 × uniform(0.5,1.5) when shock occurs |

The label is the sum of those components, floored at 0.1 minutes. Peak thresholds, distance interaction, square-root count effect and independent noise prevent labels being an exact ridge dot product. This simulation is not a calibrated business model.

Placement milliseconds are sampled uniformly over the explicit overall window, then assigned to half-open temporal splits. Hour/weekday use the fixed offset. Rows sort by placement then synthetic generation index before receiving `row-000001` keys. Small datasets can have empty splits. This is retrospective synthetic simulation, not strict per-split outcome-maturity filtering; no historical deployment claim is made.

`distanceBaselineMinutes = ceil(distanceKm / fallbackSpeedKmh * 60)`, without intermediate rounding. Fallback speed is required independently of the simulated travel speed. No training, alpha selection, coefficient computation or model comparison occurs.

Outputs are UTF-8 `eta-dataset.jsonl` and `eta-dataset.manifest.json`. Rows preserve exactly `eta-checkout-v1`; sidecar metadata records `SYNTHETIC`, seed, generator version/config, split counts, assumptions and SHA-256 of exact JSONL bytes. No REAL database-source fields are fabricated. Empty generation writes empty JSONL with a manifest. Both paths use exclusive creation; failures can leave partial files, so retry into a fresh directory. Use identical Python version/config/seed for repeatability; cross-language feature parity permits the declared floating-point tolerance.

The separate Prisma export CLI is locked to `REAL`; the general export API requires explicit `REAL`, `SYNTHETIC` or `MIXED` metadata. Provenance declares the operator's source and is not proof of authenticity. No automatic mixing is implemented.

## Phase 11B: offline ridge training

`train.py` consumes an existing JSONL/manifest pair; it never generates data implicitly or queries a database. First run the explicit synthetic-generation workflow above. Use the pinned training environment in `requirements.txt`. Installation must be separately authorized; no global Python environment is modified by this code. With authorization, create an isolated environment and install those requirements there. Actual ridge fitting requires scikit-learn; the current implementation environment lacks it, so fitting/reproducibility tests are explicitly skipped until it is available. Dependency-independent orchestration tests use labeled test doubles, not substitute training algorithms.

From `ml/eta`, an example explicit training invocation is:

```text
python -B train.py --dataset generated/demo/eta-dataset.jsonl --manifest generated/demo/eta-dataset.manifest.json --output-directory artifacts/demo --model-version eta-ridge-synthetic-v1 --git-commit YOUR_COMMIT --trained-at 2026-09-12T00:00:00Z --alphas 0.01 0.1 1 10 100
```

Replace the example metadata explicitly. No timestamp or split depends on today's date. Input validation checks exact bytes/checksum, row schema, row counts, optional split counts, provenance, generator/split configuration, baseline formula and ordered temporal split blocks. Missing/invalid rows are rejected rather than repaired. UTC source timestamps are absent from privacy-safe rows, so training trusts the exporter for within-split timing and cannot independently prove per-split outcome maturity. REAL/MIXED provenance is retained if explicitly provided by another authorized workflow; implementation tests use SYNTHETIC only.

Encoding reuses `features.py`. Means and population standard deviations (`ddof=0`) are fitted on TRAIN only; zero scales become 1. Target minutes are not standardized. Each positive alpha fits `sklearn.linear_model.Ridge(fit_intercept=True, solver="svd")`. Alpha zero is intentionally omitted to keep this a regularized-ridge search; it is not claimed that sklearn rejects zero. Validation and test never fit preprocessing. The unchanged selected TRAIN-fitted model is evaluated on TEST; there is no train+validation refit.

Selection uses validation MAE, then P90 absolute error, absolute signed bias and smaller alpha. Proposed prototype guardrails require strict MAE improvement over the distance baseline, no more than 10% higher P90 absolute error, no more than 0.10 absolute increase in over-promise rate, and no more than five minutes of additional negative bias. These are configurable CLI options (`--p90-relative-tolerance`, `--overpromise-absolute-tolerance`, `--negative-bias-tolerance-minutes`), not production thresholds. P90 late minutes are always reported; optional `--p90-late-relative-tolerance` adds an explicit gate. All model validation predictions must be finite and strictly positive. No passing candidate produces `NO_MODEL_SELECTED` and a report only, never an approved model artifact.

Predictions are never clipped. Metrics follow TypeScript: finite predictions >=0 and actuals >0; invalid observations are excluded with counts. Model runtime-readiness additionally treats zero as unavailable. Negative/nonfinite model predictions are excluded from metrics but counted as invalid, and any invalid validation prediction disqualifies the candidate. Thus a reduced metric cohort cannot make an invalid candidate win. Test-time invalid predictions are reported separately; selection approval is a validation decision, not production authorization.

Full validation/test cohorts compare ridge, stored `distanceBaselineMinutes`, and the TRAIN target median. Quote-present cohorts compare all three plus observed quoted ETA on identical source rows. Null quotes exclude rows only from quote comparisons. Rates are fractions, error is prediction minus actual, lateness is actual minus prediction, medians average the middle pair and P90 uses nearest rank. Empty test/quote cohorts are explicit unavailable results. Nonempty TRAIN and VALIDATION are required. Metric parity uses `fixtures/metrics-parity.json` and the existing TypeScript hand-calculable semantics with `1e-12` tolerance.

Selected models produce `eta-model.json` and `eta-evaluation.report.json`. The artifact stores coefficients/intercept for standardized features, means/scales, exact contract versions and provenance. Reports contain selection candidates, guardrails, baseline comparisons, invalid prediction counts, split sizes and aggregate distance/item/time/target diagnostics, never raw rows or IDs. JSON output uses sorted keys, two-space indentation, UTF-8 and a final LF; SHA-256 of exact model bytes is stored in the report, not the model. Existing outputs are refused. A failed write may leave partial files; retry in a fresh output directory.

Run all tests with `python -B -m unittest discover -s tests -v`. Actual sklearn tests skip explicitly if unavailable. Cross-runtime validation of an actually ridge-trained artifact is deferred to 11C if the training dependency remains unavailable. Synthetic-trained/evaluated results are prototype evidence only; do not pool them with real-data metrics. No production inference or Delivery runtime changes are included.

## Phase 11E: order-placement shadow runtime

The optional runtime loads once before the HTTP server listens. `ML_ETA_ENABLED`
defaults to false: no artifact is read or required. Enable explicitly with
`ML_ETA_ENABLED=true` and `ML_ETA_MODEL_PATH` pointing to an approved local JSON
artifact. There is no default generated-model path and no per-request loading.
Load/configuration failures leave only this optional runtime unavailable.

Production requires `ML_ETA_MODEL_SHA256` (SHA-256 of the exact UTF-8 artifact
content, not the dataset checksum). Production accepts REAL provenance only;
SYNTHETIC and MIXED are rejected. Development/test may use SYNTHETIC only with
`ML_ETA_ALLOW_SYNTHETIC=true`; MIXED remains rejected. The REAL-policy test fixture
is a relabeled test artifact, **not a real-trained model or production evidence**.
Automated tests use small fixtures, never ignored 11C generated artifacts.

Inference runs after successful delivery-order creation commits, using the
returned persisted distance, item-line count (not quantity sum), and placedAt.
Pickup and failed checkout do not invoke it. The adapter uses M10's exact
whole-week fixed-offset arithmetic without duplicating cyclic feature encoding.
`ML_TIMEZONE_OFFSET_MINUTES` (default 330) must match the approved dataset export;
the artifact does not itself carry this offset. Approval must bind the export's
offset to its artifact checksum/version. `ML_MAX_PREDICTION_MINUTES` (default 240)
is reused. Invalid/nonpositive/nonfinite/over-limit outputs are unavailable,
never clamped or rounded. Shadow predictions retain continuous minutes.

This phase does not replace customer ETA, quote snapshots, tracking, routing,
prices or dispatch. The separate legacy LogisticsModel is unchanged. The optional
observer defaults to no-op; safe result fields only are passed, without IDs,
addresses, coordinates, item names, prescription information or raw features.
Observer failures are isolated. No shadow database persistence or public response
fields are added; default operation retains no evaluation observations.

Customer-facing serving remains unavailable in 11E and requires: authorized REAL
export; coverage/quality review (including successful-delivery selection); a
REAL-trained artifact; untouched REAL test evaluation; baseline and guardrail
approval; artifact checksum/version approval; timezone and feature parity
verification; rollout/rollback plan; and retained observability. REAL provenance
alone does not grant approval. A separate serving design must preserve the meaning
of accepted quote ETA and account for its tracking/routing consumers.
