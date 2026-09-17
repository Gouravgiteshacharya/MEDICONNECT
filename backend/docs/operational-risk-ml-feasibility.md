# Operational-risk ML feasibility — Phase 14A

Audit baseline: `5abd178 feat: add operational risk detection and reconciliation`.
This is a feasibility/design record only. It enables no ML behavior, dataset
export, training, instrumentation, scheduler or operational decision policy.
No database was accessed; row counts, prevalence and deployment readiness are unknown.

## Decision

**CONDITIONAL GO**, for at most one question: at committed delivery-assignment
acceptance, forecast whether a structured FAILED_DELIVERY event requiring manual
review will be recorded for that assignment within the next 60 minutes.

This is a forecast of a recorded operational event, not physical failure truth,
rider reliability, customer behavior, blame or medical urgency. Its only proposed
human use is aggregate operations-capacity review. No individual score, ranked
assignment queue, customer/rider profile or enforcement use is recommended.

Do not start Phase 14B dataset work until the data prerequisites below are
demonstrated and an operations owner confirms that the aggregate forecast would
support a useful, human-reviewed capacity decision. A repository audit cannot
demonstrate sufficient REAL data or incremental predictive value. If these gates
fail, retain deterministic Milestone 13 and record NO-GO. This is not permission
to add missing instrumentation, change schema or perform REAL extraction.

## Preflight and evidence reviewed

Repository: MEDICONNECT. Branch: `feature/intelligence-experience`. Initial
`git status --short --branch` contained only:

```text
## feature/intelligence-experience...origin/feature/intelligence-experience
```

`git log -5 --oneline`:

```text
5abd178 feat: add operational risk detection and reconciliation
ae20a1e feat: add rider suitability ML and shadow scoring
180a2a8 feat: add ML ETA training and shadow inference
58976c7 feat: add ETA baseline and dataset pipeline
6bce07e feat: add assistant voice dictation
```

Primary evidence: all risk modules and rule implementations; operational-risk
documentation; Prisma models and the additive 13A migration; assignment acceptance
and timeout writers; delivery lifecycle/event writers; location sampling and
freshness; tracking and rider authorization; dispatch ranking/snapshots; existing
ETA/dispatch dataset, feature, training, artifact, loader and shadow implementations.
Relevant risk, lifecycle, assignment, location, dataset, runtime, parity and
training test sources were inspected. No test suite was run for this document.
Test-source evidence is not a claim about production data or observed accuracy.

## Current boundaries

| Boundary | Current implementation and implication |
| --- | --- |
| Deterministic detection | `src/risk/rules/` and `risk.rules.ts`: recorded timeout, structured manual-review failure and active-assignment stale location. Explicit facts/time; matched, not_matched or unavailable. No ML scoring. |
| Persistence | `risk.evidence.ts`, `risk.repository.ts`, `risk.service.ts`: strict evidence, occurrence uniqueness, original snapshot preservation and revision/status CAS. A duplicate detection does not reopen a terminal record. |
| Hooks | `risk.hooks.ts`: post-commit timeout/failure callbacks, tracking observation, fresh-location recovery. Secondary failures cannot reverse domain transactions; process interruption can lose callbacks. |
| Reconciliation | `risk.reconciliation*.ts`: bounded authoritative scans, existing evaluators/service, explicit evaluation time, fresh/terminal stale cleanup only. No scheduler. Detection time can be much later than source-event time. |
| Human ADMIN actions | `risk.routes.ts`, `risk.controller.ts`: authenticated ADMIN acknowledgement, OPERATOR_RESOLVED resolution, two dismissal reasons. Safe evidence projections; tolerant observability never weakens strict mutations. |
| Existing ML | ETA ridge and dispatch acceptance logistic pipelines have separate optional shadow runtimes. A separate legacy `LogisticsModel` completion-minute interface can influence dispatch when supplied; it is not the acceptance shadow model and is not a suitable risk integration pattern. |

The legacy Prisma `RiskAssessment` has riskScore/modelVersion and person links.
It is separate from Milestone 13's `OperationalRiskAssessment`. Its existence is
not authorization to reuse person scoring. The 13A migration adds the operational
table/enums/indexes/FKs without ML columns or legacy-model changes.

The three deterministic rules already solve **current detection**. ML must not
approximate those predicates, alter severity/policy, create or close assessments,
change occurrence identity, or replace reconciliation.

## Existing ML patterns: reuse decisions

| Pattern and code evidence | Relevance to a future risk experiment |
| --- | --- |
| Versioned exact dataset rows/manifests: `src/ml/dataset/`, `src/ml/dispatch-dataset/` | Reuse the discipline, not either existing label/schema. Add no exporter in 14A. |
| Temporal splits and grouped offer chains: `dispatch-dataset.extractor.ts` | Reuse order-group isolation and chronological windows; add horizon maturity and purging at each boundary. Never random-split repeated assignments. |
| ETA successful-delivery cohort: `eta-dataset.extractor.ts` | Do not reuse its cohort for failure prediction: selecting successful deliveries removes the positive class. Its global cutoff check is not sufficient by itself for historical per-split maturity. |
| Explicit seeded synthetic generators: `ml/*/synthetic.py` | Useful only for contract, edge-case and determinism tests. Simulated failure prevalence is not REAL evidence or a deployment justification. |
| REAL/SYNTHETIC/MIXED manifests and artifact metadata | Reuse explicit provenance and separate metrics. Markers/checksums do not authenticate source truth. Never relabel synthetic fixtures as quality evidence. |
| Strict features: `eta-features.ts`, `dispatch-features.ts`, Python `features.py`, feature-contract JSON | Reuse exact keys, units, finite checks and ordered encodings. Do not import distance/workload/item features merely because existing models use them. |
| TypeScript/Python fixtures | Reuse parity for timestamps, encoding, inference and metrics if two runtimes are eventually needed. No need to add a second runtime during feasibility. |
| TRAIN-only scaling and validation-only selection: `ml/eta/train.py`, `ml/dispatch/train.py` | Reuse untouched TEST and NO_MODEL_SELECTED behavior. Do not inherit hyperparameters, a ten-feature vector or the dispatch Brier tolerance without a risk-specific protocol. |
| Portable JSON and exact artifact validation: `*-model.types.ts`, Python `model_io.py` | Reuse non-executable artifacts, schema/version checks, finite coefficients and positive scales. Bind the prediction point, horizon and time convention explicitly in a future contract. |
| Local explicit model paths: `*-model.loader.ts` | Useful later; no discovery, URL fetch or request-time loading. Existing size caps are checked after reading, not streaming memory bounds. |
| SHA-256 | Both current loaders verify an expected exact-content checksum when supplied. Both production shadow factories require it. Older ETA README phase prose predates this implementation; code/tests are authoritative. |
| Production provenance gates | Reuse REAL-only production, explicit synthetic override only outside production, and rejection of MIXED. These are necessary controls, not model approval. |
| Disabled-by-default startup injection | Reuse independent risk configuration and safe unavailability if a future experiment is approved. Do not borrow ETA or dispatch enable flags/timezones. |
| Post-commit observations and isolated observers | Reuse failure isolation and no-op defaults; account for lost observations. ETA emits a prediction; dispatch emits rank/count summaries without individual probabilities. Neither automatically provides delayed outcome evaluation for risk. |
| Privacy projections | Reuse explicit allowlists and aggregate reporting. Dataset-local grouping keys may support split integrity; never identity hashes or persistent person keys as features. |
| Fallback separation | A risk predictor should return unavailable, not a fabricated zero probability. Deterministic rules continue independently in every case; they are not fallback probability forecasts. |

## Candidate questions considered

All horizons below are design probes, not production thresholds. Class imbalance,
volume and drift are hypotheses to investigate, never measured repository facts.

| Candidate | Point, grain, horizon and exact proposed target | Prediction-time feature sources | Assessment |
| --- | --- | --- | --- |
| Any operational attention | Acceptance; assignment; 60 minutes; any new operational assessment | Assignment timestamps; potentially order distance and dispatch snapshot | Reject. Composite mixes post-offer timeout, sampling-driven staleness and recorded failure. Assessment existence/time depends on reads, missed hooks and reconciliation. No clean common event label or justified common action. |
| Offer timeout | Offer creation; offered assignment; stored deadline; durable TIMED_OUT recorded by a stated maturity cutoff | assignedAt, offerExpiresAt; linked DispatchAttempt distance/workload/rank at attemptedAt | Reject for M14. Current overdue-state detection is deterministic; predicting pre-deadline acceptance/nonacceptance substantially overlaps M12. Processing-time timeout labels vary with offer-read traffic, and useful automated reoffers/selection are prohibited here. |
| Stale location soon | Acceptance; active assignment; 5 minutes; first instant age exceeds the then-authoritative freshness threshold while active | Would need lastLocationAt at acceptance, every subsequent refresh and historical threshold/state | Reject; stop this candidate. Current lastLocationAt is overwritten and LocationUpdate is sampled, with optional assignment linkage. Full refresh history and effective location configuration are not persisted. Risk evidence records selected stale observations, not negative surveillance. Do not interpolate missing updates or infer inactivity. |
| Open-assessment priority | First OPEN occurrence; assessment; 30 minutes; ADMIN acknowledgement or later resolution | Creation-time rule/severity/policy and validated evidence | Reject; stop this candidate. ADMIN actions measure queue exposure, staffing and review policy, not independent need. Dismissal is not proof of false detection, nor acknowledgement proof of true urgency. This would train subjective review behavior and could influence the protected lifecycle. |
| Recorded delivery failure | Committed acceptance; assignment; 60 minutes; eligible FAILED_DELIVERY event in the future interval | Only immediate offer/acceptance timing and coarse calendar features proposed below | Sole conditional candidate. Objective record existence is observable without parsing reasons. Potential lead time beyond post-event deterministic detection; value unproven. Restrict human use to aggregate capacity review. |

