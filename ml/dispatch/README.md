# Dispatch acceptance: offline dataset and prototype training

## Phase 12B: offline dispatch acceptance dataset

Schema `dispatch-acceptance-v1`, prediction point `DISPATCH_PRE_OFFER`. Each row is
one actually offered rider-assignment pair with one matching committed dispatch
snapshot. CANDIDATE/SKIPPED records are never negative labels. Phase 12C adds offline training; production inference remains deferred. Tests use synthetic in-memory records and fake readers;
no live DB, migration application, or real extraction is performed by tests.

The strict read-only loader selects attempt IDs/linkage, attemptedAt, stored
distance/workload/rank and policy/config scalars; assignment IDs/linkage, status,
assignedAt, offerExpiresAt and decision/intervention timestamps; and order status
plus cancelledAt only. No customer/profile/address/coordinates/events/items are
loaded. A first read seeds orders by linked candidates in the explicit half-open
window. A second read includes their complete linked-offer chains, including
out-of-window offers, and alternative mappings of seed assignments. Consequently
sourceCandidates counts returned linked snapshots, not the entire candidate
population. Execute future authorized exports against a stable offline snapshot:
the two reads are not a database snapshot transaction and live concurrent changes
would undermine reproducibility. No DB mutation API is exposed by the loader.

Required immutable offerExpiresAt is never reconstructed from current config.
Positive: assignedAt <= acceptedAt < deadline, with consistent acceptance status.
Later FAILED delivery retains acceptance=true. Decline: assignedAt < declinedAt
< deadline, without acceptance, with DECLINED statuses. Timeout: consistent
TIMED_OUT statuses, no acceptance/decline, and deadline plus recorded timedOutAt
both observed by outcomeCutoff. timedOutAt remains processing time, not deadline.
An unresolved OFFERED row is excluded even after expiry; it is never inferred false.

Conflicting decision timestamps are excluded. Known pre-decision cancellation or
reassignment, invalid intervention timestamps, or cancellation/reassignment status
without its timestamp are excluded as administrative_outcome_ambiguous. The schema
cannot prove absence of unrecorded administrative actions; this pipeline does not
certify that absence. Future REAL review must assess that limitation. Post-decision
interventions with reliable timestamps do not reverse a valid acceptance.

Required policy: deterministic-dispatch-v1. Both DETERMINISTIC_FALLBACK and
ML_ASSISTED selection are included, counted separately in the manifest, and never
used as features. Rank and all four config scalars must be present and sane.
The four raw features are exact persisted riderDistanceKm (including zero and
sub-0.5 values), integer nonnegative activeWorkload, and dispatch attemptedAt's
hour/day under the explicit fixed UTC offset. Sunday is zero; no cyclic encoding,
historical rider rates, current-state substitution, or raw timestamps are exported.

Primary exclusion precedence: duplicate candidate/round-rider/assignment mapping;
missing round; incomplete instrumentation; unoffered/missing/inconsistent linkage;
policy; attempted/assigned timestamps; cross-split group then outside window;
missing/invalid deadline; distance/workload; maturity; conflicting decisions;
administrative ambiguity; acceptance/decline/timeout consistency. Each source gets
exactly one primary reason. Group boundaries use all structurally eligible offers
before label/feature filtering, conservatively preventing hidden boundary crossings.
A chain spanning any split (including outside the requested window) is excluded as
a whole. Windows are half-open train/validation/test, never randomized.

After filtering, groups are ordered by earliest attemptedAt then internal orderId;
rows by attemptedAt/orderId/roundId/riderId. Export-local sequential keys such as
order-group-000001 and row-000001 replace IDs; IDs are never hashed. Exact row
allowlists prevent PII or policy/config metadata leaking into model features.

The REAL manifest includes explicit generation time and git commit, split windows,
cutoff/offset, label and feature contracts, policy requirements, source/offered/row/
class/split/group/exclusion/selection-policy counts, and SHA-256 of exact UTF-8
JSONL bytes. Rows use JSON.stringify with final LF, no BOM. Empty export is zero
bytes with a complete zero-row manifest. Synthetic fake-reader tests exercise the
REAL export contract; they are not real training data or accuracy evidence.

Developer CLI (do not run without separate authorization for the target data):

```text
npx tsx src/ml/dispatch-dataset/dispatch-dataset.cli.ts --confirm-read-only-export --output-directory <fresh-dir> --train-start <UTC-ISO> --validation-start <UTC-ISO> --test-start <UTC-ISO> --test-end <UTC-ISO> --outcome-cutoff <UTC-ISO> --timezone-offset-minutes 330 --generated-at <UTC-ISO> --git-commit <commit>
```

