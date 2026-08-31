# MediConnect backend

## Authentication integration

No shared authentication implementation exists in this repository. `src/auth/authenticator.ts` is an isolated boundary, not a permanent authentication system. Production rider routes return `AUTH_NOT_CONFIGURED` until the auth owner supplies JWT middleware that verifies the bearer token and assigns `{ userId, role }` to `req.auth`. The rider router independently enforces authentication and the `DELIVERY_PARTNER` role after that boundary.

Use `npm run prisma:generate`, `npm run build`, and `npm test` for validation.

## Rider location configuration

- `RIDER_LOCATION_SAMPLE_INTERVAL_SECONDS` controls the minimum interval between persisted `LocationUpdate` history samples. It defaults to `15` seconds. Every accepted request still updates the rider's current coordinates and `lastLocationAt`.
- `RIDER_LOCATION_FRESHNESS_SECONDS` controls how long the reusable freshness helper classifies a last-known location as `FRESH`. It defaults to `60` seconds; older locations are `STALE`, while a missing or invalid timestamp is `UNAVAILABLE`.

Both values must be finite, non-negative numbers. Location timestamps always come from the backend clock. No `.env.example` exists in this repository, so these variables are documented here only; the real `.env` is not modified.

## Delivery quote configuration

Milestone 3 uses a deterministic development policy: `base fee + distance fee + zero demand adjustment`. These defaults are conservative prototype assumptions, not finalized production pricing:

- `DELIVERY_BASE_FEE_RUPEES` defaults to `40.00`.
- `DELIVERY_FEE_PER_KM_RUPEES` defaults to `8.00` per straight-line kilometre.
- `DELIVERY_QUOTE_EXPIRY_MINUTES` defaults to `15`.

Rupee configuration accepts non-negative values with at most two decimal places; quote expiry must be positive. Invalid values prevent application creation/startup. Pricing is calculated in integer paise and persisted as fixed two-decimal strings compatible with Prisma Decimal columns. Demand adjustment is `0.00` and multiplier is `1.00` in this milestone.

Distance currently uses the Haversine fallback between the eligible pharmacy and customer-owned address coordinates. This is a straight-line estimate, not road distance, and provides no ETA. The injected distance-provider interface allows a later routing provider without changing `POST /api/v1/delivery-quotes`. No `.env.example` exists, so configuration is documented here without modifying the real `.env`.

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