Additional candidate-specific concerns:

| Candidate | Contamination/proxies, baseline, legitimate action and failure modes |
| --- | --- |
| Any attention | ADMIN terminal status would contaminate a "needs attention" label; identity and location could turn it into reputation scoring. Different rule prevalence and deployment cadence cause drift; no amount of rows repairs the mixed target. Existing rules/reconciliation are the baseline and current legitimate action. No ML action recommended. |
| Timeout | Current outcomes are future features at offer creation. Rank/workload encode selection policy; latency can proxy device/network access or rider working conditions. Event-rate/deadline and M12 acceptance baselines would be required. Advisory staffing is possible but redundant; acceptance frequency and timeout-processing delays are unknown. Would require mature offered-only positives/negatives across stable policy epochs, not all unoffered candidates as negatives. |
| Staleness | Device/network access, battery and neighborhood connectivity are strong fairness risks; staleness is not negligence. Class frequency depends on sampling/configuration. A deterministic freshness timer already detects current staleness. Historical negatives cannot be reconstructed safely, regardless of sample size; no predictive action proposed. |
| ADMIN priority | Reviewer staffing and differential attention create policy bias; sparse urgent actions may be imbalanced. Rule/severity/age is the transparent baseline. No objective supervised priority label or permissible model-led lifecycle action identified; additional subjective labels do not solve this. |
| Recorded failure | Possibly rare, with prevalence unknown; reporting practice, operational policy, season and staffing can drift. Acceptance timing may proxy network/shift constraints. Aggregate capacity review only; no individual ranking. Must beat constant and simple timing baselines on mature REAL data, with documented exclusions and false-positive burden. |

No rider/customer history, "reliability", fraud, intent or clinical candidate is
recommended. Such formulations violate the product boundary rather than merely
needing a better model.

## Sole conditional candidate: proposed point and label

Prediction point: after the successful acceptance transaction commits. Define
the reproducible reference instant `t = DeliveryAssignment.acceptedAt`, supported
by its matching RIDER_ACCEPTED event. `assignment.service.ts` writes both in the
same transaction, along with status/order changes. The clock is captured before
transaction execution; it is **not** a persisted database commit timestamp.
That limitation must be explicit in retrospective lead-time claims. A future
live observer must measure its actual invocation lag; it must not claim delivery
of a prediction at `t` if it was invoked later.

Grain: one eligible accepted delivery assignment, with same-order assignments
kept in one temporal group. Unaccepted offers are outside this population.
Proposed horizon: `H = 60 minutes`, fixed before inspecting outcomes and subject
to operations-owner review. Do not tune H on the final test period.

Proposed positive: one consistently linked FAILED_DELIVERY event whose
`occurredAt` is in `(t, t + H]`, with structured metadata
`requiresManualReview === true` and valid `orderStatusAtFailure`.
The latter is label-consistency metadata, **never a feature**. `failDelivery`
atomically changes the assignment to FAILED and writes this event/metadata;
the later risk hook is not the label source. Duplicate/conflicting failure events
or inconsistent timelines are excluded, not collapsed by arbitrary precedence.

Proposed negative: complete observation through `t + H`, no eligible failure
event in that interval, and no unresolved source inconsistency or censoring.
A consistent completed delivery before H is a competing terminal outcome, not a
reason to discard all successful deliveries. A failure after H is not a positive
for this horizon. A malformed/unknown-metadata failure within H is ambiguous,
not negative. Same-instant acceptance/failure is excluded because ordering is
not established by equal stored timestamps.

For negatives, a cutoff alone does not prove observation completeness. Restrict
any future cohort to a documented deployment period with verified event-writing,
retention and no backfill ambiguity, using a stable authorized offline snapshot.
No such period is established by this audit. Event rows have occurredAt but no
separate ingestion/commit timestamp or writer-policy version; historic late
backfills cannot be distinguished from timely records solely from the schema.
Do not claim physical failures were absent merely because none were recorded.

## Persisted feature inventory

"Safe candidate" means eligible for review at the stated point, not proof of
fairness or usefulness. Raw IDs may be used only inside controlled linkage and
split construction, never as features or public telemetry.

| Persisted source / derivation | Classification | Availability, leakage and proposed disposition |
| --- | --- | --- |
| Assignment assignedAt, acceptedAt; elapsed milliseconds | SAFE CANDIDATE | Known at accepted point; verify matching acceptance event and sane chronology. Immediate duration only, no per-rider aggregation. Proposed candidate feature, with proxy review. |
| Assignment offerExpiresAt minus assignedAt | SAFE CANDIDATE | Stored deadline snapshot, not current timeout config. Exclude null/invalid legacy values rather than reconstruct. Proposed feature; constant values provide no signal. |
| Hour/day from acceptedAt | SAFE CANDIDATE | Coarse UTC hour/day with explicit convention; raw timestamp kept for joins/splits only. Proposed calendar features; shift/socioeconomic proxies remain possible. |
| Order.fulfillmentMethod | SAFE CANDIDATE | DELIVERY eligibility filter; constant within cohort, not a useful predictor. |
| Assignment/order lifecycle state | QUESTIONABLE / REQUIRES REVIEW | Current status is not historical state. At accepted point only the committed ACCEPTED/RIDER_ASSIGNED facts are known and constant. Do not feed eventual status. |
| Order.deliveryDistanceKm / linked quote distance | QUESTIONABLE / REQUIRES REVIEW | Checkout snapshot can precede acceptance, but geography/area and service coverage proxies remain. Exclude from initial candidate pending separate review; never recompute from current coordinates. |
| OrderItem line count | QUESTIONABLE / REQUIRES REVIEW | Existing ETA uses line count, not quantity. Can proxy treatment burden/medical condition. Exclude from risk candidate; never inspect item names or prescriptions. |
| DispatchAttempt.deterministicRank | QUESTIONABLE / REQUIRES REVIEW | Snapshot exists for instrumented dispatch, not every manual/batched offer. Encodes selection policy and geography/workload. Exclude from initial candidate. |
| DispatchAttempt.workloadSignal | QUESTIONABLE / REQUIRES REVIEW | Dispatch-time snapshot, not workload at acceptance. Device/work allocation and rider-performance proxy risk; exclude, never relabel it as current workload. |
| DispatchAttempt.riderDistanceToPharmacyKm | QUESTIONABLE / REQUIRES REVIEW | Earlier dispatch fact with location/selection proxies. Exclude from initial candidate. |
| DispatchAttempt policy/rank/config fields | QUESTIONABLE / REQUIRES REVIEW | workloadPenaltyKm, shortlistSize, searchRadiusKm and freshnessThresholdMs are dispatch snapshots; use only cohort audit if separately needed, not risk features. Not a historical tracking-threshold source. |
| DeliveryPartner.lastLocationAt | QUESTIONABLE / REQUIRES REVIEW | Latest mutable timestamp cannot reconstruct an old acceptance snapshot. Excluded. |
| LocationUpdate.recordedAt | QUESTIONABLE / REQUIRES REVIEW | Sampled history is incomplete; assignmentId optional. Excluded for prediction-time freshness or negative stale labels. |
| DeliveryEvent history at/before t | QUESTIONABLE / REQUIRES REVIEW | Need verified linkage, ordering and writer coverage. No count of future events; no note/metadata blobs as features. Initial candidate uses only acceptance consistency, not event-history features. |
| Current location sampling/freshness config | QUESTIONABLE / REQUIRES REVIEW | Environment values are not persisted historical configuration. Not features; do not backfill snapshots. |
| acceptedAt/declinedAt/timedOutAt for an offer-time model | PROHIBITED AT THAT POINT | Outcomes are future information. acceptedAt is allowed only as the chosen acceptance-point anchor, not as a pre-offer feature. |
| Future FAILED_DELIVERY or orderStatusAtFailure | PROHIBITED AS FEATURES | Label-side facts only after t; direct leakage. |
| Final status, deliveredAt, completedAt, future locations | PROHIBITED AS FEATURES | Outcome/censoring validation only; never prediction inputs. |
| Risk status, ADMIN actors/actions/timestamps/reasons | PROHIBITED AS FEATURES/LABELS | Review-policy contamination and post-prediction leakage. |
| Legacy RiskAssessment.riskScore, Rider.rating, model scores | PROHIBITED FOR THIS CANDIDATE | Reputation/feedback and cross-model contamination; no rider-suitability input/output coupling. |
| Person/pharmacy IDs, names/contact/address, exact coordinates | PROHIBITED AS FEATURES | Identity, location and sensitive proxies; no hashing workaround. |
| Prescriptions, medicine contents, diagnosis, failure notes, support free text | PROHIBITED | Clinical/sensitive/subjective data; never parsed, embedded or inferred. |

No permanent rider/customer performance aggregates are proposed. Proposed initial
inputs are only acceptance latency, stored offer duration, UTC hour and weekday.
Even these require ablation/proxy review; if useful performance requires identity,
geography or medical proxies, the candidate becomes NO-GO rather than expanding.

## Labels, leakage and interventions

