-- Prospective only. No epoch activation, historical backfill or business updates.
CREATE TABLE "ObservationEpoch" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contractVersion" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "attestationId" UUID NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "ObservationEpoch_version" CHECK ("contractVersion" = 'delivery-observation-v1')
);
CREATE UNIQUE INDEX "ObservationEpoch_one_active" ON "ObservationEpoch" ((true)) WHERE "closedAt" IS NULL;
CREATE TABLE "DeliveryObservation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignmentId" UUID NOT NULL UNIQUE REFERENCES "DeliveryAssignment"("id") ON DELETE RESTRICT,
  "orderId" UUID NOT NULL,
  "epochId" UUID NOT NULL REFERENCES "ObservationEpoch"("id") ON DELETE RESTRICT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "horizonAt" TIMESTAMP(3) NOT NULL,
  "lastSerializedAt" TIMESTAMP(3) NOT NULL,
  "writerTransaction" BIGINT NOT NULL,
  "writerAction" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "acceptanceEventId" UUID,
  "terminalEventId" UUID,
  "terminalKind" TEXT,
  "terminalAt" TIMESTAMP(3),
  "coveredThrough" TIMESTAMP(3),
  "certifiedAt" TIMESTAMP(3),
  CONSTRAINT "DeliveryObservation_horizon" CHECK ("horizonAt" = "startedAt" + interval '60 minutes'),
  CONSTRAINT "DeliveryObservation_terminal" CHECK ("terminalKind" IS NULL OR "terminalKind" IN ('TARGET_FAILURE', 'ABSORBING_SUCCESS'))
);
CREATE INDEX "DeliveryObservation_epochId" ON "DeliveryObservation"("epochId");
CREATE INDEX "DeliveryObservation_orderId" ON "DeliveryObservation"("orderId");
CREATE TABLE "ObservationInvalidation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "epochId" UUID NOT NULL REFERENCES "ObservationEpoch"("id") ON DELETE RESTRICT,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('CLOCK_UNTRUSTED', 'WRITER_GUARANTEE_LOST', 'RETENTION_LOST', 'OPERATIONAL_REPAIR')),
  "attestationId" UUID NOT NULL,
  UNIQUE ("epochId", "attestationId")
);

-- Lock order: shared capability gate, assignment row, observation row.
-- Activation/invalidation take the exclusive gate. No process-start activation.
CREATE FUNCTION observation_activate(attestation uuid, runtime_role name) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result uuid;
BEGIN
  IF attestation IS NULL THEN RAISE EXCEPTION 'Explicit deployment attestation required'; END IF;
  -- Activation is prohibited with an owner/superuser application connection.
  -- The attestation additionally identifies ALL deployed writer roles/builds.
  IF runtime_role IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolbypassrls)
    OR pg_has_role(runtime_role, current_user, 'MEMBER')
    OR has_schema_privilege(runtime_role, 'public', 'CREATE')
    OR has_table_privilege(runtime_role, 'public."DeliveryObservation"', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."ObservationEpoch"', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."ObservationInvalidation"', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."DeliveryAssignment"', 'TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."DeliveryEvent"', 'TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."Order"', 'TRUNCATE')
    OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public."DeliveryAssignment"'::regclass, 'public."DeliveryEvent"'::regclass, 'public."Order"'::regclass)
      AND pg_has_role(runtime_role, c.relowner, 'MEMBER')) THEN
    RAISE EXCEPTION 'Application role must be a restricted non-owner before activation';
  END IF;
  PERFORM pg_advisory_xact_lock(14003, 1);
  SELECT "id" INTO result FROM "ObservationEpoch" WHERE "attestationId" = attestation;
  IF FOUND THEN RETURN result; END IF;
  INSERT INTO "ObservationEpoch" ("contractVersion", "activatedAt", "attestationId")
    VALUES ('delivery-observation-v1', clock_timestamp() AT TIME ZONE 'UTC', attestation) RETURNING "id" INTO result;
  RETURN result;
END $$;