All arguments are explicit; no current-date fallback. Prisma is imported only after
argument validation. Output is dispatch-dataset.jsonl and
dispatch-dataset.manifest.json. Existing files are refused via exclusive writes.
The two-file write is not atomic; a failure may leave empty or partial output.
Use a fresh directory for retry; do not overwrite previous results. CLI errors
are generic and never print raw DB records/errors. Store authorized exports outside
version control. Phase 12A migration must be deployed separately before a REAL
export; this CLI does not apply it.

## Phase 12C: offline logistic prototype

The pure Python and TypeScript encoders implement `dispatch-acceptance-features-v1`.
Exact raw keys are `riderDistanceKm` (finite >= 0), `activeWorkload` (integer >= 0),
`hourOfDay` (integer 0..23), `dayOfWeek` (integer 0..6, Sunday=0).
Strings, booleans, missing keys and extra fields are rejected without coercion.
The exact encoded order is:

```text
riderDistanceKm, activeWorkload, hourSin, hourCos, isMonday, isTuesday,
isWednesday, isThursday, isFriday, isSaturday
```

Hour uses sin/cos of `2*pi*hourOfDay/24`; Sunday has six zero indicators.
`feature-contract.json` documents the contract. Both runtimes test the shared
`fixtures/feature-parity.json` with absolute tolerance 1e-12. The new TypeScript
modules have no Prisma, dispatch/service, loading or inference dependencies.

### Synthetic purpose and provenance

`synthetic.py` uses a local seeded Python PRNG, explicit row count, generator
version (`dispatch-synthetic-v1`), four UTC boundaries, timezone offset, generation
time and git commit. Each row represents one offered rider for one synthetic order.
Uniformly spaced offer instants in the half-open window determine temporal splits;
there are no cross-split groups, multiple-offer groups, unoffered negatives, real
IDs, PII, rank features or mixed REAL data.

Probability includes quadratic distance cost, workload-distance interaction,
a rush-hour step, weekday/time effects, Gaussian noise and behavioral shocks.
A Bernoulli draw determines acceptance, with a simulated timestamp inside a fixed
immutable 120-second deadline. False outcomes are explicit pre-deadline declines
or mature recorded timeouts. Only allowed features and the boolean label are
serialized, never latent probabilities or timestamps. This synthetic behavior is
**not observed MediConnect behavior**; metrics are prototype-only and do not
establish production accuracy or acceptance uplift.

The manifest declares SYNTHETIC, seed/version/full configuration, row/class/group/
split counts, selection-policy context `SYNTHETIC_OFFERED_ONLY`, and exact JSONL
SHA-256. Reproducibility assumes the same runtime and configuration. Small/empty
datasets may lack classes; labels are never repaired to force class diversity.

### Dataset validation and model selection

`model_io.py` checks duplicate JSON keys/nonfinite constants, UTF-8 JSONL/no BOM/
final LF, schema, provenance, checksum, exact row keys, features, boolean label,
prediction point, ordered UTC boundaries/timezone, manifest row/class/split/group
counts, sequential export keys, and one split per group. REAL Phase 12B manifests
use `counts.exportedRows` and do not require synthetic `rowCount`. No timestamp
exists in rows, so the trainer cannot independently reconstruct the exporter's
timestamp-to-split decisions. A checksum detects changes, not source authenticity.

Reuse `ml/eta/.venv`: NumPy 2.3.5, pandas 3.0.1, scikit-learn 1.8.0. No new
packages/environment/backend npm changes. Means and population standard deviations
are fitted on TRAIN only; zero scales become 1. Holdouts reuse that scaler and
there is no target transform. Nonfinite preprocessing is rejected.

LogisticRegression uses L2 (`l1_ratio=0`, explicit nondeprecated sklearn 1.8
configuration), `solver=lbfgs`, `max_iter=2000`, `tol=1e-8`. Each candidate in the
fixed C grid `[0.01, 0.1, 1, 10, 100]` is fitted once on TRAIN. Nonconverged and
numerically invalid candidates are rejected. The constant probability baseline
is the TRAIN acceptance fraction, never a holdout-derived value.

Selection accepts only train and validation. Predeclared guardrails require both
classes in both splits, finite probabilities in [0,1], validation log loss strictly
below baseline, and validation Brier <= baseline Brier + **0.01** (absolute).
Eligible candidates sort by log loss ascending, Brier ascending, average precision
descending, then C ascending. If none pass, `NO_MODEL_SELECTED` produces a report
and no artifact. Empty or single-class train/validation also selects no model.
The selected model remains fitted on TRAIN only; no train+validation refit occurs.
Test metrics are computed after selection is frozen. Tests check this structurally
and verify unchanged coefficients when test labels/features change.