OperationalRiskAssessment is unsuitable as ground truth for the future event:
detectedAt/evaluatedAt measure observation/reconciliation, not necessarily onset;
stale sourceOccurredAt is null; missing assessment does not mean absence of an
event. Timeout timedOutAt is processing time. An assessment's severity/policy
are deterministic metadata, not independently measured urgency.

ADMIN acknowledgement/resolution/dismissal must not label need, correctness or
successful intervention. Automatic CONDITION_CLEARED and manual OPERATOR_RESOLVED
also have different meanings. Reconciliation can change observability long after
the event without changing the event's occurredAt, so label reconstruction must
use durable delivery events directly.

Known assignment cancelledAt/reassignedAt and Order.cancelledAt inside the
horizon create censoring or competing policy outcomes. For a conservative initial
contract, exclude intervention-affected windows rather than assign negatives;
report their counts and resulting selection bias. Missing timestamps with a
terminal intervention status, contradictory events, deleted/null linkage,
unfinished observation or failed writer coverage are exclusions. Do not infer
absence of an intervention from a null field alone. The schema does not provide
a comprehensive immutable administrative-intervention ledger.

This exclusion defines a selected observational cohort; it does not estimate
"failure if nobody intervened" or a causal effect. If unknown interventions
prevent a defensible cohort, stop dataset work and return for separate review;
do not silently add instrumentation. Deployment or failure-reporting-policy
changes require separate epochs or renewed label validation, not pooled labels.

## Baselines, value and evidence gates

Milestone 13 remains the event detector. Its after-event predicate cannot be
treated as a pre-event probability baseline. Compare forecasts against TRAIN-only
constant event prevalence, a prespecified coarse hour/weekday rate table, and a
simple offer-duration/acceptance-latency-bin heuristic. Fit bin rates/smoothing on
TRAIN only; freeze fallback rates for sparse/unseen cells. If these transparent
baselines suffice, do not build ML.

Proposed evaluation: log loss, Brier, reliability/calibration tables, PR-AUC with
explicit convention, and event prevalence on identical cohorts. Add analytic-only
precision/recall and false-positive burden across a preregistered threshold grid;
none becomes a production decision threshold. Measure lead time against source
event time, separately from delayed deterministic assessment creation. Retrospective
lead time is potential lead time, not proof a live prediction was delivered.

For aggregate capacity use, compare forecast event totals and observed totals for
the same acceptance cohorts/time bins. Do not casually reinterpret overlapping
assignment horizons as a calendar-hour arrivals forecast. Correlated assignments
require order/day-block uncertainty estimates rather than independent-row claims.

Proceed beyond contracts only with a locked REAL test period showing improvement
over the best prespecified baseline in log loss and Brier, acceptable calibration,
stable results across time blocks, and useful lead time without excessive analytical
false-positive burden. Set the minimum practically useful improvement with the
operations owner before model selection. No benefit size is asserted here.
Synthetic accuracy, training fit or beating a deliberately weak constant alone
does not meet this gate. If uncertainty spans no useful improvement, select no model.

## REAL-data readiness: prerequisites before Phase 14B work

1. Establish the actual deployment cutover and stable writer/policy epoch. Git
   commit date is not evidence of deployment or data coverage. Verify that
   acceptance events/timestamps, structured failures, linkage, deadlines and
   interventions are populated by the expected writers, with no undocumented
   backfill/deletion path. This audit does not authorize a database query.
2. Review a separately authorized aggregate quality/readiness assessment from a
   stable offline snapshot. Demonstrate eligible counts, positives/negatives,
   missing metadata/linkage, censoring and coverage by period, without exposing
   people or generating training data here. Required counts are currently unknown.
3. Establish an observation completeness and retention policy through each
   outcome horizon; determine an explicit ingestion/operational grace period.
   No trustworthy event-ingestion watermark is demonstrated in this repository.
   If assurance cannot be established without new durable fields, stop for a
   separately authorized instrumentation design; no schema change is assumed.
4. Freeze horizon, cohort, interval boundaries, exclusion precedence, UTC
   convention and group-level chronological split rules. Ensure TRAIN labels are
   mature before validation starts and validation labels before TEST starts;
   purge boundary rows by at least H plus the agreed grace period. Require TEST
   outcome cutoff beyond all included horizons. Keep all same-order assignments
   in one split or exclude crossing groups.
5. Proposed planning floor: 12 consecutive weeks in a stable epoch, preserving
   multiple weekly cycles across train/validation/test. This is an audit proposal,
   not a statistical guarantee or statement about existing data. Extend observation
   if outcomes are sparse or drift/coverage is unstable. Define event-count needs
   by precision/power for the predeclared metric improvement, with both classes
   and enough events in each evaluation period/calibration slice. With unknown
   prevalence p, obtaining E observed positives requires roughly E/p eligible
   rows before exclusions; neither p nor E is claimed to be measured here.
6. Confirm aggregate advisory capacity review has an owner and measurable use.
   Review proxy/ablation results before approving any feature. No individually
   actionable scores or rankings may be introduced under this conditional decision.

Existing instrumentation supports the proposed timing features and structured
failure positives in compliant rows. Missing historical location snapshots,
complete update history, configuration epochs and event ingestion/administrative
coverage are limitations, not permission to manufacture data. No unconditional
prediction-time feature snapshot or schema expansion is required for the narrow
timing-only candidate; retrospective cohort admissibility remains conditional.

## Shadow architecture and output retention

If the gates pass in a future phase: authoritative acceptance snapshot -> strict
feature adapter -> optional independent predictor -> shadow observation -> delayed
outcome join -> aggregate evaluation. Disabled/unavailable models leave all domain
behavior unchanged. No writes to operational assessments, severity, policy,
occurrence keys, lifecycle, dispatch, assignment, order state, prices, priorities,
customer/rider responses or existing ML inputs. No model-directed cancellation,
suspension, blocking or resolution. No clinical inference or fraud/blame labels.

Prefer aggregate retained metrics only; no durable per-person or per-assignment
score table and no reuse of legacy RiskAssessment. Individual probability-label
pairing is still needed transiently to compute Brier/log loss. A separately reviewed
short-lived evaluator could hold internal assignment linkage until horizon/grace
maturity, then emit aggregates and discard linkage/probability. Process loss must
be counted as evaluation loss, never turned into negative outcomes. Aggregate
predictions alone cannot reconstruct individual calibration later. A durable
outcome-join design, if necessary, requires separate privacy/retention approval;
none is implemented or authorized by this record.

## Privacy, fairness and clinical boundary

No identity/history features or persistent person grouping. Timing can still proxy
shift schedules, connectivity, work allocation and socioeconomic constraints;
distance can proxy neighborhood; pharmacy identifiers/rank can proxy service
coverage; item counts can proxy disability or medical needs. Therefore the latter
feature groups are excluded initially and timing needs ablation and drift review.
The absence of protected attributes does not prove fairness, and this audit does
not authorize collecting them. Small-cell aggregate suppression and minimum
reporting cohort sizes need explicit design before telemetry deployment.

A per-assignment failure score presented alongside rider identity could become a
de facto reputation system even without historical aggregates. That use is
rejected. The conditional candidate survives only as aggregate advisory research,
with no per-person display, tracking, ranking or adverse action. If operational
value requires those uses, the recommendation becomes NO-GO.

No diagnosis, medicine safety, prescription validity, medical urgency, treatment
or clinical outcome is predicted. Failure-event recording cannot establish rider
fault, customer trustworthiness or incident cause; free-text reasons remain excluded.

## Proposed next scope and verification

After the prerequisites are met and separately authorized, Phase 14B may define
only this candidate's dataset/feature/label contracts, exclusions, maturity,
temporal grouping, aggregate readiness metrics and synthetic contract fixtures.
No model, training, REAL export, schema change, runtime integration or API expansion
is implied. If prerequisites fail, stop rather than substituting subjective labels,
future/current-state features, new rules or new instrumentation.

Phase 14A changes exactly this documentation file. No tracked production, Prisma,
migration, frontend, ML implementation, package or configuration file is changed.
No dependencies installed; no dataset generated; no live database accessed;
no migration or Prisma generation run. Full suites were intentionally not rerun
because there is no code change. Whitespace and final Git scope are verified
separately. Nothing staged, committed or pushed.

## Phase 14A.1 — readiness gate

**Current readiness decision: NOT READY FOR 14B.** This gate supersedes the
earlier conditional recommendation to proceed, while preserving the Phase 14A
analysis above as the historical feasibility record. The prediction question and
four proposed features are unchanged. Dataset implementation and contract
recommendation stop here: repository evidence cannot establish complete negative
outcome observation or complete intervention history. More rows alone cannot
resolve that semantic gap.

### Preflight and scope

MEDICONNECT, branch `feature/intelligence-experience`, HEAD `5abd178` verified.
Initial status was exactly the branch line plus
`?? backend/docs/operational-risk-ml-feasibility.md`. The three latest commits
were `5abd178`, `ae20a1e`, `180a2a8`, with the titles recorded above.
Only this existing untracked document is updated. Searches covered production
assignment/event/order writers, lifecycle routes, manual/automated offers,
batching, pharmacy workflow, support and risk actions; schema/migrations and
historical writer implementations were inspected. No database, data generation,
dependency installation or code execution against application infrastructure.

### Failure write path and coverage matrix

