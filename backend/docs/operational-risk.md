# Operational risk — Phases 13A–13E

This module records internal operational attention only. It does not assess medical
urgency, prescription safety or clinical risk. It has no scores, probabilities,
model versions or ML dependencies. Legacy `RiskAssessment` is unchanged, including
its rows and score/review semantics.

## Scope and composition

`risk.types.ts` defines domain contracts independently of generated Prisma types.
`risk.evidence.ts` validates detections and allowlisted evidence. `risk.repository.ts`
contains the narrow repository interface and `PrismaOperationalRiskRepository`;
`risk.service.ts` exposes detection recording, lifecycle actions and internal reads.
Construct the repository with `prisma.operationalRiskAssessment`, then inject it
into `OperationalRiskService`. No client is created or imported as a singleton.
Phase 13C injects the service into production hooks without an eager database query.

Phase 13B adds three pure rule evaluators; Phase 13C adds post-commit hooks and one
post-read observation point. Phase 13D adds ADMIN-only HTTP routes. There are no jobs, customer
projections, support tickets, automatic domain actions, or frontend changes.
Existing delivery, dispatch, rider, inventory and prescription semantics remain
unchanged. Hooks only write risk assessments.

## Durable occurrences

`OperationalRiskAssessment` is a new UUID-based table. Each assessment stores its
rule/version, evidence schema version, primary entity, optional order/pharmacy
links, severity, resolution policy, evidence snapshot, source/detection/evaluation
timestamps, lifecycle actor/timestamps, reason code and revision. `createdAt` uses
the DB default; `updatedAt` is maintained by Prisma. Detection and evaluation
timestamps must be supplied explicitly as valid Dates, with source time no later
than detection and evaluation no earlier than detection. There is no implicit clock.

The database unique key is exactly:

`(ruleCode, ruleVersion, entityType, entityId, occurrenceKey)`

The repository attempts INSERT first, catches only the occurrence's P2002 conflict,
and reads the winner. Other failures become `OperationalRiskError` with sanitized
`PERSISTENCE_FAILED`; validation failures use `INVALID_INPUT`. No database details
or rejected evidence are copied into error messages.

Repeated detections preserve **all** original metadata, including severity,
evidence, source/detected times, evaluation time, optional links, policy, revision,
and lifecycle. They do not reopen dismissed/resolved records. Distinct occurrence
keys or rule versions produce distinct records. No `touchEvaluation` is exposed in
13A; future re-evaluation needs its own explicit concurrency contract.

Rule codes use upper snake case (maximum 80 characters), without a three-name
restriction in the format validator. Rule versions are positive decimal strings
(`"1"`, then `"2"`; no leading zero, maximum 16 characters), independent of package
and evidence versions. Evidence schema version starts at integer `1`.

Occurrence keys contain 1–200 ASCII letters/digits/dots/underscores/colons/hyphens,
starting with a letter/digit. The repository never invents one. Future trusted
rules must supply a deterministic genuine occurrence anchor, never evaluation
time, personal data or notes. Syntax validation cannot establish that provenance.

## Entity links and actors

Entity types are ORDER, DELIVERY_ASSIGNMENT, PRESCRIPTION and PHARMACY_INVENTORY.
There is no customer or rider entity type and no permanent rider reputation.
All three initially registered evidence schemas require DELIVERY_ASSIGNMENT.
Other entity types reserve the domain vocabulary; recording them will require a
separately reviewed evidence registration in a future phase.

UUIDs are validated and lowercased. ORDER scope requires `orderId === entityId`.
PHARMACY_INVENTORY cannot carry an order link; its pharmacy link is optional in
this foundation. Assignment/prescription order and pharmacy links are optional.
Generic entity IDs have no polymorphic FK and are not existence-queried. Trusted
future rule readers must derive these IDs and their matching order/pharmacy links
from authoritative rows; UUID/FK validation alone does not establish ownership or
cross-entity consistency. The repository performs no domain hydration.

Optional order, pharmacy and three actor FKs use restrictive deletion. Referenced
records cannot be deleted while history points to them. Actor fields reference
User through named relations; a valid UUID or FK **does not prove ADMIN role**.
Only trusted internal callers that have already authorized the identity may supply
an actor. There is no API authorization boundary or public exposure in 13A.

## Evidence and privacy

