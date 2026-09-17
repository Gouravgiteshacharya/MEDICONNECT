# MediConnect backend

## Authentication integration

No shared authentication implementation exists in this repository. `src/auth/authenticator.ts` is an isolated boundary, not a permanent authentication system. Production rider routes return `AUTH_NOT_CONFIGURED` until the auth owner supplies JWT middleware that verifies the bearer token and assigns `{ userId, role }` to `req.auth`. The rider router independently enforces authentication and the `DELIVERY_PARTNER` role after that boundary.

Use `npm run prisma:generate`, `npm run build`, and `npm test` for validation.

## Rider location configuration

- `RIDER_LOCATION_SAMPLE_INTERVAL_SECONDS` controls the minimum interval between persisted `LocationUpdate` history samples. It defaults to `15` seconds. Every accepted request still updates the rider's current coordinates and `lastLocationAt`.
- `RIDER_LOCATION_FRESHNESS_SECONDS` controls how long the reusable freshness helper classifies a last-known location as `FRESH`. It defaults to `60` seconds; older locations are `STALE`, while a missing or invalid timestamp is `UNAVAILABLE`.

Both values must be finite, non-negative numbers. Location timestamps always come from the backend clock. No `.env.example` exists in this repository, so these variables are documented here only; the real `.env` is not modified.

## Delivery quote configuration

Delivery quotes use the transparent formula `base fee + distance fee + demand adjustment`. These defaults are conservative prototype assumptions, not finalized production pricing:

- `DELIVERY_BASE_FEE_RUPEES` defaults to `40.00`.
- `DELIVERY_FEE_PER_KM_RUPEES` defaults to `8.00` per straight-line kilometre.
- `DELIVERY_QUOTE_EXPIRY_MINUTES` defaults to `15`.

Rupee configuration accepts non-negative values with at most two decimal places; quote expiry must be positive. Invalid values prevent application creation/startup. Pricing is calculated in integer paise and persisted as fixed two-decimal strings compatible with Prisma Decimal columns.

Distance currently uses the Haversine fallback between the eligible pharmacy and customer-owned address coordinates. This is a straight-line estimate, not road distance. When the provider supplies no duration, the quoted ETA uses the configured deterministic fallback speed. The injected distance-provider interface allows a later routing provider without changing `POST /api/v1/delivery-quotes`. No `.env.example` exists, so configuration is documented here without modifying the real `.env`.

## Dynamic delivery pricing

Dynamic pricing uses the brief's explainable `active delivery orders / fresh available riders` signal. The default tiers are standard at a ratio up to `1`, moderate up to `2` (`1.10x`), high up to `3` (`1.20x`), and peak above `3` or when demand exists with no available rider (`1.30x`). The multiplier is capped at `2.00x`; the quote response exposes both counts, the ratio, tier, adjustment, and multiplier before order confirmation. The accepted quote persists its exact monetary components in the existing `DeliveryQuote` fields.

`DELIVERY_DEMAND_PRICING_ENABLED` defaults to `true`. Ratio boundaries use `DELIVERY_DEMAND_MODERATE_RATIO`, `DELIVERY_DEMAND_HIGH_RATIO`, and `DELIVERY_DEMAND_PEAK_RATIO`. Multipliers use `DELIVERY_DEMAND_MODERATE_MULTIPLIER`, `DELIVERY_DEMAND_HIGH_MULTIPLIER`, and `DELIVERY_DEMAND_PEAK_MULTIPLIER`. Invalid, decreasing, or unbounded configuration prevents startup. Setting the enabled flag to `false` restores the `1.00x` behavior.

## Delivery assignment offers

`DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS` controls how long a manual assignment offer remains actionable and defaults to `30` seconds. The exact expiry boundary is expired. Until a durable worker exists, stale offers are lazily marked `TIMED_OUT` when a rider lists, accepts, or declines offers. Offer creation is an admin-only temporary entry point; automated candidate selection belongs to the dispatch milestone.

## Deterministic dispatch

`POST /api/v1/dispatch/orders/:orderId` is the admin/internal dispatch trigger. It filters active, available riders by fresh location, excludes previously attempted riders, applies a Haversine service radius, and ranks by `distanceKm + activeWorkload * workloadPenaltyKm`. Defaults are `DISPATCH_MAX_CANDIDATES=10`, `DISPATCH_MAX_RADIUS_KM=15`, and `DISPATCH_WORKLOAD_PENALTY_KM=2`. These are development policy values, not ML predictions.

## Pickup and delivery lifecycle