CREATE FUNCTION observation_invalidate(epoch uuid, reason_code text, attestation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE stamp timestamp(3);
BEGIN
  IF attestation IS NULL THEN RAISE EXCEPTION 'Explicit invalidation attestation required'; END IF;
  PERFORM pg_advisory_xact_lock(14003, 1);
  stamp := clock_timestamp() AT TIME ZONE 'UTC';
  INSERT INTO "ObservationInvalidation" ("epochId", "recordedAt", "reason", "attestationId")
    VALUES (epoch, stamp, reason_code, attestation) ON CONFLICT ("epochId", "attestationId") DO NOTHING;
  UPDATE "ObservationEpoch" SET "closedAt" = COALESCE("closedAt", stamp) WHERE "id" = epoch;
END $$;

CREATE FUNCTION observation_begin(assignment uuid, action text, version text) RETURNS timestamp(3)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a "DeliveryAssignment"; o "DeliveryObservation"; e "ObservationEpoch"; stamp timestamp(3);
BEGIN
  IF version <> 'delivery-observation-v1' OR version IS NULL THEN RAISE EXCEPTION 'Observation contract mismatch'; END IF;
  IF action NOT IN ('ACCEPT', 'FAIL', 'DELIVER') OR action IS NULL THEN RAISE EXCEPTION 'Unsupported observation action'; END IF;
  PERFORM pg_advisory_xact_lock_shared(14003, 1);
  SELECT * INTO a FROM "DeliveryAssignment" WHERE "id" = assignment FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM "DeliveryObservation" WHERE "assignmentId" = assignment FOR UPDATE;
  IF NOT FOUND THEN
    IF action <> 'ACCEPT' OR a."status" <> 'OFFERED' OR a."acceptedAt" IS NOT NULL THEN RETURN NULL; END IF;
    SELECT * INTO e FROM "ObservationEpoch" WHERE "closedAt" IS NULL;
    IF NOT FOUND OR a."createdAt" < e."activatedAt" OR a."assignedAt" < e."activatedAt" OR a."offerExpiresAt" IS NULL THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM "DeliveryEvent" WHERE "assignmentId" = assignment
      AND "eventType" IN ('RIDER_ACCEPTED', 'FAILED_DELIVERY', 'DELIVERED', 'CANCELLED', 'REASSIGNED')) THEN RETURN NULL; END IF;
    stamp := clock_timestamp() AT TIME ZONE 'UTC';
    IF stamp < e."activatedAt" OR stamp < a."assignedAt" THEN RAISE EXCEPTION 'Observation clock untrusted'; END IF;
    INSERT INTO "DeliveryObservation" ("assignmentId", "orderId", "epochId", "startedAt", "horizonAt", "lastSerializedAt", "writerTransaction", "writerAction")
      VALUES (assignment, a."orderId", e."id", stamp, stamp + interval '60 minutes', stamp, txid_current(), action);
    RETURN stamp;
  END IF;
  IF action = 'ACCEPT' THEN RAISE EXCEPTION 'Observation already started'; END IF;
  -- An explicitly invalidated epoch makes no further coverage claims. Preserve
  -- ordinary domain behavior; never rewrite the old observation/event history.
  IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN RETURN NULL; END IF;
  IF (action = 'FAIL' AND a."status" NOT IN ('ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY'))
    OR (action = 'DELIVER' AND a."status" <> 'OUT_FOR_DELIVERY') THEN RAISE EXCEPTION 'Observation transition changed' USING ERRCODE = '40001'; END IF;
  stamp := clock_timestamp() AT TIME ZONE 'UTC';
  IF stamp < o."lastSerializedAt" OR (o."coveredThrough" IS NOT NULL AND stamp <= o."coveredThrough") THEN
    RAISE EXCEPTION 'Observation clock untrusted; invalidate capability before repair';
  END IF;
  UPDATE "DeliveryObservation" SET "lastSerializedAt" = stamp, "writerTransaction" = txid_current(),
    "writerAction" = action, "revision" = "revision" + 1 WHERE "id" = o."id";
  RETURN stamp;
END $$;

