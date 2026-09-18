# MediConnect backend

## Authentication integration

No shared authentication implementation exists in this repository. `src/auth/authenticator.ts` is an isolated boundary, not a permanent authentication system. Production rider routes return `AUTH_NOT_CONFIGURED` until the auth owner supplies JWT middleware that verifies the bearer token and assigns `{ userId, role }` to `req.auth`. The rider router independently enforces authentication and the `DELIVERY_PARTNER` role after that boundary.

Use `npm run prisma:generate`, `npm run build`, and `npm test` for validation.

## Staging privileged test accounts

Privileged role accounts are not available through public registration. The public
`POST /api/v1/auth/register` flow remains customer-only.

For staging/dev QA only, a guarded provisioning script can create or reconcile
one account for each privileged role: `ADMIN`, `PHARMACY_STAFF`, and
`DELIVERY_PARTNER`. The script refuses to run unless all safety requirements are
met:

- `ALLOW_STAGING_PROVISION=true`
- `NODE_ENV` must not be `production`
- required account credentials must be supplied through environment variables

Required variables:

```text
STAGING_ADMIN_EMAIL
STAGING_ADMIN_PASSWORD
STAGING_PHARMACY_EMAIL
STAGING_PHARMACY_PASSWORD
STAGING_RIDER_EMAIL
STAGING_RIDER_PASSWORD
STAGING_PHARMACY_ID
STAGING_RIDER_VEHICLE_TYPE
```

Optional display-name variables:

```text
STAGING_ADMIN_NAME
STAGING_PHARMACY_NAME
STAGING_RIDER_NAME
```

`STAGING_PHARMACY_ID` must point to an existing active pharmacy. Pharmacy staff
membership is provisioned with `PharmacyStaffRole.OWNER`. Rider profiles are
created with `availability=OFFLINE`; `STAGING_RIDER_VEHICLE_TYPE` must be a real
schema `VehicleType` value such as `BIKE`, `SCOOTER`, `CAR`, `BICYCLE`, or
`WALKER`.

Run only against a confirmed staging/dev database:

```bash
npm run provision:staging-accounts
```

Do not commit real credentials, database URLs, or generated secrets.

## Rider location configuration

- `RIDER_LOCATION_SAMPLE_INTERVAL_SECONDS` controls the minimum interval between persisted `LocationUpdate` history samples. It defaults to `15` seconds. Every accepted request still updates the rider's current coordinates and `lastLocationAt`.
- `RIDER_LOCATION_FRESHNESS_SECONDS` controls how long the reusable freshness helper classifies a last-known location as `FRESH`. It defaults to `60` seconds; older locations are `STALE`, while a missing or invalid timestamp is `UNAVAILABLE`.

Both values must be finite, non-negative numbers. Location timestamps always come from the backend clock. No `.env.example` exists in this repository, so these variables are documented here only; the real `.env` is not modified.

## Delivery quote configuration

Delivery quotes use the transparent formula `base fee + distance fee + demand adjustment`. These defaults are conservative prototype assumptions, not finalized production pricing:

- `DELIVERY_BASE_FEE_RUPEES` defaults to `40.00`.
- `DELIVERY_FEE_PER_KM_RUPEES` defaults to `8.00` per routed kilometre when Google Routes is available, or per straight-line kilometre during fallback.
- `DELIVERY_QUOTE_EXPIRY_MINUTES` defaults to `15`.

Rupee configuration accepts non-negative values with at most two decimal places; quote expiry must be positive. Invalid values prevent application creation/startup. Pricing is calculated in integer paise and persisted as fixed two-decimal strings compatible with Prisma Decimal columns.

When Google Routes is enabled and configured, delivery quotes use its traffic-aware road distance and duration. The quote service continues to own eligibility, pricing, persistence, expiry, and ETA orchestration. When Google is disabled, lacks a key, times out, is rate-limited, returns an error, or returns malformed route data, the provider composition falls back to Haversine distance. If the fallback has no duration, the quoted ETA uses the configured deterministic fallback speed. No `.env.example` exists, so configuration is documented here without modifying the real `.env`.