Rider-owned lifecycle actions are exposed under `/api/v1/delivery-lifecycle/:assignmentId`: `arrive-pharmacy`, `pickup`, `start-delivery`, `deliver`, and `fail`. Transitions use conditional writes and serializable transactions. Failed deliveries retain the order's current status and create a `FAILED_DELIVERY` event marked for manual review because the current order enum has no failed-delivery state.

## Customer tracking

`GET /api/v1/orders/:orderId/tracking` returns a polling-ready projection only to the order-owning customer. Fresh active deliveries expose the rider's current coordinates and Haversine distance remaining. Stale locations expose freshness and last-update time but not coordinates. Delivered, cancelled, and rejected orders suppress precise location, rider phone, and last-location time. Timeline output excludes internal notes and metadata.

## Rider dashboard

`GET /api/v1/riders/me/dashboard` aggregates the authenticated rider's profile, availability, location freshness, actionable offers, active work, next permitted lifecycle action, workload counts, and recent history. Its projections contain only operational pharmacy and destination snapshots needed by the assigned rider.

## Conservative two-order batching

`POST /api/v1/delivery-batches/evaluate` is the admin/internal batching trigger. It combines one ready candidate order with one active assignment for a busy rider only when rider location is fresh, neither order conflicts with another live assignment, both pharmacy and drop-off separation stay within configured limits, and estimated detour remains acceptable. Defaults are two assignments maximum, 3 km separation for each pair, a 15-minute detour cap, and a documented 20 km/h fallback speed. It persists an initial valid pickup-before-drop-off stop sequence that Milestone 10 can optimize.

## Multi-stop route optimization

`POST /api/v1/delivery-batches/:batchId/optimize` is the admin/internal optimization trigger. It exhaustively evaluates the manageable stop permutations in a current batch, preserves pickup-before-drop-off ordering, keeps an in-progress stop first, rejects routes outside quoted ETA plus configured slack, and persists positive unique stop sequences with estimated arrival times. `GET /api/v1/delivery-batches/:batchId/route/me` returns the saved route only to its owning rider; the rider dashboard also exposes the active sequence.

The injected route-provider boundary is called before any write transaction. The default provider uses Haversine distance and `ROUTE_ASSUMED_SPEED_KMH=20`; it is a deterministic fallback, not road routing or traffic-aware navigation. `ROUTE_MAX_LATE_MINUTES` defaults to `5`, and `ROUTE_MAX_STOPS` defaults to `6` with a hard safety limit of eight. A production mapping provider can replace the fallback without changing route contracts. No schema migration is required because `DeliveryStop.sequence` and `estimatedArrivalAt` already exist.

## ETA dataset pipeline

The developer-run ETA pipeline is offline and read-only; it does not replace operational ETA behavior. Schema `eta-checkout-v1` predicts at `CHECKOUT`. Its label is `(successful assignment deliveredAt - order placedAt) / 60000`, retaining fractional minutes and requiring exact agreement with order `completedAt`.

The loader reads stored `Order.deliveryDistanceKm`, `Order.quotedEtaMinutes`, item-line count and minimal eligibility fields. Rows exclude raw IDs, exact timestamps, coordinates, customer/rider/pharmacy details, prescription data and amounts. The distance baseline is `Math.ceil(distanceKm / fallbackSpeedKmh * 60)`. Stored quoted ETA has unknown provider/fallback/model provenance and is not reconstructed.

Run from `backend` using the existing local `tsx` dependency, only after authorization to read the chosen data source. Use a read-only database account or frozen snapshot where possible. The CLI uses the shared Prisma environment configuration (`DIRECT_URL` and existing required application settings). This implementation was validated with synthetic data only.

```powershell
npx --no-install tsx src/ml/dataset/eta-dataset.cli.ts --confirm-read-only-export --output-directory ./eta-output --placed-at-from 2026-01-01T00:00:00Z --validation-start 2026-02-01T00:00:00Z --test-start 2026-03-01T00:00:00Z --test-end 2026-04-01T00:00:00Z --outcome-cutoff 2026-04-02T00:00:00Z --fallback-speed-kmh 20 --timezone-offset-minutes 330 --git-commit YOUR_COMMIT
```

Replace the example dates and commit explicitly. Placement windows are `[placed-at-from, validation-start)`, `[validation-start, test-start)` and `[test-start, test-end)`. Outcomes after the explicit cutoff are excluded. This cutoff is snapshot-level; it does not additionally impose per-split label-maturity rules. A mutable database plus fixed dates does not guarantee a repeatable source snapshot.