CREATE FUNCTION observation_complete(assignment uuid, version text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o "DeliveryObservation"; a "DeliveryAssignment"; stamp timestamp(3);
BEGIN
  IF version <> 'delivery-observation-v1' OR version IS NULL THEN RAISE EXCEPTION 'Observation contract mismatch'; END IF;
  PERFORM pg_advisory_xact_lock_shared(14003, 1);
  SELECT * INTO a FROM "DeliveryAssignment" WHERE "id" = assignment FOR UPDATE;
  SELECT * INTO o FROM "DeliveryObservation" WHERE "assignmentId" = assignment FOR UPDATE;
  IF NOT FOUND THEN RETURN 'UNSUPPORTED'; END IF;
  IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN RETURN 'INVALIDATED'; END IF;
  IF o."certifiedAt" IS NOT NULL THEN RETURN 'COMPLETE'; END IF;
  IF o."acceptanceEventId" IS NULL THEN RAISE EXCEPTION 'Missing observation acceptance evidence'; END IF;
  stamp := clock_timestamp() AT TIME ZONE 'UTC';
  IF stamp < o."lastSerializedAt" THEN RAISE EXCEPTION 'Observation clock untrusted'; END IF;
  IF stamp <= o."horizonAt" THEN RETURN 'PENDING'; END IF;
  UPDATE "DeliveryObservation" SET "coveredThrough" = "horizonAt", "certifiedAt" = stamp,
    "lastSerializedAt" = stamp, "revision" = "revision" + 1 WHERE "id" = o."id";
  RETURN 'COMPLETE';
END $$;

-- Normal application roles must not own these objects. Deployment grants the
-- narrow functions explicitly; deployment-only functions are not PUBLIC APIs.
REVOKE ALL ON "ObservationEpoch", "DeliveryObservation", "ObservationInvalidation" FROM PUBLIC;
REVOKE ALL ON FUNCTION observation_activate(uuid,name), observation_invalidate(uuid,text,uuid) FROM PUBLIC;

CREATE FUNCTION observation_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o "DeliveryObservation";
BEGIN
  SELECT * INTO o FROM "DeliveryObservation" WHERE "assignmentId" = OLD."id";
  IF NOT FOUND THEN
    IF OLD."status" = 'OFFERED' AND NEW."status" = 'ACCEPTED' AND EXISTS (
      SELECT 1 FROM "ObservationEpoch" e WHERE e."closedAt" IS NULL
      AND OLD."createdAt" >= e."activatedAt" AND OLD."assignedAt" >= e."activatedAt"
      AND OLD."offerExpiresAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "DeliveryEvent" WHERE "assignmentId" = OLD."id"
        AND "eventType" IN ('RIDER_ACCEPTED', 'FAILED_DELIVERY', 'DELIVERED', 'CANCELLED', 'REASSIGNED'))
    ) THEN RAISE EXCEPTION 'Covered acceptance requires observation writer'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."orderId" <> OLD."orderId" OR NEW."riderId" <> OLD."riderId"
    OR NEW."assignedAt" <> OLD."assignedAt" OR NEW."offerExpiresAt" IS DISTINCT FROM OLD."offerExpiresAt"
    OR NEW."createdAt" <> OLD."createdAt" THEN RAISE EXCEPTION 'Immutable observation linkage'; END IF;
  IF OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" THEN
    RAISE EXCEPTION 'Immutable observation acceptance';
  END IF;
  IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN RETURN NEW; END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF (OLD."status" = 'OFFERED' AND NEW."status" = 'ACCEPTED') THEN
      IF o."writerAction" <> 'ACCEPT' OR o."writerTransaction" <> txid_current() OR NEW."acceptedAt" <> o."startedAt" THEN
        RAISE EXCEPTION 'Unserialized acceptance';
      END IF;
    ELSIF NEW."status" IN ('FAILED', 'DELIVERED') THEN
      IF o."writerTransaction" <> txid_current() OR o."writerAction" <> (CASE WHEN NEW."status" = 'FAILED' THEN 'FAIL' ELSE 'DELIVER' END)
        OR o."terminalEventId" IS NOT NULL THEN RAISE EXCEPTION 'Unserialized terminal transition'; END IF;
      IF NEW."status" = 'DELIVERED' AND NEW."deliveredAt" IS DISTINCT FROM o."lastSerializedAt" THEN RAISE EXCEPTION 'Unserialized delivery time'; END IF;
    ELSIF NOT ((OLD."status" = 'ACCEPTED' AND NEW."status" = 'PICKED_UP') OR
      (OLD."status" = 'PICKED_UP' AND NEW."status" = 'OUT_FOR_DELIVERY')) THEN
      RAISE EXCEPTION 'Unsupported assured intervention; invalidate capability before operational repair';
    END IF;
  ELSIF NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
    OR NEW."reassignedAt" IS DISTINCT FROM OLD."reassignedAt" THEN RAISE EXCEPTION 'Unrecorded assured timestamp mutation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_assignment_guard BEFORE UPDATE ON "DeliveryAssignment"