Evidence is parsed against `(ruleCode, evidenceSchemaVersion)` using strict
allowlists. Unknown registrations fail closed, independently of rule version.

| Schema | Allowed evidence |
| --- | --- |
| ASSIGNMENT_OFFER_TIMED_OUT / 1 | `assignmentStatus: TIMED_OUT`, nullable `offerExpiresAt`, `timedOutAt` |
| DELIVERY_FAILED / 1 | `assignmentStatus: FAILED`, `eventType: FAILED_DELIVERY`, `occurredAt`, enumerated `orderStatusAtFailure`, `requiresManualReview: true` |
| RIDER_LOCATION_STALE / 1 | active `assignmentStatus` (ACCEPTED/PICKED_UP/OUT_FOR_DELIVERY), `locationFreshness: STALE`, `lastLocationAt`, finite nonnegative (`>= 0`) `freshnessThresholdMs`, `evaluatedAt` |

Evidence dates must already be canonical UTC ISO strings with milliseconds, such
as `2026-09-14T00:00:00.000Z`. Date objects are not implicitly serialized. Extra
fields, symbols, hidden properties, accessors, custom prototypes, undefined,
functions, unsupported values and nonfinite numbers are rejected. Values are
detached from caller-owned objects before persistence; returned records are copies.

No names, email, phone, addresses, coordinates, medicine names, prescription files,
support messages, failure notes, rider IDs or order numbers belong in evidence.
Failure causes are not interpreted. The evidence layer validates shape, not whether
a rule condition is true. Phase 13B performs pure evaluations using explicit facts;
authoritative source readers and reconciliation remain deferred.

## Lifecycle and concurrency

Every new occurrence starts OPEN with revision 0, including historical-only
events. `HISTORICAL_EVENT_ONLY` is persisted metadata, not an automatic close or
escalation instruction. Operator closure is available; future queue policy must
decide how historical events are displayed without making indefinite alerts.

| Action | Allowed source | Actor and reason |
| --- | --- | --- |
| acknowledgeAssessment | OPEN | trusted admin UUID, no reason |
| resolveAssessment | OPEN / ACKNOWLEDGED | trusted admin UUID and OPERATOR_RESOLVED |
| automatic resolveAssessment | OPEN / ACKNOWLEDGED, AUTO_RESOLVABLE only | null actor and CONDITION_CLEARED |
| dismissAssessment | OPEN / ACKNOWLEDGED | trusted admin UUID and FALSE_POSITIVE or DUPLICATE_CONTEXT |

Each call supplies `id`, `expectedRevision`, `at`, `actorId`, and the applicable
reason code. Reasons are a closed four-code vocabulary, never arbitrary text.
Reaching the same target status is idempotent and preserves the original actor,
timestamps and reason, including when a duplicate request uses an older revision.
Other terminal transitions return a typed conflict. There is no reopen/delete API.

Writes use one conditional `updateMany` on ID, expected revision **and** status,
incrementing revision by one. A pre-read never authorizes a blind overwrite.
Older action times (before detection, evaluation or acknowledgement) are conflicts.
On a lost CAS the repository reloads: the requested target already reached means
idempotent; otherwise conflict. It never retries by silently accepting a newer
revision. The caller must re-read and consciously submit a new revision. If another
action happens between a successful write and reload, the result reflects that
new state, not a fabricated snapshot of the earlier state.

Lifecycle results are `updated`, `idempotent`, `conflict` (with current record), or
`not_found`. A transport/persistence error has uncertain write outcome; safely
retrying the same command converges without replacing the winning actor/time.

## Reads and indexes

`getById`, `getByOccurrence`, `listByOrder`, and `listOpen` return internal records.
Open queries include OPEN and ACKNOWLEDGED, with optional severity and rule code.
Lists sort by `detectedAt DESC, id ASC`; severity is a filter, not a sort priority.
Offset pagination defaults to 25/0, limits 1–100 and offsets 0–1,000,000 (integers).
Ordering is deterministic for a fixed dataset; offset pages are not a snapshot
across concurrent inserts. Phase 13D authorizes its separate admin reads at the HTTP boundary.