Output is UTF-8 `eta-dataset.jsonl` plus `eta-dataset.manifest.json`. The manifest records injected generation time, commit, boundaries, speed, timezone, exclusion counts and SHA-256 of the exact JSONL bytes. Empty datasets still produce a manifest. Existing files are always rejected; two-file writing is not atomic, so a failed run may leave partial files. Retry into a fresh directory. The command prints only aggregate counts and output paths. No package script, live routing call or database write is involved.

## ML-assisted logistics

Milestone 12 adds an injectable prediction boundary to ETA estimation and eligible-rider ranking. Delivery owns the feature contract, orchestration, output guardrails, and deterministic fallback; Intelligence & Experience owns model training, implementation, evaluation, and inference. No trained model or training code is bundled in Delivery. Until an Intelligence-owned predictor is injected, deterministic eligibility and ranking remain authoritative. Invalid predictions, disabled inference, or model exceptions immediately use deterministic dispatch ranking and the routing-provider ETA. Dispatch responses report `ML_ASSISTED` or `DETERMINISTIC_FALLBACK`; audited dispatch attempts store accepted predicted completion time as suitability and retain the deterministic score as route compatibility. Quote responses report the ETA source, model version, baseline, and prediction.

`ML_LOGISTICS_ENABLED` defaults to `true`. `ML_MAX_PREDICTION_MINUTES` defaults to `240` and rejects implausible output. `ML_FALLBACK_SPEED_KMH` defaults to `20` and supplies an explainable baseline when the Haversine distance provider has no duration. `ML_TIMEZONE_OFFSET_MINUTES` defaults to `330` (India Standard Time) for the peak-hour feature. The local inference boundary is synchronous and performs no network I/O.

## Milestone 12A: durable dispatch instrumentation

Apply the additive `20260913000000_dispatch_instrumentation` migration before
running this application version. It was generated from local schema files;
no database migration is automatically applied at startup. Existing rows remain
null; no historical expiry or policy is backfilled.

Each committed automatic dispatch shortlist shares a server UUID. One-based
`deterministicRank` is captured before optional legacy ML reranking; existing
`routeCompatibilityScore` retains the deterministic score. Typed attempt columns
snapshot the policy version, configured shortlist cap (not actual count), radius,
workload penalty and freshness threshold. Milliseconds use Float to preserve the
existing configuration's numeric range and fractional precision. Actual shortlist
size is the round row count. Unique round/rider and round/rank indexes prevent
ambiguous snapshots while allowing legacy null-round rows. Shared configuration
is repeated on the existing bounded shortlist to avoid a new round table.

`selectionPolicy` uses existing `DETERMINISTIC_FALLBACK`/`ML_ASSISTED` terminology.
`legacyModelVersion` records the existing round response's selected model version,
or null on deterministic fallback. This is provenance, not a new model. Ranking,
eligibility, winner selection and retry limits are unchanged. Candidate writes
and offer linkage commit together; failed attempts leave no round history.

All new dispatch, manual and batch offers store `offerExpiresAt` once as assignedAt
plus the configured timeout. Accept/decline/list and dashboard use this deadline;
legacy null values retain the existing configuration-based fallback. Acceptance
is allowed only strictly before the deadline; at/after it the offer expires.
`timedOutAt` remains processing time. Internal fields are not added to responses;
the existing public `expiresAt` reflects the immutable deadline.

No labels, datasets or shadow-model columns are added. Future extraction must
join an actually offered assignment to its matching dispatch snapshot, exclude
unoffered candidates from negative labels, and exclude ambiguous pre-decision
administrative/cancellation cases. Schema status fields alone do not establish a
reliable cancellation history. Legacy null-deadline rows are not automatically
label-ready. Internal relational IDs stay in the operational DB; future exports
must remove them. No new names, contact details, coordinates or prescription data
are recorded by this instrumentation.

## Phase 12B: offline dispatch acceptance dataset

`dispatch-acceptance-v1` exports one actually offered rider-assignment pair per
row, using a matching dispatch snapshot. It is offline/read-only and requires an
immutable `offerExpiresAt`; legacy null deadlines are excluded. Unoffered candidates
are never negatives. Consistent pre-deadline acceptance is positive (including
later failed deliveries); explicit pre-deadline decline and mature recorded timeout
are negative. Unresolved, contradictory, or administratively ambiguous cases are
excluded. `timedOutAt` is processing time, never the deadline.

The loader expands linked offer chains beyond the requested window so whole-order
half-open temporal splits cannot silently cross boundaries. Dataset-local sequential
keys replace internal IDs. No identities, exact timestamps, coordinates, contact,
address, item or prescription data are exported. Both recorded selection policies
are counted in the manifest, not used as features. Tests use synthetic records and
fake read-only dependencies; no live DB, migration application or model training.