FOR EACH ROW EXECUTE FUNCTION observation_assignment_guard();

CREATE FUNCTION observation_event_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o "DeliveryObservation"; a "DeliveryAssignment";
BEGIN
  -- Even an old event writer must join the assignment serialization domain
  -- before deciding whether an observation exists. No pre-lock coverage read.
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM "DeliveryAssignment" WHERE "id" = NEW."assignmentId" FOR UPDATE;
  ELSE
    PERFORM 1 FROM "DeliveryAssignment" WHERE "id" = OLD."assignmentId" FOR UPDATE;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "DeliveryObservation" WHERE "assignmentId" = OLD."assignmentId") THEN
      RAISE EXCEPTION 'Covered delivery evidence is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  SELECT * INTO o FROM "DeliveryObservation" WHERE "assignmentId" = NEW."assignmentId" FOR UPDATE;
  IF NOT FOUND THEN
    IF NEW."eventType" IN ('FAILED_DELIVERY', 'DELIVERED', 'CANCELLED', 'REASSIGNED') AND EXISTS (
      SELECT 1 FROM "DeliveryObservation" d WHERE d."orderId" = NEW."orderId"
      AND NOT EXISTS (SELECT 1 FROM "ObservationInvalidation" i WHERE i."epochId" = d."epochId")
    ) THEN RAISE EXCEPTION 'Unlinked terminal evidence for assured order'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Cannot attach rewritten evidence'; END IF;
  SELECT * INTO a FROM "DeliveryAssignment" WHERE "id" = NEW."assignmentId";
  IF NEW."orderId" <> o."orderId" OR NEW."riderId" IS DISTINCT FROM a."riderId" THEN RAISE EXCEPTION 'Observation event linkage mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN RETURN NEW; END IF;
  IF NEW."eventType" IN ('RIDER_ACCEPTED', 'FAILED_DELIVERY', 'DELIVERED') THEN
    IF o."writerTransaction" <> txid_current() OR NEW."occurredAt" <> o."lastSerializedAt" THEN RAISE EXCEPTION 'Unserialized observation event'; END IF;
    IF NEW."eventType" = 'RIDER_ACCEPTED' THEN
      IF o."writerAction" <> 'ACCEPT' OR o."acceptanceEventId" IS NOT NULL OR NEW."occurredAt" <> o."startedAt" THEN RAISE EXCEPTION 'Duplicate or invalid acceptance evidence'; END IF;
      UPDATE "DeliveryObservation" SET "acceptanceEventId" = NEW."id" WHERE "id" = o."id";
    ELSE
      IF o."terminalEventId" IS NOT NULL OR o."writerAction" <> (CASE WHEN NEW."eventType" = 'FAILED_DELIVERY' THEN 'FAIL' ELSE 'DELIVER' END) THEN RAISE EXCEPTION 'Conflicting terminal evidence'; END IF;
      IF NEW."eventType" = 'FAILED_DELIVERY' AND (
        NEW."metadata"->'requiresManualReview' IS DISTINCT FROM 'true'::jsonb
        OR NEW."metadata"->>'orderStatusAtFailure' IS DISTINCT FROM (SELECT "status"::text FROM "Order" WHERE "id" = o."orderId")
      ) THEN RAISE EXCEPTION 'Invalid failure evidence'; END IF;
      UPDATE "DeliveryObservation" SET "terminalEventId" = NEW."id", "terminalAt" = NEW."occurredAt",
        "terminalKind" = CASE WHEN NEW."eventType" = 'FAILED_DELIVERY' THEN 'TARGET_FAILURE' ELSE 'ABSORBING_SUCCESS' END
        WHERE "id" = o."id";
    END IF;
  ELSIF NEW."eventType" IN ('CANCELLED', 'REASSIGNED') THEN
    RAISE EXCEPTION 'No supported assured censor writer; invalidate before repair';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_event_guard BEFORE INSERT OR UPDATE OR DELETE ON "DeliveryEvent"