Indexes support `(status, severity, detectedAt)` operational filtering,
`(entityType, entityId, detectedAt)` entity history, `(orderId, detectedAt)` and
`(pharmacyId, detectedAt)` scoped history, and `(ruleCode, status)` rule queues.
Three single-column actor FK indexes support restrictive referential checks.
No workload-specific tuning or live query plan claims are made.

## Migration and verification

The additive migration creates four enums, one table, the unique occurrence key,
eight query/FK indexes and five restrictive FKs. It has no backfill, fabricated
assessments, destructive changes or legacy-model alterations. Generated using
Prisma schema-to-schema `migrate diff --script`, without database access. It has
not been applied to any database.

`risk-repository.test.ts` exercises the production repository using an injected
atomic fake delegate (including uniqueness conflicts and lost CAS races), plus
schema/migration invariants and the pre-13A legacy model fingerprint.
`risk-service.test.ts` covers validation, privacy, lifecycle and internal reads.
`risk-test-store.ts` is shared test-only infrastructure. These tests do not claim
to exercise PostgreSQL isolation, actual FK enforcement or deployed database data.

## Phase 13B: pure initial rules

`risk.rules.ts` exports an explicit immutable registry and three evaluators. Each
metadata record specifies rule version `"1"`, evidence schema version `1`, and
DELIVERY_ASSIGNMENT scope. No dynamic loading or arbitrary rule execution exists.

| Rule | Severity | Resolution policy | Occurrence key |
| --- | --- | --- | --- |
| ASSIGNMENT_OFFER_TIMED_OUT | INFO | HISTORICAL_EVENT_ONLY | assignment UUID |
| DELIVERY_FAILED | HIGH | MANUAL_RESOLUTION | durable failure-event UUID |
| RIDER_LOCATION_STALE | LOW | AUTO_RESOLVABLE | assignment UUID + `:` + last-location ISO anchor |

Historical-only metadata does not close a record here. Future integration must
avoid displaying historical timeouts as indefinitely open operational alerts.
No rule assigns rider blame or creates a rider reputation record.

### Inputs and results

All facts are explicit, narrowly typed, readonly inputs. Each evaluator receives
`evaluatedAt: Date`; optional `orderId` may be supplied only by a trusted reader.
Pure rules implement no reader or database lookup. In particular, their trusted
caller must establish that the supplied event belongs to the supplied assignment.

Results are `matched` with an `OperationalRiskDetection`, `not_matched`, or
`unavailable` with one of `missing_required_fact`, `invalid_required_fact`,
`inconsistent_facts`, `unsupported_state`. Expected malformed facts do not throw;
unexpected programming errors are not swallowed by a blanket catch.

Evaluation first checks assignment status. Missing or malformed status is
unavailable; an unknown string is unsupported_state. A known status outside a
rule's scope is not_matched without validating facts that rule does not need.
Within scope, null/undefined required facts are missing, malformed UUIDs/Dates/
numbers are invalid, and contradictory chronology is inconsistent. Recognized
states come from the authoritative assignment enum, including REASSIGNED.

Matched results set `detectedAt` and `evaluatedAt` to the supplied evaluation time.
Historical rules use the recorded timeout/event time for `sourceOccurredAt` and
reject a source time after evaluation. Stale-location sets `sourceOccurredAt` to
null: neither location receipt nor evaluation is an authoritative condition-entry
event. Results pass the existing full detection/evidence validator and are detached
copies. Repeated evaluation of identical facts returns deeply equivalent results.

### Recorded assignment timeout

`evaluateAssignmentTimeout` takes assignmentId, status, assignedAt,
offerExpiresAt (explicit nullable legacy deadline), timedOutAt, evaluatedAt and
optional trusted orderId. Only recorded TIMED_OUT with a valid timedOutAt matches.
Both assignment and evaluation times must be valid. Timeout cannot precede
assignment or follow evaluation. A supplied deadline must be valid, not precede
assignment, and be at or before timedOutAt. Equality is accepted; timedOutAt remains
processing time and can be later than the deadline.

A null legacy deadline still matches and remains null in evidence. An omitted
deadline is missing_required_fact; it is not silently treated as known legacy null.
No deadline is reconstructed from configuration or elapsed time. Evidence contains
only assignmentStatus, offerExpiresAt and timedOutAt. The assignment UUID alone
identifies the occurrence across later evaluations.

### Recorded delivery failure