The developer CLI requires explicit windows, cutoff, offset, generation timestamp,
commit, output directory and `--confirm-read-only-export`. Exclusive writes refuse
existing files; failures may leave partial output, so retry in a fresh directory.
See [dispatch dataset documentation](../ml/dispatch/README.md) for the exact CLI,
projection, label/exclusion precedence, manifest and remaining audit limitations.

## Phase 13A: operational risk persistence

The operational-risk module provides strict evidence contracts, durable
occurrence idempotency and revision-checked lifecycle persistence. Legacy
`RiskAssessment` remains unchanged. Phase 13B adds pure rules; Phase 13C wires
failure-isolated post-commit hooks and tracking observations. Apply the 13A risk
migration before deploying the server; startup never auto-migrates. Phase 13D adds
ADMIN-only queue/detail and lifecycle APIs with safe evidence projections. Phase
13E adds explicitly invoked, bounded reconciliation for missed detections and
stale-assessment recovery. No scheduler, support tickets or ML are enabled. See
[operational risk documentation](docs/operational-risk.md).

## Phase 14A.3: prospective delivery observation assurance

Apply `20260916000000_observation_assurance` before deploying the changed writers.
This additive migration does not activate an epoch or backfill any record. It was
not applied during implementation. Existing HTTP response shapes remain unchanged.

Activation is a separate deployment operation, not startup/config inference:

1. Verify the migration and concurrency/permission behavior in an isolated
   PostgreSQL deployment before production activation. Unit tests use injected
   stores; they do not execute PostgreSQL locks or triggers.
2. Drain old writer transactions and deploy all participating writers. Use a
   restricted runtime role, separate from the migration/function owner. It must
   not own business tables, inherit the owner, be superuser/BYPASSRLS, have CREATE
   on public, TRUNCATE on business tables, or DML/TRUNCATE on assurance tables.
   Remove any default grants that violate these restrictions. Restrict access to
   SECURITY DEFINER function ownership and disallow untrusted schema creation.
3. Verify trusted database UTC clock, retention, privileged repair auditing and
   every writer role/build; retain an external deployment attestation with a UUID.
   The activation function validates basic permissions for the explicitly named
   runtime role; the attestation must cover any additional writer roles.
4. From the controlled deployment role, explicitly invoke
   `observation_activate(attestation_uuid, runtime_role_name)` in a transaction.
   Both arguments are required. Database time sampled at this explicit operation
   becomes activatedAt. Reusing the attestation returns the same epoch, including
   an already closed epoch; a new rollout requires a new attestation. Migration,
   Git and process-start timestamps never activate anything.

Completion is explicit, one assignment per transaction: call the internal
`completeObservation(tx, assignmentId)` adapter within a SERIALIZABLE transaction,
or the deployment/internal SQL function `observation_complete(assignment_uuid,
'delivery-observation-v1')`. Retry an aborted serialization transaction as a whole.
There is no scheduler or new HTTP endpoint. Result is UNSUPPORTED, INVALIDATED,
PENDING or COMPLETE, never an ML label. Each call locks the episode and derives
its stored horizon; caller time cannot certify it. A backlog stays uncertified.

If writer guarantees, clock trust or retention fail, explicitly call
`observation_invalidate(epoch_uuid, reason_code, attestation_uuid)` from the
controlled deployment role. Reasons: CLOCK_UNTRUSTED, WRITER_GUARANTEE_LOST,
RETENTION_LOST, OPERATIONAL_REPAIR. This conservatively invalidates the ENTIRE epoch
and closes enrollment; no business events are changed/deleted. Invalidation uses
the exclusive capability gate, while writers/completion hold the shared gate.
Recorded time is audit time, not an inferred start of a historical fault. Consumers
must always consult invalidations, including for previously completed records.
A clock fault aborts the attempted transaction; invalidate in a separate explicit
transaction before continuing uncertified operations. No automatic time clamping.

Do not grant activation/invalidation execution to runtime/public roles. PUBLIC
execution is revoked for those functions. Keep the function owner trusted and
non-login where operationally possible. Owners/superusers remain privileged and
must follow the audit/invalidation procedure; no schema can constrain an unaudited
superuser. Covered event history remains immutable, including after invalidation;
any privileged retention/repair procedure requires separate operational review.

The only covered terminal writers are failDelivery and DELIVER. There is no
supported post-accept cancellation/reassignment service. Such mutations cannot
silently remain assured: database guards reject them until explicit invalidation.
Do not introduce a censoring product workflow via these functions. See the Phase
14A.3 section of [the assurance record](docs/operational-risk-ml-feasibility.md)
for timestamp scope, legacy behavior, test limits and outstanding production gates.