FOR EACH ROW EXECUTE FUNCTION observation_event_guard();

-- Deferred checks prevent committing an anchor or terminal transition without
-- the corresponding business event, even when writes bypass service functions.
CREATE FUNCTION observation_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o "DeliveryObservation"; a "DeliveryAssignment"; status_text text;
BEGIN
  SELECT * INTO o FROM "DeliveryObservation" WHERE "assignmentId" = NEW."assignmentId";
  IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN RETURN NULL; END IF;
  SELECT * INTO a FROM "DeliveryAssignment" WHERE "id" = o."assignmentId";
  IF a."acceptedAt" IS DISTINCT FROM o."startedAt" OR o."acceptanceEventId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "DeliveryEvent" WHERE "id" = o."acceptanceEventId" AND "assignmentId" = a."id"
      AND "eventType" = 'RIDER_ACCEPTED' AND "occurredAt" = o."startedAt"
  ) THEN RAISE EXCEPTION 'Incomplete assured acceptance'; END IF;
  IF a."status" IN ('FAILED', 'DELIVERED') AND o."terminalEventId" IS NULL THEN RAISE EXCEPTION 'Missing terminal evidence'; END IF;
  IF o."terminalEventId" IS NOT NULL THEN
    status_text := CASE WHEN o."terminalKind" = 'TARGET_FAILURE' THEN 'FAILED' ELSE 'DELIVERED' END;
    IF a."status"::text <> status_text OR NOT EXISTS (SELECT 1 FROM "DeliveryEvent" WHERE "id" = o."terminalEventId"
      AND "assignmentId" = a."id" AND "occurredAt" = o."terminalAt") THEN RAISE EXCEPTION 'Inconsistent terminal evidence'; END IF;
    IF status_text = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "Order" WHERE "id" = o."orderId"
      AND "status" = 'DELIVERED' AND "completedAt" = o."terminalAt") THEN RAISE EXCEPTION 'Inconsistent delivery completion'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER observation_consistency AFTER INSERT OR UPDATE ON "DeliveryObservation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION observation_consistency();

CREATE FUNCTION observation_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o "DeliveryObservation";
BEGIN
  FOR o IN SELECT * FROM "DeliveryObservation" WHERE "orderId" = OLD."id" ORDER BY "assignmentId" LOOP
    IF EXISTS (SELECT 1 FROM "ObservationInvalidation" WHERE "epochId" = o."epochId") THEN CONTINUE; END IF;
    IF NEW."fulfillmentMethod" IS DISTINCT FROM OLD."fulfillmentMethod" OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
      RAISE EXCEPTION 'Unrecorded assured order intervention';
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
      (OLD."status" = 'READY_FOR_PICKUP' AND NEW."status" = 'RIDER_ASSIGNED') OR
      (OLD."status" = 'RIDER_ASSIGNED' AND NEW."status" = 'PICKED_UP') OR
      (OLD."status" = 'PICKED_UP' AND NEW."status" = 'OUT_FOR_DELIVERY') OR
      (OLD."status" = 'OUT_FOR_DELIVERY' AND NEW."status" = 'DELIVERED' AND
        o."writerTransaction" = txid_current() AND o."writerAction" = 'DELIVER' AND NEW."completedAt" = o."lastSerializedAt"
        AND EXISTS (SELECT 1 FROM "DeliveryAssignment" WHERE "id" = o."assignmentId" AND "status" = 'DELIVERED'))
    ) THEN RAISE EXCEPTION 'Unsupported assured order transition'; END IF;
    IF NEW."completedAt" IS DISTINCT FROM OLD."completedAt" AND NOT (
      NEW."status" = 'DELIVERED' AND o."writerTransaction" = txid_current() AND NEW."completedAt" = o."lastSerializedAt"
    ) THEN RAISE EXCEPTION 'Unrecorded assured completion time'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_order_guard BEFORE UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION observation_order_guard();