`evaluateDeliveryFailed` takes assignmentId, assignmentStatus, evaluatedAt and a
nullable failureEvent containing id, eventType, occurredAt, orderStatusAtFailure,
and requiresManualReview. A FAILED assignment requires a durable FAILED_DELIVERY
event with valid UUID/time and an allowlisted recorded order status. Wrong event
type is inconsistent_facts; missing event is missing_required_fact.

For otherwise valid facts, requiresManualReview false is not_matched: v1 represents
failures explicitly requiring operational review. True matches. It never infers
failure from order state or absence of completion. Evidence preserves the recorded
order status without cause interpretation, failure notes or personal information.
The event UUID distinguishes separate durable failures for the same assignment.

### Stale location on an active assignment

`evaluateRiderLocationStale` takes assignmentId, assignmentStatus, lastLocationAt,
freshnessThresholdMs and evaluatedAt. Active states are exactly ACCEPTED, PICKED_UP
and OUT_FOR_DELIVERY, matching current lifecycle/dashboard semantics. OFFERED,
DECLINED, TIMED_OUT, FAILED, DELIVERED, CANCELLED and REASSIGNED do not match.

The evaluator reuses `classifyLocationFreshness`, always passing the explicit
evaluation time. It never invokes the helper's optional wall-clock fallback.
Missing location is unavailable/missing_required_fact; invalid Dates are
unavailable/invalid_required_fact. Future location time is inconsistent_facts,
checked before the helper can clamp future age to zero.

Threshold is finite and **>= 0**, including fractional values. The approved 13A
defect correction changed only `.positive()` to `.nonnegative()` for this evidence
field; no other existing evidence constraint was loosened. Authoritative location
configuration and freshness helper remain unchanged.

The exact boundary is `age <= threshold` fresh/not_matched; `age > threshold`
stale/matched. At threshold zero, equal timestamps do not match and age of one
millisecond matches. Missing/future location retains its unavailable semantics.
No weekdays, timezone features, coordinates or rider IDs participate.

Occurrence key uses the normalized assignment UUID and canonical lastLocationAt
ISO string, never evaluatedAt. For valid extended positive ISO years only, the
leading `+` is removed from the key anchor to fit the existing key alphabet;
the evidence retains the canonical ISO string. Anchors remain unambiguous.
Same lastLocationAt produces the same occurrence across later evaluations;
a newer location anchor followed by staleness produces another occurrence.

Evidence includes the supplied evaluation time for explanation. A later evaluation
may therefore produce newer evidence under the same occurrence key. Phase 13A
create-or-get intentionally retains the first evidence and evaluation timestamp;
its persistence semantics are unchanged. Explicit reconciliation remains deferred.

### Purity and verification

Rule modules import only domain/evidence helpers and the pure location freshness
helper. They do not read environment/configuration, obtain current time, access
Prisma, call risk services, or mutate domain state. Input objects are never spread
into persisted evidence: output fields are explicitly selected.

`risk-rules.test.ts` verifies exact metadata, malformed facts, chronological
consistency, all active/inactive statuses, freshness boundaries (including zero),
deterministic identities, input/output isolation, privacy, Phase 13A validation,
and execution with wall-clock access disabled. Pure evaluation tests make no risk
assessment writes. Existing service tests separately verify the approved evidence
contract against injected stores.

## Phase 13C: failure-isolated post-commit hooks

`risk.hooks.ts` provides `createRiskHooks`, the narrow injected service/reader/error
contracts and the final `runRiskHook` integration guard. Domain services pass only
trusted identifiers, statuses and timestamps. They do not construct evidence,
severity, versions or occurrence keys and never access the risk table directly.
The pure rules remain unchanged.

`createApp` and direct service factories default to disabled/no-op risk behavior.
`server.ts` constructs the Prisma risk repository/service and injects it into the
app, together with a minimal active-assignment reader selecting only ID, status
and orderId for the committed rider ID. No risk-table query occurs during startup.
The reader is called only after a successful location commit; no request-supplied
assignment identity is used to discover recovery scope.

### Timeout and failure integration

All production OFFERED → TIMED_OUT writers are in assignment.service.ts:
`listMyOffers`, expired `acceptAssignmentOffer`, and expired
`declineAssignmentOffer`. Each transaction attempt collects only its own successful
conditional timeout writes. Only the returned, committed attempt emits callbacks.
Rolled-back or exhausted attempts emit none. A zero-row timeout update emits none
and does not change the preexisting domain outcome.

