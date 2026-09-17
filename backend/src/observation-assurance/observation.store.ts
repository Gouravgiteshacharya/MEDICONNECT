/** Internal transaction adapter. No assurance values enter public DTOs. */
export interface ObservationTransaction {
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export const OBSERVATION_CONTRACT = "delivery-observation-v1";

async function query<T>(tx: ObservationTransaction, sql: string, ...values: unknown[]): Promise<T> {
  try { return await tx.$queryRawUnsafe!<T>(sql, ...values); }
  catch (error) {
    // Raw SQL can surface PostgreSQL transaction conflicts as P2010. Preserve
    // the domain services' existing three-attempt P2034 retry/error contract.
    const raw = error as { code?: string; meta?: { code?: string } } | null;
    if (raw?.code === "P2010" && (raw.meta?.code === "40001" || raw.meta?.code === "40P01")) {
      throw Object.assign(new Error("Observation serialization conflict", { cause: error }), { code: "P2034" });
    }
    throw error;
  }
}

/** PostgreSQL takes the episode lock before sampling its authoritative clock. */
export async function observationTime(
  tx: ObservationTransaction, assignmentId: string,
  action: "ACCEPT" | "FAIL" | "DELIVER", legacyTime: Date,
): Promise<Date> {
  // Existing injected stores without PostgreSQL capabilities remain legacy stores.
  if (!tx.$queryRawUnsafe) return legacyTime;
  const rows = await query<{ occurredAt: Date | null }[]>(tx,
    'SELECT public.observation_begin($1::uuid, $2::text, $3::text) AS "occurredAt"',
    assignmentId, action, OBSERVATION_CONTRACT,
  );
  if (rows.length !== 1) throw new Error("Invalid observation clock result");
  const time = rows[0].occurredAt;
  if (time === null) return legacyTime;
  if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new Error("Invalid observation clock");
  return time;
}

/** Explicit internal invocation only; caller supplies its existing transaction. */
export async function completeObservation(tx: ObservationTransaction, assignmentId: string): Promise<string> {
  if (!tx.$queryRawUnsafe) throw new Error("Observation completion requires PostgreSQL");
  const rows = await query<{ result: string }[]>(tx,
    'SELECT public.observation_complete($1::uuid, $2::text) AS result', assignmentId, OBSERVATION_CONTRACT,
  );
  if (rows.length !== 1) throw new Error("Invalid observation completion result");
  return rows[0].result;
}