The sole discovered production assignment transition to FAILED is
`failDelivery` in `src/delivery-lifecycle/lifecycle.service.ts`, reached through
the DELIVERY_PARTNER-only `/:assignmentId/fail` route. Context verifies an active
rider/user, ownership of the assignment and DELIVERY fulfillment. It permits
ACCEPTED/PICKED_UP/OUT_FOR_DELIVERY, conditionally updates the observed assignment
state, performs applicable batch/rider updates, then creates FAILED_DELIVERY in
the same Serializable transaction. The failure event's assignmentId is the
validated route ID matched by the owned-assignment query; orderId is read from
that assignment, not supplied by the caller. The optional risk hook runs later.

| Transition/path | FAILED_DELIVERY guaranteed? | Linkage / manual-review fact | Time and retry behavior |
| --- | --- | --- | --- |
| Successful normal `failDelivery` commit from any of its three active states | Yes for this committed transition | Owned assignment ID and its order ID; literal metadata `requiresManualReview: true`, plus then-current order status | `options.now()` captured before transaction/retries; not commit time. Status CAS and Serializable transaction prevent two normal successful failure transitions. |
| Retry when assignment already FAILED | No new event and no repair | Existing event/metadata are not checked; response says manualReview=true regardless | Returns existing FAILED response. Missing legacy event remains missing. |
| P2034 retry / event-write or rider-release failure | No committed transition without its event through this transaction | Same atomic writes; rollback removes attempted event | Up to three serialization attempts using the invocation's captured time; committed retry is not a new episode. Unknown response outcome retried after success sees FAILED. |
| OFFERED expiry during list/accept/decline; explicit decline | No, by design | TIMED_OUT/DECLINED assignments, not accepted delivery failures | Recorded timedOutAt/declinedAt; OFFERED guard. Not positives and not evidence of observed post-acceptance negatives. |
| Normal DELIVER action | No, by design; creates DELIVERED | Assignment deliveredAt, order completedAt and DELIVERED event atomically written | Same server-time convention, state CAS and retry discipline. Terminal success evidence, not an observation watermark. |
| Pharmacy prescription rejection / order rejection | No, by design | Different order states, restricted to pre-acceptance workflow states | No FAILED order enum. Rejection is not a delivery-failure substitute. |
| Batch/stop cancellation after failed delivery or expired offer | Only the parent successful `failDelivery` path guarantees a failure event | Batch/stop CANCELLED is not assignment CANCELLED | Do not label every cancelled stop as a separate failure. |
| Operational-risk hooks, reconciliation, ADMIN actions, support | No domain failure transition found | Risk-only or support-only mutations | Cannot supply missing source events or certify source coverage. |
| Imports, historical direct writes, external administration, unreported real-world failure | Not demonstrable from repository | Schema permits missing metadata/linkage and lacks event-level uniqueness/immutability enforcement | No durable completeness or ingestion record establishes coverage. Do not assume these occurred; do not assume they were impossible. |

Within the inspected current application writers, no alternate FAILED assignment
write or generic force-fail route was found. This establishes current **code-path
coverage**, not complete historical event coverage or physical incident reporting.
Requests rejected for ownership/inactive rider, transaction failures and an
incident never reported through the API do not record a failure. Their absence
cannot prove that no operational incident happened.

`DeliveryEvent.metadata` is nullable JSON, not a database-enforced boolean schema.
No production event update/delete call was found, so metadata is stable by the
current application convention, not immutable by database contract. Events have
UUID primary keys but no unique `(assignmentId, failure event)` constraint;
duplicate external/imported/reset-state events remain schema-possible. Normal
service retries do not create duplicates while the lifecycle invariant holds.
No event delete route was found, but neither schema nor checked-in migrations
establish append-only permissions/triggers. Restrictive order FK deletion does
not prohibit deletion of the event itself. Assignment/rider FKs are nullable
with SET NULL behavior, so linkage can be lost if referenced rows are deleted
where other constraints permit it. No deletion actually performed or inferred.

History confirms structured manual-review metadata was present already in
`d8df7f4`, the original lifecycle writer. It was not first introduced by risk
hooks in `5abd178`. The initial schema predates that writer and allows null JSON.
Whether actual historical events lack metadata is unknown without separately
authorized evidence; neither completeness nor absence of legacy rows is claimed.

### Acceptance point durability

`acceptAssignmentOffer` is the only discovered acceptance writer. Both manual,
dispatch and batched offers use it. It requires OFFERED, ownership and eligible
order/rider state; CAS writes ACCEPTED and acceptedAt together, with matching
RIDER_ACCEPTED and RIDER_ASSIGNED events in the same transaction. The source is
the injected `options.now()` before transaction/retry, not a persisted commit
timestamp. Repeated acceptance after success receives OFFER_NOT_ACTIONABLE;
it does not refresh acceptedAt. Failed transactions persist neither acceptance
nor its events. No later application overwrite of acceptedAt was found.

acceptedAt is therefore a stable **application reference timestamp** for verified
writer-produced episodes. It is nullable and not immutable at the schema level;
legacy/imported accepted rows can lack it. Matching event timestamp/linkage and
valid assignedAt chronology must be checked, not guessed from current status.

No assignment REASSIGNED writer or complete reassignment workflow was found.
Manual/automated/batched offer creation creates a new assignment rather than
resetting acceptedAt on an existing one; that does not prove all historical
reassignment semantics. The reassignedAt column and REASSIGNED event enum do not
guarantee those facts are written. Do not silently treat a mutated assignment as
a new episode or assume a replacement chain is completely logged.

### Exact proposed window and outcome categories

Recommend `(t, t + 60 minutes]`, where t is the verified acceptedAt reference.
This explicitly retains Phase 14A's left-open/right-closed choice rather than
silently adopting the conceptual closed interval in the audit question.
Equal acceptance/failure timestamps cannot establish positive post-acceptance lead
time with the server's pre-transaction millisecond clocks; exclude such ties.
A failure exactly at the horizon is included. Earlier failure is contradictory;
failure after the horizon is outside the target, not proof of a valid negative.

| Category | Evidence-based proposed treatment; no dataset authorized |
| --- | --- |
| POSITIVE | Verified acceptance anchor and consistent linked structured FAILED_DELIVERY in `(t,t+H]`; no conflicting duplicate, prior terminal success or earlier censoring intervention. For a fixed-horizon dataset, also require horizon maturity for positives to avoid class-dependent inclusion. |
| VALID NEGATIVE | Would require a verified acceptance plus reliable full-window source coverage (or trusted absorbing terminal success) and no target event, contradiction or relevant intervention. **General valid-negative certification is not established by this repository.** |
| CENSORED | Reliably timestamped cancellation/reassignment or other observation-ending intervention inside the horizon before the target event. Never relabel as negative. Same-instant event/intervention order is ambiguous. |
| AMBIGUOUS / EXCLUDE | Missing anchor, invalid chronology, unknown/missing metadata, multiple conflicting events, lost linkage, intervention status without trustworthy time, failure at/before t, terminal contradiction, unknown writer/retention epoch or unexplained instrumentation gaps. |
| NOT YET MATURE | Trusted observation boundary C is before `t+H`; with agreed lateness allowance G, require `t+H+G <= C`. A caller-supplied extraction time is not automatically a trusted observation boundary. |

Matching DELIVERED event, assignment deliveredAt and order completedAt provide
strong local success evidence under the current writer: DELIVERED cannot later
fail through the normal service. They do not prove append-only historical
integrity, complete intervention coverage or that all other accepted assignments
were observed. Selecting only delivered negatives would silently change the
population to a selected terminal-outcome cohort and exclude ongoing mature
assignments; it is not an acceptable workaround for the original question.

An active assignment still present after H, last updatedAt after H, a dashboard
read, or an absence of risk assessments is not evidence of continuous outcome
capture. There is no immutable status-history ledger, event-ingestion watermark,
ingestedAt, deletion audit or completeness attestation in these models. occurredAt
is event-reference time, not ingestion time. An extraction cutoff establishes
elapsed time only. Therefore missing failure events cannot safely become negatives.

### Administrative intervention audit

| Intervention | Durable evidence and timing | Treatment / information limitation |
| --- | --- | --- |
| Assignment cancellation / reassignment | Nullable cancelledAt/reassignedAt and event enum values exist; no corresponding complete production writers found | Before t invalidates eligibility; inside window may censor; after window should not change a proven earlier outcome. Missing/contradictory timestamps exclude. Completeness not established. |
| Order cancellation | Nullable Order.cancelledAt/status; no post-acceptance cancellation writer found | Same timing/censoring treatment; null does not attest that no external/manual intervention occurred. |
| ADMIN manual offer / automated dispatch | New OFFERED record with assignedAt/deadline, existing-live-assignment guards | Usually precedes t; no force reassignment of an accepted episode found. Human selection may use information unavailable to the proposed features. |
| Batching and route changes | Batch createdAt/startedAt, mutable batchId and stop/route state | Can affect outcome after acceptance; attachment/detachment history is not a complete immutable intervention ledger. Treat as factual operating policy, not causal evidence; if cohort restrictions require missing history, stop rather than infer it. No batching features added. |
| Decline/timeout | Writes require OFFERED | Cannot normally occur after acceptance; acceptedAt plus contradictory decline/timeout facts is ambiguous, not negative. |
| Pharmacy reject/fulfillment decisions | Prescription/order transitions guarded to early order states; no accepted-delivery force cancellation or fulfillment switch found | Normally before cohort entry; out-of-sequence historical facts exclude. Never interpret prescription content to repair state. |
| ADMIN risk acknowledge/resolve/dismiss | Persisted risk actor/timestamps; only risk lifecycle changes | Not outcome labels or evidence of domain recovery; no direct delivery state mutation found. |
| Support ticket/message actions | Support records only; no domain state writer found in support implementation | Cannot rule out off-platform intervention or communications. Never parse free text for features, labels or censoring. |
| Rider deliver/fail | Authoritative guarded transitions, as above; no separate ADMIN force-complete/fail endpoint found | Observed operational actions, not clinical truth or rider fault. Acknowledging manual review does not measure review duration. |