Facts retain assignedAt, nullable persisted offerExpiresAt, committed timedOutAt
and authoritative assignment/order IDs. Expired accept/decline emit the callback
after commit and before returning the unchanged OFFER_EXPIRED error. Historical
timeout assessments are recorded without automatic acknowledgement/resolution.

`failDelivery` returns a private outcome envelope containing its unchanged public
response and the newly created event ID with the committed status/time/review
metadata. Failure notes stay solely in the existing DeliveryEvent write and are
never passed to the hook. After commit the hook records the HIGH/MANUAL_RESOLUTION
assessment; it never changes order status or automatically resolves it.
An already-FAILED assignment follows its original idempotent response path without
inventing/replaying an event. If the original risk write failed, that missed
assessment needs later reconciliation; repeated requests are not a recovery job.

### Observation and fresh recovery

Customer tracking is the single chosen post-read detection point. Its existing
ownership-scoped query already supplies the assignment, lastLocationAt and
freshness threshold. After that read, while location sharing remains active, a
thin fact object is passed to `observeLocation`. The pure rule decides whether to
record an occurrence. No extra domain query, response field or domain mutation is
introduced. Fresh reads do not create or resolve assessments. Unauthorized,
missing-assignment and terminal tracking paths do not detect risk.

Location updates normally make location fresh. They do not pretend to detect
staleness. After the location transaction commits, `locationUpdated` uses the
committed server timestamp and a minimal trusted active-assignment read to attempt
recovery. A current active state and a validated fresh result are both required:
not_matched alone is insufficient because inactive assignments also do not match.
Missing/invalid/future locations, failed reads and unknown assignment scope never
resolve anything. Zero thresholds retain the authoritative exact-boundary behavior.

