# Milestone 15: Operations UI architecture and integration audit

Audit dates: 2026-09-17–2026-09-18. Phase 15A is source inspection only. Recommendations below are not implemented or authorization to implement later phases.

## Decision and preflight

The smallest useful workspace is ADMIN authentication plus the existing deterministic Risk Queue, detail and lifecycle actions. It needs frontend infrastructure, but no new backend capability. Do not include placeholder Overview, Support, Orders, Deliveries or Pharmacies pages.

Verified repository MEDICONNECT, branch `feature/intelligence-experience`, HEAD `899f2d8 feat: add operational observation assurance`. Initial working tree was clean; branch was intentionally one commit ahead of origin. Previous commits: `5abd178`, `ae20a1e`, `180a2a8`, `58976c7`. No branch or remote operation was performed.

Milestone 14 remains parked: local-only commit, migration `20260916000000_observation_assurance` unapplied per the task, PostgreSQL-specific validation outstanding, 14B unauthorized. No database was accessed to independently verify deployment or migration state. The proposed UI consumes auth and M13 risk contracts only, with no assurance tables, capability activation, prediction or migration dependency.

Deployment distinction: current HEAD includes observation-assurance integration in assignment acceptance and delivery completion/failure writers (`backend/src/delivery-assignments/assignment.service.ts`, `backend/src/delivery-lifecycle/lifecycle.service.ts`, `backend/src/observation-assurance/observation.store.ts`). This audit does not approve deploying the entire HEAD backend against an unmigrated database. A future UI must target a verified compatible M13 backend; availability of such an environment and ADMIN credentials was not tested. Do not apply M14 migrations just to enable the UI.

## Frontend architecture

Sources: `frontend/package.json`, `frontend/vite.config.js`, `frontend/src/main.jsx`, `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/index.css`, and the complete `frontend/src/modules/support` and `frontend/src/modules/assistant` view/client/style structure.

| Concern | Existing implementation and reuse decision |
| --- | --- |
| Framework/build | React/react-dom ^19.2.8, Vite ^8.2.0, React plugin ^6.0.4, JavaScript/JSX, oxlint ^1.75.0. Scripts dev/build/lint/preview; no frontend test script. No router, query, form, UI or icon library dependency. |
| Entry/shell | `main.jsx` mounts App in StrictMode. App switches local `experience` state between customer Assistant and Support. Conditional views, not URL routes. Preserve these customer boundaries. |
| Routing | No route definitions, route guards, deep-link handling or ADMIN route tree. A dedicated `/admin` tree fits React but requires explicit router/history and hosting fallback decisions in 15B. Suggested paths: `/admin/login`, `/admin/risk-assessments`, `/admin/risk-assessments/:id`; redirect authorized `/admin` to queue. |
| Authentication | No frontend authenticated session, role state or token manager. No protected-data gating or centralized 401/403 behavior. |
| API | `support.client.js` and `assistant.client.js` provide unavailable implementations, not live HTTP clients. Views accept injected clients. No shared fetch/base-URL/error/token abstraction or Vite API proxy. |
| Fetch/state | Local useState/useEffect/useCallback. SupportView guards initial effect results after unmount; manual refresh, no global cache or query invalidation. New HTTP client must normalize network failures and ignore superseded requests. |
| Forms | `SupportTicketForm.jsx`, `SupportTicketDetail.jsx`, `support.validation.js`: native controls, field validation, pending buttons, inline errors, focus on invalid input; no form library. Detail appends a message after success. Reuse interaction patterns, not customer ownership contracts. |
| Lists | `SupportList.jsx` renders ticket cards and status text. `SupportMessageThread.jsx` is a message list. No reusable operations table, pagination, server filters or search widget. |
| Feedback | Separate loading, error/retry and empty states in SupportList/SupportTicketDetail; status/alert semantics. No shared toast/notification system. Prefer persistent inline mutation feedback. |
| Dialogs | No established dialog/drawer or focus-trap implementation. Prefer full detail page and inline confirmation. |
| Styles/icons | Native CSS, system/Inter typography, shared button/field patterns; some support selectors are global, so audit cascade before reuse. Text/symbol icons and static assets, no icon library. Do not install a UI framework merely for admin. |
| Dates | `support.format.js` uses browser-locale Intl medium date/short time, with invalid-date fallback. Reuse formatting approach, add explicit timezone and machine-readable datetime/absolute timestamp. Do not calculate risk freshness in browser. |
| Responsive | Support detail grid collapses around 800px; controls/buttons stack around 560px; root min-width 320px. Reuse breakpoints as a starting point, verify actual overflow. |
| Accessibility | Labels, aria-invalid/describedby, status/alert/live regions, focus-first-invalid and heading focus on support navigation, visible focus and reduced-motion CSS. Existing App tab semantics do not establish a complete keyboard tab/tabpanel pattern. No claim of full conformance. |
| Workspaces | No ADMIN, rider or pharmacy pages. Assistant and Support are customer experiences; assistant voice input is not an operations dependency. |

## Authentication and authorization

Authoritative sources: `backend/src/routes/auth.routes.ts`, `backend/src/services/auth.service.ts`, `backend/src/middleware/authenticate.ts`, `backend/src/middleware/authorizeRoles.ts`, `backend/src/middleware/authorization.ts`, and `backend/src/auth`.

POST `/api/v1/auth/login` accepts the validated email/password login contract and returns `{token,user:{id,name,email,phone,role}}`. Despite the service name `loginCustomer`, existing active accounts of other roles can log in; registration creates CUSTOMER only and cannot grant ADMIN. GET `/api/v1/auth/me` requires Bearer authentication and returns `{user}`. There is no refresh/logout endpoint in the mounted auth router.

JWT uses HS256, subject UUID, role and expiry. Authentication checks the current database user's active status and role; the UI and JWT role alone are not authority. Missing/invalid credentials yield 401 (`AUTH_REQUIRED`, `INVALID_TOKEN`; inactive account `ACCOUNT_INACTIVE`); invalid login is `INVALID_CREDENTIALS`. Exact role checks produce 403 `FORBIDDEN`. ADMIN is not a super-role that automatically satisfies CUSTOMER or PHARMACY_STAFF guards.