No claim is made that every intervention exists in production. The key limitation
is inability to prove its absence/completeness from the durable records. An
intervention may respond to facts outside the four proposed features, so censoring
is potentially informative; excluding it must not be presented as an unbiased
counterfactual prediction of "failure without intervention".

### Four-feature readiness table

| Feature | Source / operands | Available at reference point? | Immutable / nullable | Historical coverage | Leakage / proxy risk | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Acceptance latency | `(acceptedAt - assignedAt)` in explicitly defined units | Yes after successful acceptance commit | Neither column DB-immutable; no later writer found. acceptedAt nullable, assignedAt required | Existing acceptedAt writer from b018fb0; actual populated epoch unknown | Safe temporal ordering only after acceptance; delays proxy connectivity/shift constraints, not personal reliability | KEEP as conditional candidate; reject missing/negative/inconsistent operands |
| Stored offer duration | `(offerExpiresAt - assignedAt)` | Yes, persisted at offer creation | offerExpiresAt nullable; no subsequent rewrite found; schema does not enforce immutability | Added/populated in ae20a1e; legacy null rows explicitly not backfilled | Current config substitution would fabricate history; policy/working-condition proxy | KEEP conditionally; reject null/nonpositive/inconsistent values |
| UTC hour | acceptedAt UTC hour, 0–23 | Yes after acceptance commit | Inherits nullable/non-enforced anchor | Same acceptance coverage requirement | Raw timestamp excluded from feature row; shift/time proxy remains | KEEP conditionally; no local/ETA/dispatch offset substitution |
| UTC weekday | acceptedAt UTC weekday, Sunday=0 | Yes after acceptance commit | Inherits anchor limitations | Same as hour | Weekly scheduling/social proxies; no individual aggregates | KEEP conditionally |

No one of these four features is newly rejected in principle. Their presence
does not resolve label readiness. Reject invalid rows and any reconstruction from
current configuration/current lifecycle state. No distance, workload, rank,
item count, identity/history or geography feature was added.

### Code capability versus production observation epoch

| Capability | Earliest inspected repository evidence |
| --- | --- |
| Nullable acceptance/event schema | Initial migration 20260828174436; schema capability alone is not populated data |
| Atomic acceptance timestamp and acceptance event | b018fb0, assignment offer workflow |
| Structured FAILED_DELIVERY metadata and success lifecycle writer | d8df7f4, pickup/delivery lifecycle |
| Persisted offer duration operands for new manual/dispatch/batched offers | ae20a1e with 20260913000000_dispatch_instrumentation; nullable deadline added with no historical backfill |
| All four candidate inputs plus positive-event writer capability | ae20a1e is the earliest inspected combined capability epoch; actual per-row completeness still needs verification |
| Complete censoring and observation/maturity proof | **No complete capability epoch established**, including HEAD 5abd178 |
| Verified production observation epoch | **Unknown**; no Git commit or migration filename proves deployment or trustworthy observation |

Thus there is no established epoch where *all* required dataset guarantees are
simultaneously available. Historical acceptedAt may be null; deadlines may be
legacy-null; event metadata/linkage can be missing; no ingestion timestamp can
separate a late backfill from an originally timely event. Do not assign a date
to a production cohort from this audit.

### Future aggregate-only measurement request, not an executed query

After separate authorization, an observation-readiness review would need:

- accepted assignments and distinct orders by explicit UTC day/week and writer
  epoch; matching acceptance-event coverage and timestamp disagreement rate;
- elapsed-horizon-mature counts separately from **verified observation-mature**
  counts; not-yet-mature and unknown-observation counts;
- positive candidates, certified positives, certified valid negatives (currently
  not certifiable generally), censored cases and mutually exclusive primary
  ambiguous-exclusion counts with a declared precedence;
- positive prevalence only among certified positives plus certified negatives;
  report unavailable when that denominator is not established;
- duplicate/conflicting failure-event rate with stated event/assignment
  denominators, null/broken linkage and malformed/missing metadata rates;
- per-feature missing/invalid rates; acceptedAt/event mismatches, invalid
  acceptance latency/deadline intervals and legacy-null deadline counts;
- cancellation/reassignment/terminal-success consistency, known intervention
  timing, retained-history/coverage gaps and lateness/deletion-audit availability;
- counts and outcome classes per proposed temporal split, same-order crossings,
  exclusion rates over time, and usable calibration-cohort sizes.

No current count, prevalence or rate is known. Obviously insufficient: no
certifiable negatives, one-class evaluation periods, sparse/empty temporal
holdouts, unknown observation coverage, dominant ambiguous exclusions, or one
policy/time slice with no stability check. There is no universal minimum sample
size. Required volume depends on prevalence, temporal variation, effective
order/day-level sample size, calibration uncertainty and the intended metric
comparison. Phase 14A's 12-week suggestion is a planning prompt, not a readiness
pass condition or substitute for outcome coverage.

### Aggregate use, retention and baselines

The legitimate proposed quantity remains expected *recorded manual-review failure
events*, not expected staff hours: requiresManualReview=true does not measure
actual human work or review duration. For assignments accepted in a fixed UTC
cohort `[b,b+W)`, sum their ephemeral probabilities for each assignment's own
`(acceptedAt,acceptedAt+60m]` interval; report only cohort totals and uncertainty
after approved minimum-cohort/small-cell suppression checks. This is not exactly
calendar "next-hour workload": acceptance-cohort horizons are staggered, and
already-active/new future assignments are not covered by the chosen point.
Do not broaden the target to make that marketing claim. Human capacity planning
would need to confirm the usefulness of this narrower aggregate first.

No individual ranking, response field or durable score recommended. Temporary
internal assignment linkage is needed to pair a probability with its delayed
label for log loss/Brier/calibration; aggregate sums alone cannot recover these
metrics. Retention TTL, horizon/grace allowance, access control, crash loss,
small-cell suppression and deletion verification require explicit future review.
After maturity, delete the probability/linkage and retain only permitted aggregates.
Loss of evaluation state is unavailable, not a negative label.

Baseline designs remain (1) TRAIN prevalence constant, (2) prespecified UTC
hour/weekday rate table with TRAIN-only smoothing/fallback, (3) prespecified
acceptance-latency/offer-duration bins with TRAIN-only rates. None computed.
Chronological TRAIN/validation/TEST only; same-order assignments cannot cross
splits. Freeze bins/selection on TRAIN/validation, keep TEST untouched, and ensure
label horizons/grace mature before the next historical training boundary. Purge
boundary crossings and report exclusions; no random split or holdout-derived
prevalence. Baseline computability remains gated by the same label deficiencies.

### Readiness blockers and next permitted work

No schema/instrumentation change is implemented or prescribed as an automatic
fix. Required **guarantees** are a defensible outcome-observation boundary,
retained event integrity/coverage, and auditable intervention/episode semantics.
Whether deployment controls can establish them or new durable instrumentation
is needed requires a separately authorized design review. A timestamp column
alone would not prove completeness. No complete minimal schema fix is established.

Current missing-event evidence cannot distinguish no target event from missing
instrumentation. A delivered-only negative cohort, subjective ADMIN labels or
free-text repair would change the question and is rejected. The readiness status
is therefore NOT READY FOR 14B, not merely "REAL export still gated".

Next permitted direction: review these blockers and separately authorize an
observation/censoring assurance design or provide verifiable deployment/retention
evidence. Do not proceed to dataset, feature, training or runtime implementation.
Clinical inference, reputation scoring, permanent person profiles and operational
enforcement remain prohibited. Timing proxies still need review even if the
data gate is later satisfied.

Only this document changed; Phase 14A text above is preserved. No production,
Prisma/migration, frontend, ML, package or configuration changes; no telemetry,
data generation, dependency installation, tests or live database access.
Nothing staged, committed or pushed.

## Phase 14A.2 — observation and censoring assurance design

### Scope and preflight

Design only. Phase 14A and Phase 14A.1 above remain unchanged. MEDICONNECT,
branch feature/intelligence-experience, HEAD 5abd178. Preflight:

```text
## feature/intelligence-experience...origin/feature/intelligence-experience
?? backend/docs/operational-risk-ml-feasibility.md
5abd178 feat: add operational risk detection and reconciliation
ae20a1e feat: add rider suitability ML and shadow scoring
180a2a8 feat: add ML ETA training and shadow inference
```

Only this existing untracked document is modified. No database or customer data
access. This design certifies no existing row and authorizes no implementation.

### Assurance problem and positive contract

Keep the target: a qualifying recorded FAILED_DELIVERY event in `(t,H]`, where
`t = acceptedAt` and `H = t + 60 minutes`. It must match the assignment/order,
have requiresManualReview=true and valid structured orderStatusAtFailure. This
is not physical incident truth, rider fault, actual review work or a text label.

Each accepted-assignment candidate gets exactly one class. Integrity and coverage
contradictions take precedence over plausible labels:

| Class | Durable proof required |
| --- | --- |
| POSITIVE | Valid acceptance anchor and complete prefix through a unique qualifying failure in `(t,H]`, before any censor/success; immutable terminal evidence. |
| VALID_NEGATIVE | Uninterrupted certified coverage through H without failure/censor, or certified absorbing success in `(t,H]` with complete preceding history and no earlier failure/censor. |
| CENSORED | Certified first observation-ending intervention in `(t,H]`, complete prefix and no earlier qualifying failure or absorbing success. |
| AMBIGUOUS_EXCLUDE | Broken/missing assurance, contradictory chronology, invalid feature operands, unknown interventions, invalid epoch or incomplete retained history. |
| NOT_YET_MATURE | Sound anchored episode without early certified terminal outcome or visible coverage certificate through H. Includes closure pending after H; elapsed time alone is insufficient. |

Early terminal evidence can establish a class before H; future training still
requires H before its historical cutoff. Failure/censor at H is included. A
terminal event exactly at t lacks predictive lead time and is excluded. Conflicting
terminal ties are excluded, not ordered by UUID. Interventions after H do not
censor a fully certified horizon; failures after H do not make it positive.

Rechecked schema.prisma and delivery-lifecycle/lifecycle.service.ts. The ordinary
failure path CAS-transitions ACCEPTED/PICKED_UP/OUT_FOR_DELIVERY to FAILED and
creates FAILED_DELIVERY with literal requiresManualReview=true and the order
status, inside one serializable transaction. The risk hook runs after commit.

| Property | Existing guarantee | Additional assurance required |
| --- | --- | --- |
| Identity | UUID PK uniquely identifies row | Immutable identity/content and retained evidence. |
| Assignment | Nullable FK, SetNull on deletion; normal writer supplies it | Required immutable covered-event linkage and protected parent retention. |
| Order | Required FK; writer uses assignment.orderId | Enforce assignment/order agreement, not just independent FKs. |
| occurredAt | Required DateTime; writer captures now before transaction/retries | Trusted post-lock transition time, no caller backdating in covered epoch. |
| Type/metadata | Enum; nullable JSON; writer supplies structured facts | Covered-event persistence validation and immutability, no note parsing. |
| Uniqueness | PK only | One covered terminal failure per assignment; no conflicting success/failure; prospective constraints. |
| Retry | Serializable retry and status CAS prevent normal duplicates; already FAILED returns without evidence verification | Verify and return original terminal evidence; missing/conflicting evidence is an assurance fault, never historical repair by invention. |
| Mutation/deletion | No production event mutation/deletion path found; schema does not forbid it | Restricted normal roles, covered-event protection, audited repair invalidates coverage. |
| Historical compatibility | Nullable links/metadata; no deployment attestation | Prospective epoch; apparent row conformity cannot prove historical completeness. |

### Negative alternatives and censoring

| Alternative | Correctness/full horizon | Complexity, transaction, retry | History, burden, privacy |
| --- | --- | --- | --- |
| A. Absorbing success | Complete prefix plus durable no-reopen/no-later-failure invariant logically covers remainder; no answer for active survivors | Strengthen existing terminal transaction, uniqueness and repeat verification; low-medium | Prospective only; small burden, existing IDs/times. Delivered-only negative cohort is biased and rejected. |
| B. Explicit completion | Full H coverage only with shared writer barrier and prevention of later backdating; timer marker alone proves nothing | Medium: acceptance anchor, atomic terminal/censor evidence and idempotent serialized closure | Prospective; explicit bounded invocation, no scheduler required. Existing IDs/times only; backlog means pending, not negative. |
| C. Append-only ledger | Sequence enables replay/gap detection but still needs H barrier/watermark | Highest: all transitions, atomic state/append, operation-key deduplication and closure | No reconstructed legacy history; more storage/ops burden and linkable chronology. |
| D. Retained database change history | Possible only with all-writer capture, deletion/clock guarantees and verified snapshot watermark | Audited CDC/WAL offsets, gap detection and transaction deduplication; infrastructure-intensive | No such deployed evidence established; broad capture risks copying unrelated sensitive data. Not smallest repository-supported option. |

All censor times must be immutable authoritative transition times; updatedAt is
not a substitute. Observation ends at the first valid terminal/intervention.

| Event | Required time | Current durable source | Complete today? | Treatment within H | Needed assurance |
| --- | --- | --- | --- | --- | --- |
| Cancellation | Effective cancellation | Assignment/order cancellation fields; CANCELLED type | No complete accepted-episode history established | CENSORED | Atomic typed intervention tied to affected assignment; no silent order-only termination. |
| Reassignment | Old episode termination | reassignedAt/status, REASSIGNED type | No complete writer found | CENSORED | Immutable old/new linkage where applicable; never reuse old episode. |
| Replacement | Supersession, not new offer time | New assignment rows and active guards | New row does not prove old disposition | CENSORED old episode; new acceptance separate | Atomic supersession certificate and linkage. |
| ADMIN/manual override | Effective transition | No general post-accept override ledger | No | Authorized observation-ending override censors; unknown edit excludes | Typed operational code and atomic evidence for any future supported override. Risk/support-only edits do not censor. |
| Pharmacy termination | Effective rejection/termination | Current rejection guarded to pre-accept states | No post-accept history | Normal early rejection has no candidate; post-accept termination would censor | No new product operation proposed; require common contract before introducing one. Unexpected state excludes. |
| Success | DELIVERED transition | deliveredAt, completedAt, DELIVERED event atomic | Normal path only | VALID_NEGATIVE with complete prefix and absorption | Persistence-protected terminal certificate and verified retry. |
| Failure | FAILED_DELIVERY time | FAILED state and event atomic normally | Normal path only | POSITIVE if qualifying; malformed evidence excludes | Positive guarantees above. |
| DECLINED/TIMED_OUT with acceptedAt | Transition and acceptance chronology | Fields; writers normally operate on OFFERED | Contradictory accepted episode | AMBIGUOUS_EXCLUDE | Reject contradictory covered transitions. |
| Unknown terminal | Typed effective transition | Snapshot/unknown writer | No | AMBIGUOUS_EXCLUDE | Define/version semantics before admission to epoch. |
| Batch/route changes | No censor time unless episode ends | Mutable batchId and batch/stop records | Attachment history incomplete | Continue observation; not features/censors | No route ledger needed; any actual episode termination uses barrier. |

Current application guards prevent failure after DELIVERED and delivery after
FAILED. Future covered episodes require that invariant at persistence level.
A legitimate new attempt gets a new assignment ID. Privileged reopening invalidates
the old certificate. A DELIVERED snapshot without complete prefix is insufficient.

### Maturity and observation completeness

No bounded event-write latency is established. The clock is captured before the
serializable transaction and reused on retries; there is no established bound on
queuing, lock waits, outages or administrative writes. No arbitrary grace is
justified. M13 reconciliation recovers risk assessments from existing domain
events, not missing domain events, and supplies no outcome watermark.

Proposed guarantee: every covered transition takes the same assignment/episode
lock BEFORE sampling authoritative time or changing state. Closure takes that
lock, verifies trusted time is strictly greater than H, validates the prefix and
atomically records coveredThrough=H and evidence revision. Earlier lock holders
commit/rollback first; later holders cannot introduce events at or before H.
Use database-side current time sampled after lock acquisition, not transaction
start time. A transaction starting before H but acquiring the lock after H gets
its post-lock event time. A retry samples again inside the successful transaction.
This is an explicit prospective timestamp-contract change, not reinterpretation
of old events. Acceptance similarly anchors t under the covered writer contract.

Normal backdating must be prevented at persistence. Clock regression/untrusted
time suspends certification and invalidates the affected coverage interval; do
not clamp or fabricate timestamps. Operations that must continue during a clock
fault remain uncertified. Clock-health evidence and an operational owner are
required. Late reporting of a physical incident is recorded at its accepted
transition time, not a client-asserted historical time. If product requires
backdated occurredAt, review this design again before implementing it.

Use one consistent extraction snapshot S. Anchors, events, certificates, epoch
records and invalidations must be committed and visible in S. Missing H closure
for a sound open episode means NOT_YET_MATURE even after wall-clock H. Known
faults mean AMBIGUOUS_EXCLUDE. No closure latency SLA is invented: backlog reduces
availability, not label correctness. Early terminal certification does not waive
H-before-training-cutoff requirements. No reconciliation delay is added to labels.

Separate three claims:

1. Application transaction completeness: state, event and assurance evidence
   commit together or roll back together.
2. Database history completeness: all covered writers participate, evidence is
   immutable/retained, repairs invalidate coverage, and privileged bypass cannot
   silently remain certified. This assumes controlled administration; no schema
   protects against an omnipotent unaudited DBA.
3. Extraction completeness: one snapshot, all relevant records/pages, retained
   boundaries and invalidations. A filtered/partial event export cannot prove absence.