The existing `listByOrder` API is sufficient for conservative assignment-scoped
resolution. Hooks page through history before writing (100 per page, within the
repository's existing offset bound), then select only OPEN/ACKNOWLEDGED version-1
RIDER_LOCATION_STALE assessments for the exact order and assignment with
AUTO_RESOLVABLE policy. Stored evidence is validated and reevaluated by the pure
rule to verify the recorded occurrence anchor.

The old location anchor must be strictly earlier than the fresh update, and its
evidence evaluation, detectedAt and lastEvaluatedAt must not exceed the recovery
observation time. Thus an old callback cannot clear a newer episode or a later
observation. Resolution supplies the recorded revision, null actor and
CONDITION_CLEARED. Concurrent changes yield the existing service's conflict or
idempotent result; hooks do not retry by adopting a newer revision. Neither the
repository nor lifecycle persistence semantics were broadened.

### Isolation, limits and deployment

Pure evaluation, risk persistence and the optional error observer run outside
domain transactions. Their failures are caught at hook/integration boundaries.
They cannot roll back or replace a successful domain result or OFFER_EXPIRED.
Callbacks are awaited, so secondary storage latency can add response latency;
there is no background queue or delivery guarantee in this phase.

Error observers receive only operation (`record_detection`/`auto_resolve`), one of
the three rule codes, and a bounded reason (`service_unavailable`,
`evaluation_unavailable`, `persistence_failed`). No IDs, evidence, raw exceptions,
coordinates, contacts or failure notes are emitted. Observer errors are isolated.
The production observer logs only that safe object. All customer/rider response
projections remain unchanged.

Detection is opportunistic: an unobserved assignment will not create a stale alert.
A process exit, failed hook, late stale-read insertion after a recovery scan, or
concurrent offset-page shift can leave missed detections/resolutions. The bounded
scan likewise does not promise exhaustive reconciliation of unlimited history.
Callbacks converge through existing occurrence uniqueness, but no outbox or
scheduler is added. Phase 13E provides bounded reconciliation for these cases.

Terminal stale-assessment cleanup (DELIVERED, FAILED, TIMED_OUT, DECLINED,
CANCELLED and REASSIGNED) is provided by Phase 13E without broadening lifecycle
wiring. Repeated-timeout escalation and additional operational rules remain
deferred. Phase 13D adds the risk APIs described below. No support tickets,
ML changes, dispatch-ranking changes or frontend changes are included.

**Deployment prerequisite:** apply the Phase 13A operational-risk migration before
deploying the Phase 13C production server. This task did not apply any migration,
access a live database manually or introduce startup auto-migration. Missing-table
errors during later hooks remain isolated, but risk persistence would be unavailable.

`risk-hooks.test.ts` uses injected stores/services without a live Prisma client.
Assignment, lifecycle, location and tracking integration tests assert commit order,
rollback/retry isolation, failure isolation, unchanged responses and privacy.
Fixtures use valid UUIDs, and created event fixtures now include durable event IDs.

## Phase 13D: ADMIN observability and lifecycle API

The router is mounted at `/api/v1/admin/risk-assessments` in the existing app
factory. It reuses the production risk service and its injected repository; no
additional Prisma client is created. Existing authentication, `requireAuthentication`
and `requireRole("ADMIN")` run before handlers. Unauthenticated requests receive
401; CUSTOMER, PHARMACY_STAFF and RIDER receive 403. An app constructed without
the admin service capability remains usable; authorized risk requests receive 503.

| Method/path (relative to the prefix) | Behavior |
| --- | --- |
| GET `/` | OPEN/ACKNOWLEDGED queue |
| GET `/:id` | Safe detail for any lifecycle status |
| POST `/:id/acknowledge` | Empty body; existing strict acknowledge action |
| POST `/:id/resolve` | `{ "reason": "OPERATOR_RESOLVED" }` only |
| POST `/:id/dismiss` | Reason FALSE_POSITIVE or DUPLICATE_CONTEXT only |

The list accepts only `severity`, `ruleCode`, `limit` and `offset`. Pagination
defaults to limit 25, offset 0; limits are 1–100 and offsets 0–1,000,000. HTTP
pagination values must be canonical unsigned decimal integers. Ordering remains
`detectedAt DESC, id ASC`. The response is `{ data: [...], pagination: { limit,
offset } }`; detail and successful actions return `{ data: ... }`.

Summary DTOs explicitly contain assessment `id`, `ruleCode`, `ruleVersion`,
`entityType`, `severity`, `status`, `resolutionPolicy`, `detectedAt`,
`lastEvaluatedAt`, nullable `acknowledgedAt`/`resolvedAt`/`dismissedAt`,
`resolutionReasonCode` and `revision`. Dates are ISO strings. Lists have **no
evidence field**, including no null or unavailable placeholder. Neither list nor
detail exposes entityId, orderId, assignmentId, riderId, pharmacyId, occurrence
keys or actor IDs. Operational navigation/linkage is deferred until a concrete
admin workflow requires it. No customer/rider DTO changes or clinical/ML outputs
are introduced.

### Strict operational reads versus admin observability reads

Existing `toRecord`, `getById`, `listOpen` and other internal reads still validate
evidence strictly. Detection validation, evidence schemas, identity and lifecycle
semantics are unchanged. This correction is not an evidence-schema relaxation.

The separate repository/service methods `getAdminById` and `listAdminOpen` return
validated `AdminOperationalRiskMetadata` and `AdminOperationalRiskRecord`.
The list uses a metadata-only database select, requiring no evidence validation.
Thus otherwise valid queued records with malformed evidence or unknown historical
rules remain visible. Neither admin read writes, repairs or suppresses records.

Detail adds an `AdminOperationalRiskEvidenceResult`: valid registered evidence is
`{ status: "available", evidence: ... }`, rebuilt with each rule's explicit field
allowlist from the evidence table above. Known-rule malformed evidence (including
unsupported schema versions) becomes `{ status: "unavailable", reason:
"invalid_evidence" }`. Unknown historical rule codes become the same unavailable
shape with `reason: "unknown_rule"`. Both return HTTP 200 with safe metadata;
raw stored JSON is never a fallback. Unknown rules remain invalid for new
detections and are not registered. Invalid core metadata still fails with a
sanitized 500, rather than being mislabeled as evidence corruption.

Lifecycle endpoints use the existing **strict** read and lifecycle service, never
the tolerant projection. A corrupt record may be observable but cannot bypass
strict mutation validation. Actor identity comes only from authenticated ADMIN
context. Caller actor IDs, revisions, extra fields and manual CONDITION_CLEARED
are rejected. The controller reads the current revision and supplies it to the
existing status/revision compare-and-set action. Concurrent terminal actions
cannot overwrite the winner; same-target retries retain the original actor/time.
This protects server-side races; it does not implement client revision preconditions.

Malformed requests receive 400, unknown assessments 404, disallowed transitions
or lost conflicting races 409, and unexpected persistence/parser failures a fixed
500 response. Raw exceptions are sanitized before error middleware can log them.
There are no creation, deletion, detection, re-evaluation or auto-resolution routes.

`risk-admin-read.test.ts` verifies strict-read preservation, redaction, core
metadata validation and zero read-side writes. `risk-api.test.ts` covers every
role/route, pagination, explicit DTOs, all three evidence schemas, forbidden-value
sentinels, lifecycle idempotency, competing HTTP actions and sanitized failures.
Tests use injected stores, not a live database. The Phase 13A migration remains
the deployment prerequisite for both hooks and APIs; no migration was applied.

## Phase 13E: bounded reconciliation

`createRiskReconciler(source, riskService)` returns an internal async operation.
It recovers missed hook writes and stale detections that had no tracking reader.
It also recovers missed fresh-location resolution and clears stale assessments
whose assignment is terminal. It does not change domain data, rules, evidence,
identity, lifecycle, hooks or ADMIN API contracts. All writes go through the
existing risk service; source delegates have only read methods.

There is no scheduler, CLI, HTTP endpoint, timer or startup work. A future
deployment caller must explicitly construct the reader with the existing
client's `deliveryAssignment`, `deliveryEvent` and `operationalRiskAssessment`
delegates, inject the existing risk service, and invoke all four lanes. Module
imports and factory construction perform no I/O. The Phase 13A migration must
already be deployed; 13E adds no schema or migration.

### Inputs, bounds and continuation

Each invocation requires `lane` (`timeouts`, `failures`, `locations`, `recovery`),
`evaluatedAt: Date`, and finite nonnegative `freshnessThresholdMs`. The caller
must supply `loadLocationConfig().freshnessThresholdMs` (or an explicit test
value), never ETA/dispatch timezone configuration. Core logic reads neither
environment nor wall clock. This is evaluation of currently persisted facts at
an explicit cutoff, not historical state reconstruction. Location assignment
state updated after that cutoff is unavailable.

`batchSize` defaults to 25, with hard bounds 1–100. A source query returns at most
batchSize + 1 rows, including one lookahead; only batchSize candidates are
processed. Recovery adds at most one strict assessment read, one assignment
point read and one lifecycle service call per candidate. There is no full-history
pre-query or loop that drains a database. The existing lifecycle service performs
its own fixed-count reads/CAS. Bounded returned rows do not claim bounded physical
database I/O or a measured query plan.

Continuation is `{ at: <canonical ISO timestamp>, consumedAtTime: <integer> }`.
It contains no application IDs. Scans order by immutable assignedAt (assignments),
occurredAt (events), or detectedAt (assessments), then ID internally. Each next
query seeks to `timestamp >= at` and skips only the already consumed timestamp
ties. The tie count resets when the timestamp advances. This combines a time
keyset with a bounded tie offset, avoiding a UUID cursor in operational telemetry.
The tie offset is capped at 1,000,000. If exhausted, `more` stays true,
`continuationLimitReached` is true and continuation is null; the caller must
surface incomplete coverage rather than claim completion or skip remaining ties.

Pass continuation back with the same lane, evaluation time and threshold. A
normal null continuation with `more: false` completes that pass. An empty page
terminates immediately. Recovery scans all lifecycle statuses within the stale
rule/entity scope so its own resolutions never shrink the page population.
Terminal records are then skipped by the strict lifecycle eligibility checks.

Pages are deterministic for a fixed dataset, not a database snapshot. Concurrent
insertions, deletions or assignment-state changes can shift a timestamp tie or
place work behind a cursor. Start subsequent passes from the beginning with a
new explicit evaluation time. A pass is not an exactly-once delivery guarantee.
Retrying a page after failure is safe. Candidates with failures/unavailable facts
are counted and do not pin the cursor; later full passes retry them.

### Authoritative facts and decisions

Timeout candidates are persisted TIMED_OUT assignments. Stored assignedAt,
offerExpiresAt and timedOutAt go to the existing timeout evaluator. Legacy null
deadlines retain their original semantics; overdue OFFERED rows are never expired
by reconciliation and no deadline is reconstructed from current configuration.

Failure candidates are durable FAILED_DELIVERY events with their linked
assignment. `failDelivery` already persists `requiresManualReview` and
`orderStatusAtFailure` in `DeliveryEvent.metadata` in the domain transaction.
Only these two structured fields are extracted; note is not selected. The reader
verifies assignment/order linkage and supplies the persisted assignment status,
event ID/type/time and historical metadata to the existing evaluator. Missing,
legacy or malformed metadata is unavailable, never inferred from notes or current
order state. Explicit manual-review false remains not matched. Current non-FAILED
assignments do not satisfy the existing evaluator; historical state is not guessed.

Location detection selects only ACCEPTED, PICKED_UP and OUT_FOR_DELIVERY
assignments and the rider's persisted lastLocationAt, without coordinates or
contact information. The existing evaluator owns exact freshness boundaries,
including threshold zero, missing location and future timestamps. The existing
assignment-plus-location-anchor occurrence key is preserved, so hook and
reconciliation discoveries converge.

### Fresh recovery, terminal cleanup and races

Recovery scans only stale-location assignment assessments, then reads each
candidate through the unchanged strict service. Unknown/malformed evidence is
not tolerated for mutation. Applicable rows must have rule/schema version 1,
AUTO_RESOLVABLE policy, OPEN/ACKNOWLEDGED status and exact assignment/order scope.
Stored evidence is validated and reevaluated with the original pure evaluator
to verify its occurrence identity. Original evidence observation, detectedAt and
lastEvaluatedAt must not exceed the explicit recovery evaluation time.

Active assignments require a valid currently fresh location and an anchor
strictly newer than the stale episode, preserving the Phase 13C safeguards.
Missing, future, still-stale or equal-anchor locations cannot establish fresh
recovery. OFFERED or unknown assignment states do not establish cleanup.

DELIVERED, FAILED, TIMED_OUT, DECLINED, CANCELLED and REASSIGNED establish that
location freshness is no longer actionable for that assignment. These states may
clear eligible stale episodes without requiring location freshness. Assignment
timestamps must be valid and its updatedAt cannot exceed the evaluation cutoff;
updatedAt is a state-observation guard, not a fabricated terminal-event timestamp.

Both paths call existing `resolveAssessment` with the observed revision, null
actor, CONDITION_CLEARED and the explicit evaluation time. They never delete,
dismiss, rewrite evidence or change historical detection/evaluation times.
Resolved/dismissed records stay unchanged. Timeout and delivery-failure records
are never auto-closed. CAS conflicts are not retried by adopting a newer revision;
concurrent ADMIN actions preserve their winning actor/reason/time. Detection
racing a terminal domain transition may insert an old observation; a subsequent
recovery pass closes it. Reconciliation does not lock domain transactions.

### Results, isolation and verification

Results contain only `scanned`, `matched`, `recorded`, `resolved`, `idempotent`,
`unavailable`, `skipped`, `failures`, `continuation`, `more` and
`continuationLimitReached`. `recorded` counts successful idempotent create-or-get
calls, including existing assessments. The existing service does not report
insert provenance, so 13E does not invent separate newly-created/duplicate counts.
`idempotent` counts lifecycle calls that return that outcome. `skipped` includes
nonmatches, ineligible/terminal records, missing assessments and lifecycle conflicts.

Candidate evaluator unavailability is distinct from per-candidate persistence,
strict-read, point-read or resolution failure. Each is counted without aborting
unrelated work. Initial page-query/ordering-contract failure throws a sanitized
`RiskReconciliationError(SOURCE_UNAVAILABLE)`; invalid options fail before reads.
No raw exception/cause, evidence, identifiers, notes, coordinates, clinical data
or contact information is returned or logged. No observer is installed.

`risk-reconciliation.test.ts` uses injected read delegates and the existing atomic
risk test store. It covers bounds, time/tie continuation, durable metadata,
hook ordering, duplicate races, freshness/zero boundaries, all terminal states,
strict corruption isolation, competing ADMIN actions, late domain transitions,
privacy and input immutability. Tests make no claim about live PostgreSQL query
plans/isolation. Production scheduling cadence, persistent run checkpoints,
operational retry policy, additional rules and escalation remain deferred.
