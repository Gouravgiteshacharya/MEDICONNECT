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