### Evaluation and outputs

Metrics: log loss (float64 epsilon clipping only for logarithms), Brier, ROC-AUC
(null without both classes), average precision (null without positives; all-positive
AP=1), secondary accuracy at 0.5, precision/recall at 0.5 (null for zero denominators),
predicted-positive rate, actual acceptance rate, and sample count. Empty metrics
are null. Ten fixed calibration bins use [left,right), with the final bin including
1; empty bins have null means/rates. `metrics-parity.json` supplies known metrics
and extreme sigmoid fixtures.

Deterministic scores are not probabilities and receive no log loss. Reports include
policy counts and explicitly unavailable rank distribution: v1 rows omit rank and
this generator does not simulate candidate ranking. No counterfactual uplift is
inferred from offered-only observations. Aggregate diagnostics cover distance/
workload min/max, hour/weekday coverage, prevalence, and holdouts outside TRAIN ranges.

Selected `dispatch-model.json` uses `dispatch-model-artifact-v1`, model type
`logistic_regression`, standardized coefficients/intercept, TRAIN means/scales,
exact feature order, positive class `accepted_before_expiry`, model version,
provenance/checksum/git/time, split row counts, and validation/test log loss/Brier.
Python and TypeScript validators reject incompatible/extra shapes, wrong dimensions,
nonfinite parameters, nonpositive scales, invalid metadata and evaluation metrics.
UTC ISO times accept seconds or milliseconds ending in Z. JSON is data only;
there is no pickle/joblib/executable serialization.

`dispatch-evaluation.report.json` includes status/reason, versions/provenance,
checksum/git/time, row/class counts, hyperparameters, candidate validation results,
logistic/constant holdout metrics, calibration/generalization and model SHA-256
(null without selection). No raw rows or IDs appear in artifacts/reports.

`prediction-parity.json` provides arbitrary **untrained contract parameters** and
Python probabilities for future Phase 12D. This is not a deployable model.
Future Node inference must use stable sigmoid:

```text
if z >= 0: 1 / (1 + exp(-z))
else:      exp(z) / (1 + exp(z))
```

Extreme finite logits are tested; nonfinite logits are rejected. There is no Node
inference, production integration, ranking or dispatch behavior change in 12C.

### Synthetic-only commands

From `ml/dispatch` in PowerShell, use fresh output directories and replace the
explicit example commit with the intended source revision:

```powershell
../eta/.venv/Scripts/python.exe synthetic.py --seed 31 --row-count 6000 --train-start 2026-01-01T00:00:00Z --validation-start 2026-03-01T00:00:00Z --test-start 2026-04-01T00:00:00Z --test-end 2026-05-01T00:00:00Z --timezone-offset-minutes 330 --generator-version dispatch-synthetic-v1 --generated-at 2026-05-02T00:00:00Z --git-commit example-source-revision --output-directory .generated/example-data
../eta/.venv/Scripts/python.exe train.py --dataset .generated/example-data/dispatch-dataset.jsonl --manifest .generated/example-data/dispatch-dataset.manifest.json --model-version synthetic-prototype-v1 --git-commit example-source-revision --trained-at 2026-05-02T00:00:00Z --output-directory .generated/example-model
../eta/.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Exclusive writes refuse existing output files. Multi-file writes are not atomic;
retry failures in a fresh directory. The local `.gitignore` excludes `.generated/`
and Python caches. Keep other output locations outside version control. Shared
fixtures are source contract tests, not training outputs. REAL data requires the
Phase 12A migration deployed separately and explicit authorization for a stable
offline export. Python accesses files only; it never runs a DB export or migration.

## Phase 12D: isolated portable Node inference

`DispatchAcceptanceModel` validates and owns a copy of the portable JSON artifact.
It reuses the unchanged feature encoder, applies `(encoded - means) / scales`,
and computes `intercept + sum(coefficients * standardized)`. Stable sigmoid is
`1/(1+exp(-z))` for z >= 0 and `exp(z)/(1+exp(z))` otherwise. Nonfinite
intermediate arithmetic is unavailable, never silently clipped.

Output is an unrounded continuous `acceptanceProbability` in [0,1], with exact
model version and provenance. Higher means greater predicted acceptance before
expiry. There is no threshold, rider selection, assignment mutation or fallback
inside the predictor. Invalid features/artifacts/predictions return typed reasons.

The loader requires an explicit filesystem path and accepts an injected UTF-8
reader. It reads once, checks a default 65,536-byte limit before parsing, optionally
checks SHA-256 of the exact parsed string (case-insensitive expected hex), and
validates JSON data only. Errors return small typed reasons without raw exceptions.
There is no URL fetch, environment lookup, discovery or database dependency.

`backend/test/fixtures/dispatch-model-artifact.synthetic.test.json` is a small
hand-authored SYNTHETIC TEST-ONLY source fixture, not a trained/deployable artifact.
Shared prediction cases include extreme logits near +/-1000. Python manual
inference uses no sklearn; both runtimes test absolute tolerance 1e-12. Legacy
raw/probability aliases remain for Phase 12C fixture consumers. Tests never depend
on ignored generated output. Source fixtures remain uncommitted until separately
authorized; production runtime, orchestration and dispatch integration await 12E.

## Phase 12E: disabled-by-default dispatch shadow integration

Acceptance ML is observational only. Existing hard eligibility, deterministic
ranking/shortlist, optional legacy completion-minute model, authoritative winner,
assignment writes and HTTP response remain unchanged. `LogisticsModel` remains a
separate dependency; shadow probability is never used as a completion-minute score,
selection policy, suitability score or route compatibility score.

Dispatch-specific configuration is parsed by `dispatch-runtime.config.ts`:

| Setting | Behavior |
| --- | --- |
| `ML_DISPATCH_SHADOW_ENABLED` | Disabled unless exactly `true` |
| `ML_DISPATCH_MODEL_PATH` | Explicit filesystem path; required only when enabled |
| `ML_DISPATCH_MODEL_SHA256` | Required in production; verified whenever supplied |
| `ML_DISPATCH_ALLOW_SYNTHETIC` | Defaults to false; override works only in development/test |
| `ML_DISPATCH_TIMEZONE_OFFSET_MINUTES` | Explicit integer -840..840 required when enabled; no ETA timezone fallback |

Disabled startup performs no artifact read and requires no path/checksum/offset.
Enabled invalid configuration or artifact load returns an unavailable runtime;
startup and dispatch remain functional. Production allows REAL only, rejecting
SYNTHETIC even with override. Development/test permits SYNTHETIC only with explicit
override; MIXED is always rejected. Production checksum pinning does not certify
training quality or authenticate provenance beyond the supplied artifact metadata.

The server constructs the runtime once at startup and injects it separately from
legacy ML through the app's dispatch options. No mutable singleton or transaction/
request-time file loading is used. There is no new environment setting enabled by
this change; opt-in configuration must be supplied separately.

Shadow scoring receives only the deterministic shortlist's exact distance/workload
snapshots, the same attemptedAt instant persisted by DispatchAttempt, and
transaction-local `candidate-N` keys. The runtime assembles hour/day using its own
explicit fixed offset, then calls the unchanged feature encoder through the
predictor. Input order supplies authoritative deterministic ranks. Scored candidates
rank by descending probability, then deterministic rank, then stable key. Invalid
candidates retain null probability/rank; valid candidates still receive ranks.
If none score, observation is unavailable/no_scored_candidates. Model-wide exceptions
become unavailable/prediction_failed and cannot alter authoritative dispatch.

Scoring is pure inside each serializable transaction attempt. Only after successful
commit does `onDispatchShadowResult` receive one observation. Rolled-back/retried
attempts emit none; the final committed attempt emits once. Observer synchronous
throws and asynchronous rejections are swallowed after commit and never cause a
retry. No observer defaults to no-op. This is an in-process callback, not a durable
outbox: process failure after commit may lose an observation. Existing live-assignment
returns and no-eligible-shortlist paths neither score nor emit an observation.

Observer output contains only status, safe reason, counts, model version/provenance,
actual selection policy, selected deterministic/shadow ranks and top-rank agreement.
No candidate keys, rider/order/customer/pharmacy IDs, coordinates, addresses, raw
features or individual probabilities are emitted. Public dispatch responses expose
no shadow fields. Persisted selectionPolicy and legacyModelVersion continue to
describe actual authoritative selection, never the acceptance model.

No Prisma schema changes, migration execution, dataset/feature/label/training
contract changes, durable shadow records or real-data operations are introduced.
The REAL-policy test fixture is hand-authored TEST-ONLY data with a REAL provenance
marker solely for policy tests; it claims no real training or model quality.

Phase 12F remains deferred. Durable acceptance-outcome evaluation requires a
separate instrumentation design and explicit approval; the real-data gate remains
in force. This phase authorizes neither real export nor ML reranking.