| Failure mode | Prevention, detection, tolerance or exclusion |
| --- | --- |
| Crash before commit/rollback | Atomicity prevents partial publication. A never-committed attempt is not the recorded target. |
| Crash after commit/lost response | Tolerate with original-evidence verification and uniqueness; no reset timestamp or new event. |
| Concurrent retry/closure | Shared lock order, CAS/uniqueness and retry prevent closure overtaking a covered writer. |
| Already-terminal missing evidence | Detect fault, exclude and alert operationally; never invent original facts. |
| Direct/manual DB edit | Deny ordinary bypass. Audited privileged repair invalidates affected coverage before alteration; unbounded bypass invalidates entire uncertain epoch interval. |
| Old writer/partial deployment | Gate writer versions and enforce persistence rules; drain old transactions before activation. Bypass causes exclusion. |
| Event mutation/deletion/retention expiry | Prevent normal mutation; retain purge/coverage manifest. Exclude incomplete history including survivors of partial purge. |
| Delayed write | Post-lock timestamp and barrier tolerate delays; elapsed time/risk-hook completion never certifies absence. |
| Clock discontinuity | Detect, suspend certification and invalidate coverage; no unproven clock guarantee. |
| Missing export pages/replica lag | Fail completeness validation; snapshot must contain matching evidence and certificates. No partial publication. |
| Unreported physical incident | Outside recorded-event target; no physical safety claim. |

### Verified observation epoch and historical policy

Use a small durable database operational epoch record: immutable ID, contract
version, database activation time VERIFIED_OBSERVATION_START_AT, approved writer
manifest reference, enforcement/clock/retention attestation reference, and retained
append-only invalidation/end records with scope. Deployment metadata supports it;
configuration/export input alone cannot manufacture trust. Git date is not rollout
time. References to existing controlled change records avoid new staff identity
or free-text fields in this contract.

Activation requires migrated enforcement, verified roles, upgraded writers,
drained legacy transactions, clock checks and atomic gate activation. Acceptance
records epoch ID, t and acceptance evidence/anchor in one transaction. Closure
checks validity over the required interval. Export authorization identifies epoch
and snapshot but cannot override missing proof. No current verified start is claimed.

| Case | Policy |
| --- | --- |
| Created or accepted before epoch | Default exclude. Even pre-epoch offer creation with later acceptance is excluded initially because feature provenance is historical; separate assurance review needed to relax. |
| Accepted before epoch, H overlaps epoch | Exclude whole episode; never restart/truncate horizon. |
| Accepted exactly at epoch | Equality insufficient; require atomic active-epoch anchor and valid creation/feature provenance. |
| Created/accepted after epoch | Potentially eligible with all coverage/integrity checks. |
| Null acceptedAt | Exclude; never infer from status, updatedAt or event. |
| Null offerExpiresAt | Exclude under four-feature contract; never use current config. |
| Legacy missing failure metadata/linkage | Exclude affected episode; no text inference/default metadata. |
| Invalid epoch/retention gap | Exclude scoped history even if individual rows look consistent. |

### Minimum implementation options

| Dimension | Option A — minimal augmentation | Option B — explicit observation completion | Option C — append-only lifecycle assurance |
| --- | --- | --- | --- |
| Schema | Strengthen covered acceptance/terminal integrity, uniqueness and epoch metadata | A plus unique observation anchor, revision, terminal/censor certificate, H certificate and invalidations | Versioned transition ledger, per-assignment sequence, operation key, epoch and closure |
| Writers | Acceptance, failure, success; guard interventions | Acceptance, lifecycle, any observation-ending order/assignment mutation, explicit closure entry point | Every transition/correction/import and state projection |
| Transactions | Atomic terminal evidence and state | Shared barrier; atomic state/event/certificate and H closure | Atomic state/append, sequence continuity plus barrier |
| Retry | Unique terminal key, verify original evidence | A plus idempotent anchor/closure, no revision change on no-op | Operation-key deduplication, sequence verification |
| Migration/backfill | Prospective constraints, no invented history | New records/nullable legacy relations; no legacy anchor/marker backfill | Prospective ledger; current snapshot is not replay |
| Deployment | Moderate gate/roles rollout | Moderate-high: lock order, clock contract, writer gate, closure invoker, retention procedure | Highest: all transitions/projections, broader recovery tooling |
| Privacy | Existing IDs/times | Existing internal linkage, codes/times; no person attributes | More linkable behavioral history despite no new attributes |
| Confidence | Positives and some absorbing negatives; unresolved active cohort | All required classes under enforceable stated assumptions | Strong replay, no stronger physical truth; still needs closure |
| Limits | Insufficient alone; delivered-only negative selection rejected | Depends on writer control, clock/retention assurance and approved semantics | Overbroad; append-only alone insufficient |

### Recommendation

Recommend Option B, reusing strengthened DeliveryEvent terminal evidence rather
than a full transition ledger. A cannot certify active survivors; C records more
than necessary. B replaces a guessed grace with a serialization proof. Minimum
logical records, not an implemented schema:

- Epoch/version/activation and enforcement attestation, with scoped invalidations.
- One anchor per covered assignment: immutable assignment/order/epoch linkage,
  acceptance evidence and t, revision. Derive H; do not add an independently
  mutable acceptedAt copy.
- Atomic terminal/censor certificate: kind, authoritative time, source evidence
  ID and revision. Replacement linkage only for supported replacement operations.
  Prefix completeness comes from mandatory writer participation, not a marker
  asserting its own correctness.
- Horizon certificate: coveredThrough, certifiedAt, revision; later events after
  H remain allowed. The operational assignment is not frozen at the ML horizon.
- Retained scoped invalidations for faults/corrections, consulted by extraction.

Certificate is coverage evidence, not a stored label/score. Missing marker never
means negative. Duplicates/conflicts, unexplained acceptance/event mismatch,
unknown overrides, invalid operands, clock faults and retention gaps remain
AMBIGUOUS_EXCLUDE. Known censoring is neither negative nor positive.

### Future Phase 14B eligibility algorithm — sketch only

1. Fix authorized epoch set, retention bounds and consistent snapshot S with an
   immutable export manifest. Reject extraction-wide incompleteness.
2. Enumerate accepted candidates with exclusion counts. Validate creation/acceptance
   epoch, anchor/linkage, retained history, clock assurance and scoped invalidations.
3. Validate original feature operands assignedAt, acceptedAt, stored offerExpiresAt
   under earlier finite/chronology rules. Derive only acceptance latency, stored
   offer duration, UTC hour and weekday. Assurance/outcome fields are not predictors.
4. Set t/H exactly; inspect all relevant evidence, including outside-H contradictions
   invalidating absorption/history. Faults or bad operands yield AMBIGUOUS_EXCLUDE
   before other labels.
5. First valid certified fact in `(t,H]`: qualifying failure gives POSITIVE,
   absorbing success VALID_NEGATIVE, ending intervention CENSORED. Contradictory
   ties/forbidden later transitions exclude. Uncertified terminal evidence excludes.
6. Otherwise valid visible H certificate gives VALID_NEGATIVE. Sound open episode
   without it is NOT_YET_MATURE, including closure backlog; distinguish pending
   reason from an integrity fault.
7. Training retains only certified positives/negatives with H before the historical
   training cutoff and certificates available then. Report all five counts; never
   impute censored labels or select only delivered negatives. IDs for grouping only.
8. Group by order, chronological TRAIN/validation/TEST, purge order/horizon boundary
   crossings. TRAIN-only preprocessing/baselines, frozen selection before TEST.
   This design establishes neither volume sufficiency nor experiment usefulness.

### Privacy, retention and ML independence

No new PII attributes, coordinates, free text, clinical information, rider/customer
profiles, rankings or persistent scores. Internal assignment/order linkage remains
sensitive operational data; it is not anonymized by being operational. Limit access;
do not copy DeliveryEvent.note or unrelated metadata into assurance records.

Retention must be explicitly approved and aligned with source evidence; no duration
is invented. Retained purge/invalidation manifests prevent certification after
partial deletion. Prediction-evaluation retention is a separate future authorization;
no probabilities are stored by this design.

| Addition | ML-independence classification |
| --- | --- |
| Atomic acceptance anchor and terminal evidence consistency | OPERATIONALLY JUSTIFIED: audit/retry correctness without ML. |
| Immutable evidence, typed intervention chronology, correction invalidation | OPERATIONALLY JUSTIFIED: trustworthy lifecycle history. |
| Epoch provenance, writer gate, roles and clock assurance | OPERATIONALLY JUSTIFIED: establish when operational guarantees apply. |
| Generic coverage barrier/certificate | OPERATIONALLY JUSTIFIED if adopted for lifecycle audit/reconciliation; otherwise ML-ONLY storage/invoker and must be approved as such. |
| 60-minute closure invocation policy | ML-ONLY: experiment horizon, not an existing operational requirement. |
| Export snapshot/eligibility manifest | ML-ONLY future dataset provenance; not implemented. |
| New profile/coordinate/text fields, permanent scores, full ledger solely for this experiment | UNJUSTIFIED. |

### Future implementation authorization boundary

Planning only. A separate approval would need to authorize these exact categories:

| Area | Proposed work, none implemented |
| --- | --- |
| Prisma/migration | Prospective epoch, observation/certificate/invalidation representation; covered-event consistency, uniqueness, protected linkage/immutability and permissions. Enforcement may need migration SQL beyond Prisma declarations. No global legacy cleanup or fabricated backfill. |
| Acceptance | delivery-assignments/assignment.service.ts: atomic active-epoch anchor with RIDER_ACCEPTED and prospective timing assurance; preserve feature operands. |
| Lifecycle | delivery-lifecycle/lifecycle.service.ts: common lock/time primitive, terminal certificates, original-evidence verification on repeat; retain authorization and business transition rules. |
| Other writers | Audit order/pharmacy/batch/dispatch mutation paths for lock order and covered effects. Only actual observation-ending mutations participate. Do not introduce new cancellation/reassignment/ADMIN capability merely to populate this matrix. |
| Event/assurance code | Persistence validation, explicit bounded closure entry point, structured censor integration for supported operations and immutable invalidation path. No M13 risk service/repository/hook/reconciliation behavior changes. |
| Tests | Atomic rollback, post-commit retries, already-terminal missing evidence, duplicate/conflicting terminals, delayed-transaction versus closure race, post-lock time on retry, exact t/H boundaries, clock regression, later event after H, censor-before-failure, success absorption, replacement identity, epoch activation/old-writer denial, null/legacy features, purge/invalidation, consistent snapshot and partial-export rejection. |
| Documentation | Contract, writer inventory, lock ordering, clock faults, closure invocation, retention/repair runbooks. |
| Deployment metadata | Durable activation attestation, writer gate, ordinary-role restrictions, audited privileged repair, clock-health evidence and invalidation owner. |