| Caller | ADMIN risk endpoints | Customer order endpoints | Pharmacy staff operations |
| --- | --- | --- | --- |
| Unauthenticated | 401 | 401 | 401 |
| CUSTOMER | 403 | Own records only | 403 |
| DELIVERY_PARTNER (user's RIDER) | 403 | 403 | 403 |
| PHARMACY_STAFF (user's PHARMACY) | 403 | 403 | Membership checks also apply |
| ADMIN | Allowed subject to validation/lifecycle | 403 | 403 |

Recommended 15B behavior: establish session through login, verify identity/role through me, gate admin data until validation completes, and reject non-ADMIN with an access-denied view. A memory-only Bearer session and re-login on reload is the narrow starting option; persistent storage/refresh policy needs a separate explicit decision. Clear session and cached protected data on logout/401; 403 shows denied access without impersonation or customer fallback. Never log passwords/tokens, store them in URLs, or trust a frontend guard as a security boundary. Existing CORS middleware is not authorization. API origin and host fallback need environment configuration before integration.

## Mounted backend capability inventory

Registration sources: `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/routes/index.ts`, and every domain route file. Runtime server composition injects the Prisma-backed M13 risk service. The bare default app composition may lack that service and respond 503. Source presence is not proof of deployed availability.

All nine ADMIN-only endpoints below require valid Bearer authentication and exact ADMIN role. Errors use `{error,code}`. Common transport/auth failures include 401/403, malformed JSON 400, payload-too-large 413 and sanitized internal error 500. Only the queue provides pagination/filtering. All other rows have no list pagination, filter or sorting contract. POST rows mutate persistent state.

| Method and full path | Request | Success | Authority / domain errors |
| --- | --- | --- | --- |
| GET `/api/v1/admin/risk-assessments` | Strict severity/ruleCode/limit/offset query; details below | 200 `{data:Summary[],pagination:{limit,offset}}` | `risk/risk.routes.ts`, `risk.controller.ts`, `risk.validation.ts`, `risk.repository.ts`; 400 INVALID_RISK_REQUEST, 503 RISK_SERVICE_UNAVAILABLE, 500 INTERNAL_SERVER_ERROR |
| GET `/api/v1/admin/risk-assessments/:id` | UUID, empty query | 200 `{data:Summary & {evidence}}` | Same; additionally 404 RISK_ASSESSMENT_NOT_FOUND |
| POST `/api/v1/admin/risk-assessments/:id/acknowledge` | UUID, empty query, empty body `{}` | 200 `{data:Summary}` | Same plus `risk.service.ts`; additionally 409 RISK_ASSESSMENT_CONFLICT |
| POST `/api/v1/admin/risk-assessments/:id/resolve` | UUID, empty query, exactly `{reason:"OPERATOR_RESOLVED"}` | 200 `{data:Summary}` | Same mutation errors |
| POST `/api/v1/admin/risk-assessments/:id/dismiss` | UUID, empty query, exactly `{reason:"FALSE_POSITIVE"}` or `{reason:"DUPLICATE_CONTEXT"}` | 200 `{data:Summary}` | Same mutation errors |
| POST `/api/v1/delivery-assignments/offers` | Strict `{orderId,riderId}` UUIDs | 201 `{data:Offer}` | `delivery-assignments/assignment.routes.ts`, `.validation.ts`, `.service.ts`; 400 INVALID_ASSIGNMENT_REQUEST; 404 ORDER_NOT_FOUND/RIDER_NOT_FOUND; 409 ORDER_NOT_ELIGIBLE/RIDER_INACTIVE/RIDER_UNAVAILABLE/RIDER_LOCATION_UNAVAILABLE/RIDER_LOCATION_STALE/LIVE_ASSIGNMENT_EXISTS/ASSIGNMENT_ACCEPTANCE_CONFLICT |
| POST `/api/v1/dispatch/orders/:orderId` | UUID; empty body | 201 `{data:DispatchResult}` | `dispatch/dispatch.routes.ts`, `.validation.ts`, `.service.ts`; 400 INVALID_DISPATCH_REQUEST; 404 ORDER_NOT_FOUND; 409 ORDER_NOT_ELIGIBLE/NO_ELIGIBLE_RIDER/DISPATCH_CONFLICT; 422 PHARMACY_COORDINATES_UNAVAILABLE |
| POST `/api/v1/delivery-batches/evaluate` | Strict `{riderId,candidateOrderId}` UUIDs | 201 `{data:{batch,offer,compatibility,stopCount}}` | `delivery-batches/batch.routes.ts`, `.validation.ts`, `.service.ts`; 400 INVALID_BATCH_REQUEST; 404 ORDER_NOT_FOUND; 409 RIDER_NOT_BATCH_ELIGIBLE/RIDER_LOCATION_STALE/BATCH_CAPACITY_REACHED/PRIMARY_ASSIGNMENT_NOT_ELIGIBLE/CANDIDATE_ORDER_NOT_ELIGIBLE/CANDIDATE_ALREADY_ASSIGNED/ORDERS_NOT_BATCH_COMPATIBLE/BATCH_ETA_UNAVAILABLE/BATCH_DETOUR_TOO_HIGH/BATCH_CONFLICT; 422 RIDER_LOCATION_UNAVAILABLE/PRIMARY_COORDINATES_UNAVAILABLE/CANDIDATE_COORDINATES_UNAVAILABLE |
| POST `/api/v1/delivery-batches/:batchId/optimize` | UUID; route does not enforce an empty body | 200 `{data:{batchId,status,optimizedAt,totalDistanceKm,totalDurationMinutes,stops}}` | `delivery-routing/route.routes.ts`, `.validation.ts`, `.service.ts`; 400 INVALID_ROUTE_REQUEST; 404 ROUTE_BATCH_NOT_FOUND; 409 ROUTE_START_UNAVAILABLE/ROUTE_NOT_OPTIMIZABLE/ROUTE_CAPACITY_EXCEEDED/ROUTE_ETA_UNAVAILABLE/ROUTE_CONFLICT; 422 ROUTE_STOP_INVALID |

Delivery response details matter even though excluded from the minimum UI:

- Offer: id, orderId, riderId, batchId, status, assignedAt, acceptedAt, declinedAt, timedOutAt and computed expiresAt. Nested order includes id, orderNumber, fulfillmentMethod, status, pharmacyId, deliveryAddressLabelSnapshot, deliveryLatitudeSnapshot, deliveryLongitudeSnapshot, deliveryDistanceKm, quotedEtaMinutes and pharmacy id/name/latitude/longitude. This is not a minimized operations read DTO.
- DispatchResult: assignment `{id,orderId,riderId,status,assignmentScore,assignedAt}`, alreadyDispatched, evaluatedCandidates. A newly dispatched result also contains optimization `{mode,modelVersion,predictedCompletionMinutes,deterministicScore}`; the existing-assignment branch omits optimization. These ranking/model fields must not become operations metrics.
- Batch evaluation actually creates a batch, offer and stops. Batch includes id/riderId/status/createdAt; offer includes id/orderId/riderId/batchId/status/assignedAt. Compatibility returns pharmacySeparationKm/dropoffSeparationKm/estimatedDetourMinutes. It is not a read-only preview.
- Optimized stops include id, assignmentId, orderId, orderNumber, stopType, sequence, latitude, longitude, addressLabel, status and estimatedArrivalAt. Do not invoke optimization to obtain a read view or expose its coordinates in the first UI.

Other mounted domains are not ADMIN operations APIs: auth/login/me supports the shell; `/users/me` profile and address CRUD are self-only, not a user directory or role-management API. Public medicine list/detail/availability/alternatives and public pharmacy `GET /api/v1/pharmacies/:pharmacyId` are discovery contracts, not operational aggregates. Health is not business reporting. No support/assistant HTTP router is mounted. No additional ADMIN read directory or dashboard was found.

## M13 risk contract and lifecycle

Summary fields, exactly: `id`, `ruleCode`, `ruleVersion`, `entityType`, `severity`, `status`, `resolutionPolicy`, `detectedAt`, `lastEvaluatedAt`, `acknowledgedAt`, `resolvedAt`, `dismissedAt`, `resolutionReasonCode`, `revision`. Times are ISO strings; acknowledgement/resolution/dismissal times and reason can be null. Revision is an integer, not a client-submittable concurrency token.

Intentionally omitted: entityId, orderId, pharmacyId, rider/customer linkage, actor IDs, occurrenceKey, sourceOccurredAt, evidenceSchemaVersion, raw metadata and raw evidence. Queue has no evidence. Assessment id cannot be treated as an assignment/order id; no domain deep links can be built from this DTO.

Queue selects OPEN and ACKNOWLEDGED only, ordered detectedAt descending then id ascending. Severity accepts INFO/LOW/MEDIUM/HIGH; ruleCode matches `^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$`, maximum 80 characters, including syntactically valid historical codes. Limit is an integer string 1–100 (default 25); offset 0–1,000,000 (default 0). No leading zeros except zero. Unknown query keys are rejected. No status/search/sort parameter. There is no total, count, cursor, hasMore or closed-history list.

Detail can read any lifecycle state. Evidence is either `{status:"available",evidence:<allowlisted object>}` or `{status:"unavailable",reason:"unknown_rule"|"invalid_evidence"}`. Unknown historical rules retain valid metadata. Known-rule malformed evidence or unknown evidence schema becomes unavailable; malformed metadata can still fail the whole read with 500. Tolerance does not authorize mutation: mutations perform strict record reads, so unknown/malformed evidence can produce sanitized 500 even after a successful tolerant detail read. Render metadata and a clear unavailable explanation; never dump arbitrary JSON. Keep unavailable-evidence detail read-only as a conservative UI policy.

| Current state | Acknowledge | Resolve | Dismiss |
| --- | --- | --- | --- |
| OPEN | ACKNOWLEDGED | RESOLVED, OPERATOR_RESOLVED | DISMISSED, selected allowed reason |
| ACKNOWLEDGED | Same-state idempotent | RESOLVED | DISMISSED |
| RESOLVED | Conflict | Same-state idempotent | Conflict |
| DISMISSED | Conflict | Conflict | Same-state idempotent |

Same-target retries return the existing record, preserving original terminal reason; they do not replace it. No reopen or bulk operation exists. UI should omit redundant terminal actions. ADMIN manual resolution is allowed for all resolution policies, including HISTORICAL_EVENT_ONLY; that policy prevents automatic clearing, not operator closure. Automatic CONDITION_CLEARED resolution is a separate actorless AUTO_RESOLVABLE path. Risk closure does not deliver an order, retry dispatch, erase a failure or repair telemetry.

Controller reads current revision and performs a server-side compare-and-set. The HTTP contract does not accept expectedRevision/If-Match. Thus 409 protects concurrent server operations and invalid transitions, but does not promise that a mutation was applied to the version last seen in the browser. Refresh before confirmation, describe the action precisely, and accept server authority on races.

## Safe rule presentation

Always display server severity, lifecycle status, detectedAt and lastEvaluatedAt. These are separate from evidence event time. Titles below describe facts, not causes or individual quality.

| Rule / title | Expected severity / policy | Safe detail evidence | Interpretation and actions |
| --- | --- | --- | --- |
| ASSIGNMENT_OFFER_TIMED_OUT / Assignment offer timed out | INFO / HISTORICAL_EVENT_ONLY | assignmentStatus=TIMED_OUT, offerExpiresAt (nullable), timedOutAt | Recorded historical timeout, not a prediction or rider judgment. Null deadline means unavailable historical deadline. Acknowledge, manually resolve or dismiss while active; no automatic clearing. |
| DELIVERY_FAILED / Delivery failure recorded | HIGH / MANUAL_RESOLUTION | assignmentStatus=FAILED, eventType=FAILED_DELIVERY, occurredAt, orderStatusAtFailure, requiresManualReview=true | Operational review needed; no clinical urgency, blame or inferred failure cause. Acknowledge, manually resolve or dismiss while active. No failure notes or prescription content. |
| RIDER_LOCATION_STALE / Location update stale | LOW / AUTO_RESOLVABLE | assignmentStatus=ACCEPTED/PICKED_UP/OUT_FOR_DELIVERY, locationFreshness=STALE, lastLocationAt, freshnessThresholdMs, evaluatedAt | Stale telemetry for an active assignment at evaluation time. No misconduct, unreliability or location map. Server hooks/reconciliation may clear it; active records also permit ADMIN lifecycle actions. |

The threshold is finite and >=0. Authoritative freshness is age <= threshold FRESH, age > threshold STALE; zero is valid. UI displays the saved threshold and evaluation, never reclassifies evidence using its current clock or copies the rule. Future/missing facts are not inferred from an old stale snapshot. No rider reputation, customer reputation, fraud, priority score or speculative cause.

## Support, orders, delivery, pharmacy and prescription boundaries

Support sources: `backend/src/modules/intelligence-experience/support/support.service.ts`, its types/repository/contracts, and `frontend/src/modules/support`. Service methods createTicket/listOwnTickets/getOwnTicket/addMessage are customer-context contracts with reporter ownership and optional order ownership checking. The unavailable repository/ownership implementations and test doubles are not production HTTP capability. No support router is mounted; the frontend default client returns unavailable. Consequently ADMIN cannot currently list, inspect, reply to or change tickets.

Ticket statuses are OPEN/IN_PROGRESS/RESOLVED, but there is no implemented status-transition service. Messages are ownership-scoped; no support-agent role or ADMIN reply contract exists. No pagination/filter/sort contract. Customer DTOs include subject, description, category, optional orderId, status/timestamps and messages with isOwnMessage; reporter/sender identity is omitted. Free text may contain sensitive information. Existing customer view/form/thread components do not establish authorization for an operations inbox. A future support phase needs separate authorized service, persistence and transport work; defer it entirely.

Order sources: `backend/src/routes/order.routes.ts`, `backend/src/services/order.service.ts`, order validators and prescription controllers/services. Router is CUSTOMER-only; service enforces ownership. History supports optional status, cursor UUID and limit 1–50/default 20. Detail contains address snapshots/coordinates, medicine-item snapshots and prescription fileUrl/status metadata. ADMIN has no order list/detail contract, fulfillment read, pharmacy/delivery relationship read or prescription-status read. Risk failure evidence offers only orderStatusAtFailure, not a live order record. Do not reuse a customer DTO or loosen its guard to make an operations page.

Delivery: four ADMIN mutations exist as inventoried above, but no ADMIN list/detail of assignments, event history, dispatch attempts, rider state, batches or route summaries. `customer-tracking/tracking.routes.ts` is CUSTOMER/ownership-only; `rider-dashboard/dashboard.routes.ts`, rider offers, lifecycle and batch route reads are DELIVERY_PARTNER/ownership-only. M13 safe evidence can show timeout/failure/staleness snapshots, not live telemetry or operational history. No rider directory supplies safe action selectors. Never use mutation endpoints as queries, impersonate a rider or expose dispatch scores.

Pharmacy sources: `backend/src/routes/pharmacy.routes.ts`, pharmacy/inventory/dashboard services. Public known-id pharmacy profile exposes business id/name/description/contact/address/coordinates, not operational partner/verification status. Profile GET/PATCH, inventory list/detail/create/update, dashboard, order decision and prescription review require PHARMACY_STAFF plus pharmacy membership. ADMIN does not inherit this. Staff profile contains operational fields such as isActive/isVerified/partnerStatus/inventoryManagementMode, but they are not an ADMIN contract. Public medicine availability is not authoritative cross-pharmacy inventory freshness or fulfillment reporting.

Prescription approval/rejection remains human pharmacy work. No ADMIN review is authorized. Do not show prescription images, contents, diagnoses, clinical recommendations, inferred urgency, dosage decisions or medicine-safety judgments. Any future operational prescription-status field needs an explicitly minimized ADMIN DTO; no clinical content is needed for the proposed minimum.

## Data minimization

Classification is for this Operations UI, not a claim that fields lack sensitivity everywhere.

| Candidate field | Classification | Decision |
| --- | --- | --- |
| Risk rule/version, severity, lifecycle/policy, timestamps, reason code, allowlisted evidence | SAFE_OPERATIONAL | Existing explicit ADMIN projection; display only required fields. |
| Risk assessment id | SAFE_OPERATIONAL | Opaque detail reference; not a domain join key. |
| Other internal ids, order number, pharmacy business identity | NEEDS_JUSTIFICATION | Only through a future authorized operational projection and necessary linkage; no enumeration or joins. |
| Rider identity, full names, phone, email | NEEDS_JUSTIFICATION | Omit from minimum except minimal signed-in operator identity; no directory/contact details by default. |
| Customer address, exact coordinates (including rider/route stops) | NEEDS_JUSTIFICATION | Omit; existing mutation payload visibility alone does not demonstrate UI necessity. |
| Public pharmacy address/contact/coordinates | NEEDS_JUSTIFICATION | Public discovery availability does not justify copying into a new operations workspace. |
| Support free text and delivery failure notes | NEEDS_JUSTIFICATION | Sensitive unstructured content; absent from risk UI, needs separately scoped access and rendering rules. |
| Prescription images/content, medicine history used for clinical inference, diagnosis/dosage judgments | DO_NOT_SURFACE | Outside operational purpose and ADMIN authorization. |
| Individual scores, acceptance probabilities, model confidence/artifacts, hidden ranking, shadow telemetry, reputation | DO_NOT_SURFACE | No ML operations surface authorized. |
| Credentials, tokens, raw database rows or arbitrary evidence | DO_NOT_SURFACE | Never render/log or expose through generic inspectors. |

## Information architecture and dashboard feasibility

| Section | Classification | First increment decision |
| --- | --- | --- |
| ADMIN sign-in/shell | READY_FROM_EXISTING_API | Build frontend auth/routing against login/me. |
| Risk Queue/detail/actions | READY_FROM_EXISTING_API | Only initial business section; frontend absent today. |
| Overview counts/trends | BLOCKED_BY_BACKEND | No bounded aggregate contract. Omit overview, land on queue. |
| Support | BLOCKED_BY_BACKEND | No ADMIN transport/service/persistence integration. Omit. |
| Orders | BLOCKED_BY_BACKEND | Customer-only reads. Omit. |
| Deliveries | PARTIALLY_READY | ADMIN mutations exist but no appropriate read workspace; omit from minimum. |
| Pharmacies | PARTIALLY_READY | Public profile only; operational staff reads not ADMIN. Omit operations page. |

Queue page length is not total open risk count: it includes ACKNOWLEDGED and pagination. Severity filtering does not supply counts. Support/order/delivery state totals are also unavailable. Do not enumerate all pages, download sensitive datasets or invent zero counts when unavailable. A future overview requires separately approved bounded backend aggregate capabilities; a count of rows on the current page must be explicitly labeled as such and is not a dashboard metric.

## Risk Queue UX contract

- Desktop table: rule title/code, text severity, text status, entity type, detection time, last evaluation and a detail link. Detail includes policy/version, nullable lifecycle times/reason and formatted allowlisted evidence. No domain link, actor identity, map or priority score.
- Filters: server severity and rule only; reset offset on change. Do not send unsupported status/search/sort. Preserve query and offset in navigation; deterministic server ordering remains authoritative.
- Pagination: default 25, bounded page-size control, Previous at offset>0; Next only potentially available when returned length equals limit and next offset is within maximum. There is no proof of another page; an empty next page is legitimate. Offer Previous/reset. Do not invent total pages. Concurrent changes can shift offsets, causing skipped/repeated rows; refresh starts at first page.
- Detail uses a page, not a new modal framework. Preserve queue context and restore focus to the originating row when practical. Direct terminal detail links can work although terminal items leave the queue.
- Render unknown rule as escaped code/version and generic operational assessment; evidence unavailable with specific safe explanation. Known malformed evidence gets unavailable messaging. Never render raw JSON/HTML or assume current rule semantics from an unknown code.
- Manual refresh and last-successful-fetch time; no polling initially required. Mark retained rows stale after failure; disable mutation until current detail is fetched. Cancel/ignore superseded requests on filters, navigation and logout. Do not confuse fetch time with lastEvaluatedAt.
- Initial loading is not empty; successful empty first page means no matching active assessments. Distinguish filtered empty, empty later page, failed request, 404 detail, denied access and service unavailable. Keep retry bounded and user initiated; no automatic mutation retry.
- Confirm action on current detail. Acknowledge means reviewed, resolve means operator closes assessment, dismiss requires FALSE_POSITIVE or DUPLICATE_CONTEXT. No free-text reason field or bulk action. Unavailable evidence stays read-only.
- On success, use returned summary then refetch detail and queue; on resolve/dismiss the item leaves active queue. On 409 keep the page, explain change/invalid transition, refetch and require a fresh choice. On uncertain network outcome read first; never report failure as proof no mutation happened.

## Mutation safety inventory

All recommendations are pessimistic: explicit operator action, pending disable, no speculative status changes. Backend decides eligibility. Initial UI includes only the three risk mutations.

| Action | Required state and idempotency | Confirmation, conflicts and recovery |
| --- | --- | --- |
| Risk acknowledge | OPEN; same ACKNOWLEDGED returns existing | Lightweight inline confirmation; refetch queue/detail after success/409. |
| Risk resolve | OPEN/ACKNOWLEDGED; same RESOLVED idempotent | Confirm assessment closure, fixed OPERATOR_RESOLVED; not domain repair. Refresh and require fresh choice after conflict. |
| Risk dismiss | OPEN/ACKNOWLEDGED; same DISMISSED preserves original reason | Explicit reason selection and confirmation; same refresh/recovery rules. |
| Create assignment offer | DELIVERY order READY_FOR_PICKUP, no live assignment; eligible active/available/fresh rider. Duplicate conflicts, not general idempotency | Defer. Future selected order/rider confirmation and authoritative read refresh required; no blind retry after timeout or 409. |
| Dispatch order | DELIVERY READY_FOR_PICKUP; eligible candidates. Existing live assignment returns alreadyDispatched only after order eligibility check | Defer. Confirm creation/selection action. Repeated call after order progresses can conflict, so not unconditional idempotency. Refresh authoritative order/assignment before retry; no ranking display. |
| Evaluate batch | Active BUSY/fresh rider, unbatched primary ACCEPTED/PICKED_UP, eligible candidate, capacity/geographic/ETA checks | Defer. Confirm creation, not preview. Existing batch/candidate conflicts; no general idempotency. Future batch/assignment reads needed for recovery. |
| Optimize batch | Active PLANNED/ACTIVE batch, sufficient bounded actionable stops and valid route/ETA inputs | Defer. Confirm route sequence/ETA mutation. Repeated call recomputes timestamps, not idempotent. 409 requires new batch/stops read; do not automatically rerun. |

400 should show safe validation feedback, 404 an unavailable record, 401 clear session, 403 deny access, 503 service unavailable and 500 generic failure. Do not display raw diagnostics. UI disable is not security or concurrency protection. Unknown outcomes on delivery mutations cannot be safely reconciled in a full workspace until appropriate reads exist.

## Responsive and accessibility requirements

Use semantic headings and navigation links, labeled native filters and visible keyboard focus. Desktop table should have headers/caption; small screens can use equivalent labeled cards without hiding actions or evidence. Wrap/stack filters and compact navigation rather than introducing an unneeded drawer. Use a full detail page and heading focus after navigation. Long codes/UUIDs must wrap; verify at 320px and tablet widths.

Severity, status, loading, errors and pending actions need text, not color alone. Associate field errors, announce result/error once with suitable live regions, and keep focus stable during refetch. Confirmations need an explicit cancel path and safe focus return. If later adding dialogs/drawers, require accessible naming, focus containment, Escape behavior, initial focus and return focus. Respect reduced motion; test keyboard-only and screen-reader flows. Existing patterns help but do not replace validation of new UI.

## Backend gaps

There is no missing backend feature required for the proposed auth-plus-risk minimum. These are deferred capability contracts, not proposed route URLs or authorization to implement endpoints.

| Gap / why | Domain / kind | PII and security impact | Smallest possible API capability | Can minimum proceed without it? |
| --- | --- | --- | --- | --- |
| ADMIN ticket list/detail/reply/state with real persistence; current support is unavailable customer contract | Support / read + mutation | Free text and order links; exact ADMIN authorization, lifecycle and pagination needed | Bounded minimized ticket reads, scoped messages and explicit validated transitions backed by repository | Yes; omit Support. Broad domain work needs separate approval. |
| ADMIN order status and relationships | Orders / read | Exclude address, medicine history, prescription images; explicit ADMIN projection | Bounded order summaries and safe detail/status links | Yes; omit Orders. |
| Assignment/event/batch/route summary and safe selectors | Delivery / read | Minimize rider identity, omit exact coordinates/ranking; no rider impersonation | Bounded operational status/detail DTOs sufficient for action confirmation and outcome recovery | Yes; defer all delivery actions. |
| Operational pharmacy state and inventory freshness | Pharmacy / read | Business identifiers only as necessary; preserve staff-only review rights | Bounded nonclinical status/freshness summaries | Yes; omit Pharmacies. |
| Correct counts by risk severity/support/order/delivery state | Cross-domain / aggregate read | Avoid individual browser aggregation; define state/time scope and ADMIN authorization | Bounded aggregate counts with explicit as-of/filter semantics | Yes; omit Overview. |
| Risk-to-domain navigation | Risk/domain / read | Current omissions intentional; additional link IDs require authorization review | Explicit authorized linkage only if a separately approved domain screen needs it | Yes; assessment-only detail is useful. |
| Browser-observed revision precondition | Risk / mutation contract enhancement | Would improve stale-intent protection, but must preserve lifecycle/security | Optional future client revision precondition; not supported now | Yes; disclose current server-CAS semantics, refetch and confirm. |

No ML endpoint, assurance activation, clinical access, role broadening or database viewer is needed. Existing M12 scores and ETA internals remain excluded, as do confidence/artifacts/shadow telemetry and all future risk predictions. Do not expose legacy dispatch optimization fields simply because a response includes them.

## Recommended implementation phases

| Phase | Exact scope / frontend | Backend changes | Tests and dependencies |
| --- | --- | --- | --- |
| 15B ADMIN foundation | Route tree, isolated shell, login/me client, memory session, ADMIN gating, 401/403, safe error normalization and API-origin config; preserve customer views | None | Establish narrow frontend test tooling in that phase; test all roles, expired/invalid login, logout cache clearing, deep links/back navigation, network failure and customer regression. Requires approved routing/test choices and compatible backend credentials/environment for integration. |
| 15C Risk reads | Queue filters/pagination/detail, explicit evidence formatters, unknown/malformed evidence, loading/error/stale/empty, responsive/a11y from start | None | Contract tests against exact DTO shapes, boundary pagination, unsupported-query avoidance, superseded fetches, safe rendering, no hidden fields/domain links; use existing backend risk-api/admin-read tests as contract references. Depends on 15B. |
| 15D Risk lifecycle | Acknowledge/resolve/dismiss, inline confirmation/reason, pending states, refresh/invalidation and conflict/uncertain-outcome handling | None | Test transition matrix, same-target results, 409, 404, 401/403, unavailable evidence read-only, stale data and no optimistic mutation. Reference backend risk-service/repository/API tests. Depends on 15C. |
| 15E Release verification | Keyboard/screen-reader/responsive and real HTTP auth/read/mutation integration for completed minimum | None planned | Verify host fallback, no token/PII logs, independent ADMIN sessions/conflicts, actual M13 environment; no M14 migration activation. Source audit alone cannot certify deployment. |
| Later support phase, separately approved | No screen until authorized ticket contracts exist; then inbox/detail/reply/state | Broad support service/repository/auth/transport work | Ownership/role isolation, safe free text, pagination and transition tests; explicitly blocked for current scope. |
| Later orders/delivery/pharmacy phase, separately approved | Minimized read views first; separately approve any delivery actions | New minimized ADMIN read capabilities | Role/PII contract tests, live-state/conflict recovery and M14 deployment independence; not part of minimum. |
| Later overview phase, only if justified | Bounded aggregate display, no browser enumeration | Explicit aggregate contracts | Count/state/as-of semantics and authorization tests; depends on approved domain scope. |

These phases deliberately finish a useful risk workspace before expanding domains. No dependency on merging, pushing, rebasing, parked M14 or an unapplied migration is introduced.

## Audit validation and limits

Only this document is created. No existing file is modified. No frontend/backend/Prisma/ML source, tests, dependencies, routes or fixtures changed. No full test/build suite is warranted for this documentation-only audit. Final checks: `git diff --check`, separate whitespace inspection of this untracked file, `git status --short`, staged diff and protected-path diffs. Expected sole status entry: `?? backend/docs/operations-ui-audit.md`.

No database or production access, migration, staging, commit, push, pull or branch mutation. Backend authorization and risk lifecycle are sufficiently explicit for the minimum; optional domain expansions are blocked pending separate backend/product authorization. Runtime availability and production deployment are not claimed by this source audit.

## Phase 15B implementation (2026-09-18)

Implemented foundation only. The earlier URL routing proposal is deferred: App retains local view switching with an explicit Operations (ADMIN) entry alongside unchanged Assistant/Support views. No router, CSS framework or other dependency was added. There are no ADMIN deep links or browser-history routes in this phase.

Networking is separated into `frontend/src/api/http.client.js` (JSON transport, AbortSignal, safe HTTP status/code errors distinct from network failure), `modules/auth/auth.api.js` (existing POST `/auth/login` and GET `/auth/me`), `modules/auth/auth.session.js` (observable session state) and `modules/admin/AdminWorkspace.jsx` (gate/login/shell). Future API modules can use the session request boundary without accessing tokens or React components. No risk API calls exist yet.

The existing Bearer mechanism is used with a token held only in a closure in memory. Reload requires login; no local/session storage, cookies, remembered password or refresh protocol was added. Login's returned role is not trusted for access: `/me` must validate the user before the shell renders. Returning to Operations rechecks the in-memory session. Duplicate logins are suppressed; logout invalidates pending responses. Authenticated 401 clears this layer's session; 403 shows denied access without treating the account as invalid. Network/verification errors have explicit recovery. Backend authorization remains authoritative.

There is no backend logout endpoint. Sign-out clears frontend-owned memory only and does not revoke an already-issued JWT on the server. Base URL defaults to same-origin `/api/v1`; set build-time `VITE_API_BASE_URL` to the trusted backend base including `/api/v1` when origins differ. No prior frontend base-URL convention existed. A deployment proxy or explicit base URL is needed when Vite and API run on separate origins; no production URL is hard-coded.

The shell has an ADMIN identity, sign-out and a small landing message, with no unavailable domain navigation, metrics, clinical/ML data or Risk Queue. Native labels, keyboard form submission, status/error announcements, visible focus and narrow-screen CSS are included. Existing customer modules are unchanged.

Validation: focused Node tests 11/11; complete frontend Node suite 49/49 (`node --test test/*.test.js`); Vite production build and oxlint passed. No frontend typecheck script exists. Render tests use the already installed Vite SSR transform and React server renderer; they cover the ADMIN boundary and customer view rendering without adding dependencies. Session/transport tests cover all four backend roles, `/me` revalidation, failures, duplicate submission, logout races and 401/403 semantics. These are not browser interaction, screen-reader or live-backend integration tests; those remain release checks. No database was accessed.

Backend source, Prisma, M14, ML, package manifests and lockfiles are unchanged. Next phase: 15C deterministic Risk Queue reads only, using existing M13 contracts. Risk reads and lifecycle actions are not implemented by 15B.

## Phase 15C implementation (2026-09-18)

Added the real Risk Queue destination inside the ADMIN gate using local view switching. Only GET `/api/v1/admin/risk-assessments` and GET `/api/v1/admin/risk-assessments/:id` are called, through the existing authenticated session request boundary. No operational requests are mounted before ADMIN access is granted. Backend source was rechecked: queue contains OPEN and ACKNOWLEDGED, ordered detectedAt descending then id ascending, with severity/ruleCode filters and limit/offset only.

The new `frontend/src/modules/admin/risk` module separates API reads, presentation, observable request state and React rendering. Queue cards show title, rule/version, actual server severity/status and detection time without client reordering. Detail adds last evaluation and nullable lifecycle timestamps plus explicit typed evidence fields. Assessment UUID is used for requests and list identity only; no domain links or raw identifiers are displayed. Unsupported fields are excluded from the summary projection.

Known version-1 timeout, failure and stale-location evidence has explicit field/type mappings. Threshold zero is accepted without recalculating freshness. Unknown rules or versions retain safe summary information with neutral presentation and unavailable evidence. Missing/malformed evidence never becomes arbitrary JSON. Coordinates, notes, clinical content, ML fields and unrestricted metadata are not rendered.

Only severity and known-rule dropdowns are offered, each with All. No status filter exists in the backend and none is sent. Unknown historical rules remain visible under All rules. Filter changes reset offset. Fixed page size 25, Previous/Next controls and current page are bounded by the backend offset maximum; no total is fabricated. A full last page can lead to a genuine empty next page. Refresh preserves current filters/page and retains loaded data while refreshing. Offset pagination is not a stable snapshot.

AbortController plus independent request versions prevent superseded list/detail responses from replacing current state. Returning from detail retains queue filters/page/data. Unmount aborts requests; session expiry and denied access use the existing 401/403 boundary and unmount protected data. Network/400/404/409/5xx failures have safe messages and explicit retry; detail 404 clears any previously loaded detail. Failed refresh marks retained information as potentially out of date. No polling or automatic retry loop.

Semantic lists/cards use native controls, labeled filters, text severity/status, loading/error announcements and heading focus on list/detail navigation. Multi-column facts stack at narrow widths without requiring an operations table or UI framework. No lifecycle buttons, hidden mutation functions or disabled future actions were added.

Validation: focused Phase 15C tests 10 passed, 0 failed; full frontend suite 59 passed, 0 failed; production build and lint passed. No typecheck script exists. Concurrent Vite render tests initially reported a WebSocket-port collision despite passing assertions; disabling unused test-server WebSockets resolved it and the full suite passed cleanly. Existing auth, Assistant and Support regression tests remain included. Coverage includes API filters/bounds, pagination, refresh, list/detail/back, stale responses, errors/retry, 401/403, evidence/fallbacks and ADMIN-only rendering. No browser interaction, viewport screenshot, screen-reader or live-backend verification is claimed.

No dependencies, backend, Prisma, M14 or ML changes. No database access or migrations. Remaining limitations: local navigation has no deep links; no terminal-history list, totals or arbitrary historical-rule selector; live integration and browser accessibility checks remain outstanding. Phase 15D should add separately authorized risk lifecycle actions with confirmation and server-conflict recovery; none exists in this phase.

## Phase 15D implementation (2026-09-18)

Implemented only the existing authenticated ADMIN lifecycle POST endpoints under `/api/v1/admin/risk-assessments/:id`: `/acknowledge` with `{}`, `/resolve` with `{reason:"OPERATOR_RESOLVED"}`, and `/dismiss` with `{reason:"FALSE_POSITIVE"}` or `{reason:"DUPLICATE_CONTEXT"}`. All return 200 `{data:Summary}`; no query, evidence, actor id or client revision is sent. Backend source was reverified: 400 validation, 404 missing record, 409 conflict/invalid transition, 401 authentication, 403 authorization, 503 unavailable service and sanitized 500 remain authoritative.

OPEN exposes acknowledge, resolve and dismiss; ACKNOWLEDGED exposes resolve and dismiss. Terminal records expose no actions. Backend same-target repeats are idempotent but redundant terminal controls are omitted. Manual ADMIN resolution is allowed across all existing resolution policies; HISTORICAL_EVENT_ONLY does not prohibit operator closure. No new frontend rule-specific policy restriction was introduced.

Per the explicit Phase 15D clarification, dismissal requires the operator to choose False positive (`FALSE_POSITIVE`) or Duplicate context (`DUPLICATE_CONTEXT`). There is no default selection, free text, notes, custom reason or explanation field. Missing/unknown reasons are blocked in state and API layers. Cancel clears the selection and sends no request.

Detail-only inline confirmation identifies the action and safe rule context. Copy describes only assessment lifecycle changes, not delivery success, refunds, domain repair or blame. Buttons, labeled selector, focus on the confirmation heading, focus return on cancel, status messages and wrapping native controls support keyboard/narrow-screen use without a dialog library. During submission and reconciliation, content remains readable; contradictory actions and duplicate submissions are blocked. Detail/back controls briefly wait for reconciliation; global customer navigation and sign-out remain available.

Mutations are pessimistic. No lifecycle status is changed locally before authoritative response. Success refetches both detail and the current filtered queue; server filtering determines membership, including terminal removal. No OPEN status filter was invented. A 409 receives a distinct neutral message, refetches both views, recalculates available actions and never replays the mutation. A 400 reports rejection and reconciles; 404 clears unavailable detail and refreshes the queue. Network/5xx outcomes are explicitly unconfirmed and reconciled through reads, never automatically retried. Failed reconciliation blocks new actions until failed reads are refreshed. Existing 401 session clearing and 403 access-denied distinction remain intact. Navigating away invalidates late callbacks; it cannot undo a POST already received by the server.

Known current rule/version plus valid allowlisted evidence is required for action availability in addition to lifecycle state. Unknown historical rules/unsupported versions remain tolerant-read/read-only with a neutral explanation. Malformed/unavailable evidence retains “Operational evidence unavailable” and no actions. Extra evidence fields also fail action eligibility, matching strict backend evidence validation. These gates avoid known strict-read failures; backend validation remains authoritative. The HTTP contract still uses server-read revision/CAS, not a browser-supplied revision, so confirmation does not provide a client-version precondition.

Validation: focused lifecycle tests 18 passed, 0 failed; complete frontend tests 77 passed, 0 failed; build and lint passed; no frontend typecheck configured. Tests cover all actions, confirmation/cancel, exact dismissal values/no default/invalid reason, pending duplicate prevention, pessimism, detail/filtered queue reconciliation, conflicts without replay, 400/404/network/5xx and 401/403, unknown/malformed read-only rendering and existing frontend regressions. Tests use state/transport and React server rendering; browser keyboard/focus, screen-reader and live-backend verification were not performed.

Cumulative scope remains 15A documentation, 15B HTTP/auth/shell, 15C risk reads, 15D existing risk lifecycle calls only. No dependencies, backend source, Prisma/migration, ML or M14 changes; no support/order/delivery/pharmacy actions, PII expansion, clinical functionality, reputation scoring or automatic domain side effects. Nothing staged/committed/pushed; no database accessed or migration applied. Recommended next phase: browser accessibility/responsive and authorized environment integration verification of the completed risk workspace, with M14 still parked.

## Phase 15E integrated verification (2026-09-18)

The cumulative architecture still has clear boundaries: HTTP transport, auth API, memory-only auth session, ADMIN shell, risk API, request state, presentation allowlists, React views and lifecycle action eligibility. React components do not issue raw fetches; auth handling is centralized; lifecycle transitions have one availability mapping; no circular dependency, debug path, production mock or unused speculative API was found.

Auth review confirmed startup checking, unauthenticated login, token receipt, `/auth/me` role validation, ADMIN shell, non-ADMIN denial, 401 clearing, 403 distinction and frontend-only logout. The token remains closure-scoped memory only. No local/session storage, credential logging, token URL, hard-coded identity, unsafe HTML or frontend authorization bypass was found. Backend authentication and exact ADMIN authorization remain authoritative.

Risk DTO and backend lifecycle sources were rechecked. The UI preserves server ordering, sends only severity/ruleCode/limit/offset, requests 25 records, fabricates no total or aggregation, and uses request versions plus abort signals. Evidence still uses explicit typed mappings; the only `JSON.stringify` match is transport request serialization and the only `Object.entries` match enumerates the static known-rule presentation map. No generic evidence renderer or sensitive/ML/M14 data path exists. Rule copy is factual, including stale telemetry without rider blame. OPEN permits acknowledge/resolve/dismiss, ACKNOWLEDGED permits resolve/dismiss, terminal records none; strict-ineligible historical/malformed records remain readable and actionless.

Verification found and fixed four concrete frontend defects within existing scope:

- Risk actions could briefly become available during a queue refresh after an earlier queue error was cleared. Action selection/confirmation now also requires the current queue and detail reads to be idle, with explanatory loading text.
- A lifecycle result message could carry into a newly selected assessment. Normal selection now clears prior action feedback while mutation reconciliation preserves its result.
- Cancel focus restoration used a microtask that could run before React committed the confirmation removal. Restoration now occurs in a post-render effect; mutation results also receive programmatic focus after reconciliation.
- Assistant/Support controls used incomplete tab semantics without keyboard tab behavior or tabpanel ownership. They now use consistent pressed-button semantics, matching the Operations selector and existing local view switching.

The malformed-evidence explanation was also rewritten from internal “mutation contract” terminology to concise operator language. Focused regression coverage was added for loading gates and cross-assessment feedback clearing. No product capability was added.

Browser tooling already present in the environment launched the Vite frontend locally without installing dependencies. At 1280×800 and 375×812, Assistant and Operations navigation and the Operations sign-in view rendered without observed crash, clipping or essential horizontal overflow; the narrow layout stacked navigation and retained usable labeled inputs and button. Keyboard Tab reached the email input, and the visible focus outline was confirmed. Authenticated Risk Queue/detail/confirmation could not be browser exercised because no live backend or credentials were used; their structure remains covered by React server-render and state/transport tests. Browser console capture, screen-reader verification and live ADMIN integration were not performed. The temporary viewport was reset and the verification tab closed.

Test review found no sleeps, persistent handlers or shared auth state. Vite render-test servers are closed in `finally`; their WebSockets are explicitly disabled because middleware SSR transforms do not require HMR, deterministically removing the previous shared-port race rather than suppressing an application failure. Focused Milestone 15 tests passed 40/40. The complete frontend suite passed twice independently, 78/78 each run. Vite production build and oxlint passed; no frontend typecheck script exists.

The database-free focused backend M13 contract subset (`risk-api`, `risk-admin-read`, `risk-service`, `risk-repository`) passed 217/217. It covers ADMIN list/detail and authorization, lifecycle/validation/conflicts, strict mutation reads, tolerant redacted admin reads and evidence safety. No complete backend suite was run and no database/network was contacted.

No known correctness defect remains in the implemented local scope. Browser-authenticated and live-backend integration, screen-reader testing, terminal-history discovery, deep links and environment/API-origin deployment configuration remain limitations. This is checkpoint readiness, not production readiness.

Milestone 15 itself has no observation-assurance, OperationalRiskObservation, M14 migration, Phase 14B or operational-risk ML dependency. The branch-level caveat remains: migration `20260916000000_observation_assurance` is unapplied and PostgreSQL validation is outstanding, so the entire current branch is not approved for deployment against an unmigrated shared/live database merely because this frontend milestone passes local checks.