## Google Routes integration

Google Maps Platform Routes API access is isolated behind the existing `DistanceProvider` and `RouteProvider` interfaces. The server calls `computeRoutes` with `DRIVE`, `TRAFFIC_AWARE`, and the minimal `routes.distanceMeters,routes.duration` field mask. The response is converted to kilometres and conservatively rounded-up minutes inside the provider layer; raw Google responses and errors do not cross that boundary.

- `GOOGLE_ROUTES_ENABLED` defaults to `false` and must be exactly `true` or `false`.
- `GOOGLE_MAPS_API_KEY` is required to select Google providers when routing is enabled. A missing or blank key keeps the application on deterministic Haversine providers.
- `GOOGLE_ROUTES_TIMEOUT_MS` defaults to `5000` and accepts an integer from `1` through `60000`.

The API key is server-only: never use it in frontend environment variables, API responses, logs, or committed fixtures. Local development and automated tests do not require Google access. Tests inject a mocked HTTP boundary and never call the live API.

For delivery quotes, Google route duration becomes the deterministic ETA baseline. A valid Intelligence-owned ML prediction may still assist that baseline; disabled, unavailable, invalid, or failing ML returns to Google duration, and a Google failure returns to Haversine plus assumed-speed ETA. No route geometry or polyline is requested, exposed, or persisted in this phase.

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

The injected route-provider boundary is called before any write transaction. When enabled and configured, Google supplies road distance and traffic-aware duration for each directed leg while the MediConnect optimizer remains authoritative over stop ordering and pickup-before-drop-off constraints. Repeated legs are cached only for the lifetime of one optimization request to limit provider calls. Haversine distance with `ROUTE_ASSUMED_SPEED_KMH=20` remains the deterministic fallback. `ROUTE_MAX_LATE_MINUTES` defaults to `5`, and `ROUTE_MAX_STOPS` defaults to `6` with a hard safety limit of eight. No schema migration is required because `DeliveryStop.sequence` and `estimatedArrivalAt` already exist.

## ML-assisted logistics

Milestone 12 adds an injectable prediction boundary to ETA estimation and eligible-rider ranking. Delivery owns the feature contract, orchestration, output guardrails, and deterministic fallback; Intelligence & Experience owns model training, implementation, evaluation, and inference. No trained model or training code is bundled in Delivery. Until an Intelligence-owned predictor is injected, deterministic eligibility and ranking remain authoritative. Invalid predictions, disabled inference, or model exceptions immediately use deterministic dispatch ranking and the routing-provider ETA. Dispatch responses report `ML_ASSISTED` or `DETERMINISTIC_FALLBACK`; audited dispatch attempts store accepted predicted completion time as suitability and retain the deterministic score as route compatibility. Quote responses report the ETA source, model version, baseline, and prediction.

`ML_LOGISTICS_ENABLED` defaults to `true`. `ML_MAX_PREDICTION_MINUTES` defaults to `240` and rejects implausible output. `ML_FALLBACK_SPEED_KMH` defaults to `20` and supplies an explainable baseline when the Haversine distance provider has no duration. `ML_TIMEZONE_OFFSET_MINUTES` defaults to `330` (India Standard Time) for the peak-hour feature. The local inference boundary is synchronous and performs no network I/O.

### Browser origins (CORS)

Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact browser origins,
for example `https://app.example.com,https://admin.example.com` (no trailing
slash or path). Whitespace and empty entries are ignored. Wildcards are not
supported. Restart the backend after changing configuration.

In production, only configured origins receive CORS permission. A missing or
empty list grants no browser origins permission and does not prevent startup.
Requests without an Origin header continue normally. Credentials remain disabled.

Outside production, HTTP/HTTPS origins on `localhost` or `127.0.0.1` (including
local development ports such as 5173) are also allowed. Other external origins
must be explicitly configured. CORS controls browser response access; it does
not replace endpoint authentication or authorization.