Approval must explicitly accept prospective post-lock event timing, enforceable
writer/repair controls, retention ownership and the ML-only closure policy.
Implementation review must check database enforcement and deadlock-safe lock order
across order/assignment operations. No timer-only substitute is acceptable. No new
scheduler, external API, product operation, dataset code or ML runtime is included.
If backdating/untracked corrections are required, or writer/clock control cannot be
established, the verified epoch cannot activate under this design.

### Verification and readiness

Only this existing untracked document was appended; earlier sections preserved.
No production, Prisma, migration, test, frontend or ML files changed; no database
access, training, generated data, dependencies, staging, commit or push. Validation:
git diff --check, explicit whitespace check of this untracked document, protected
path/cached diffs and final short status. Builds/tests are not applicable to this
documentation-only phase.

This is a prospective assurance design, not evidence that current data is ready.
Phase 14B remains blocked on implementation approval, verified rollout/retention,
observed cohort completeness and subsequent data-readiness review. The next
permitted step is design review and separate narrow implementation authorization.
No implementation or Phase 14B is authorized by this decision.

ASSURANCE DESIGN READY FOR IMPLEMENTATION REVIEW

## Phase 14A.3 — observation assurance implementation

The subsequent explicit authorization permits post-lock timestamp sampling and
retry resampling only for prospective assured episodes. This refines implementation
of Phase 14A.2; earlier feasibility/readiness/design sections are preserved.
Preflight: MEDICONNECT, feature/intelligence-experience, HEAD 5abd178; only this
previously untracked document present. No production database or REAL data accessed.

### Implemented invariants and persistence

One additive migration creates ObservationEpoch, DeliveryObservation and
ObservationInvalidation. UUID identities and operational linkage/timestamps only;
no labels, probabilities, profiles, notes, coordinates or clinical attributes.
The Prisma models mirror these tables; SQL supplies additional enforcement.

A DeliveryObservation uniquely anchors an assignment/order/epoch, accepted start,
fixed start+60-minute horizon, acceptance event identity and revision. Its terminal
event identity/kind/time records TARGET_FAILURE or ABSORBING_SUCCESS. Separate
coveredThrough/certifiedAt fields record horizon completion without freezing the
business assignment. Later terminal events after H remain possible. The internal
writer transaction ID/action and lastSerializedAt enforce participation in the
same transaction, not ML eligibility. Event triggers preserve one acceptance and
one terminal fact; deferred constraints prevent committing partial state/evidence.
Existing duplicate-call branches remain unchanged, relying on enforced integrity
for newly assured records; missing historical evidence is never repaired.

Epoch activation requires an explicit deployment attestation UUID and restricted
runtime role. Database activation time comes from that authorized call, never
migration/startup/Git. No epoch is created by this migration. Shared capability
gate -> assignment FOR UPDATE -> observation FOR UPDATE is the covered lock order.
Activation/invalidation take the exclusive gate. Functions use a fixed search path;
activation checks runtime role ownership/privilege restrictions. Deployment must
verify all additional writer roles/builds, retention and clock-health controls.
The privileged function owner remains a trusted operational boundary.

Invalidation is deliberately conservative: an append-only reason/attestation fact
invalidates the entire epoch, closes enrollment and applies to old certificates.
No claimed precise fault-start time is fabricated. Business history remains intact.
After explicit invalidation, subsequent ordinary domain operations use legacy time
and make no new assurance claims. Normal event mutation/deletion remains prohibited
for anchored evidence. No per-assignment repair UI or new ADMIN/public API exists.

### Transaction and timestamp scope

Acceptance eligibility still uses the existing invocation clock for offer expiry;
changing that would change transition eligibility. After existing validations,
prospective acceptance locks/revalidates the assignment, samples database current
UTC time and creates the provisional anchor inside the existing Serializable
transaction. acceptedAt and matching RIDER_ACCEPTED/RIDER_ASSIGNED events share
that time. CAS/domain/event failures roll back the anchor too. Duplicate acceptance
still returns OFFER_NOT_ACTIONABLE; it does not reset time or return a new success.
A delayed successful acceptance may have a later acceptedAt than the legacy
eligibility clock; future extraction must retain its original operand checks.

For assured failure and DELIVER, the same lock precedes the new authoritative time.
FAILED_DELIVERY occurredAt changes prospectively; metadata/linkage and state/event
atomicity are unchanged. The risk-hook evaluatedAt continues to match that source
event time; no risk rule, ranking or severity implementation changes. For DELIVER,
assignment.deliveredAt, order.completedAt and DELIVERED occurredAt share the
serialized time. On transaction retry, the lock is reacquired and time resampled;
rolled-back T1 leaves no business or assurance evidence. Raw PostgreSQL serialization
and deadlock errors surfaced by Prisma P2010 are normalized to P2034 so the existing
three-attempt domain retry/error contract remains in force.

Deliberately unchanged: legacy acceptedAt/event times; offer assignedAt/deadline
and expiry evaluation; pickup/arrival/start-delivery times; batch/stop timestamps;
location, dispatch, ML and unrelated clocks. Batch release/completion helpers use
the original invocation time even when the parent terminal fact is assured.
Certification and activation/invalidation recording times are sampled only after
their respective lock. No existing timestamps are rewritten or backfilled.

Completion locks the same assignment and observation and samples current time;
strictly greater than H is required, not equality. A writer locking first finishes
before closure; a writer locking later samples later and cannot commit an event
inside the closed horizon. lastSerializedAt/coveredThrough detect backwards clock
samples; clock faults abort certification/writes rather than clamp time. A separate
explicit invalidation operation is required if operations must continue uncertified.
Event triggers also acquire the assignment lock before testing anchor presence,
so an older event writer cannot make its coverage decision before serialization.
Deferred consistency and persistence guards protect terminal metadata/linkage and
reject unsupported state changes, conflicting terminal facts and evidence deletion.

### Writer coverage and historical exclusions

Covered: acceptance, failDelivery, DELIVER, explicit completion, capability
activation/invalidation. Pickup, arrival, start-delivery and batch/route operations
retain existing timestamp behavior and are not observation-ending interventions.
The audit still finds no supported cancellation/reassignment/replacement/ADMIN or
pharmacy post-accept termination writer. Accordingly no censor workflow or business
event is invented. Guards reject unsupported assured interventions; explicit epoch
invalidation is required before an operational repair, which loses assurance rather
than manufacturing a censor timestamp. A future supported censor writer requires
separate design/integration/testing before its capability version can cover it.

No epoch, pre-epoch creation/assignment time, nullable legacy deadline, or historical
accepted assignment means no new anchor. Preexisting terminal/acceptance evidence
on an offered row also prevents prospective enrollment; it is not repaired.
Exactly-at-epoch timestamps can enroll only through the new transaction path.
Missing acceptedAt and malformed historical failure metadata remain untouched.
No assurance fields enter public response DTOs. No telemetry, scheduler, dataset,
export, model, inference or ML artifact is added.

### Validation scope and remaining gates

Deterministic injected-store tests run the actual acceptance/failure/delivery
services and adapter. They cover atomic rollback, both terminal/completion orders,
T1 rollback/T2 retry, duplicate callbacks, legacy behavior, epoch boundaries,
missing legacy operands and exact serialized event offsets 0, 1, H-1, H, H+1.
No labels are computed. Completion at H is pending; H+1 can certify. Source review
checks cover SQL enforcement declarations. These tests do NOT execute PostgreSQL
triggers, role grants, MVCC or database locks; no live database was accessed and
the migration was not applied. No supported censor writer exists to race-test.
An isolated PostgreSQL migration/role/concurrency verification is a mandatory
pre-activation deployment gate, not a claimed result of the injected tests.

Production activation must separately attest upgraded/drained writers, permissions,
clock trust, immutable retained history and controlled privileged repairs. Then a
real observation period and separately authorized coverage/cohort audit are needed.
Passing implementation tests is not Phase 14B readiness. No REAL cohort sufficiency
or production completeness is claimed. Nothing staged, committed or pushed.

Final local verification: Prisma generate, backend typecheck and backend build
passed. Full Vitest run with `--maxWorkers=1 --no-file-parallelism`: 70 files,
2,085 tests passed, zero failures. The earlier focused domain/assurance run passed
3 files and 100 tests; the final full run includes the subsequently added retry
normalization and invalidation-order tests. git diff --check and explicit whitespace
checks for untracked files passed. Protected frontend, ETA/dispatch ML, backend ML
and operational-risk diffs are empty; staging is empty. PostgreSQL migration,
trigger/role/concurrency execution and production observation remain unverified.

ASSURANCE IMPLEMENTED — PRODUCTION OBSERVATION REQUIRED
