export interface DispatchConfig { maxCandidates: number; maxRadiusKm: number; workloadPenaltyKm: number; }
export function loadDispatchConfig(environment: NodeJS.ProcessEnv = process.env): DispatchConfig {
  const maxCandidates = Number(environment.DISPATCH_MAX_CANDIDATES ?? 10);
  const maxRadiusKm = Number(environment.DISPATCH_MAX_RADIUS_KM ?? 15);
  const workloadPenaltyKm = Number(environment.DISPATCH_WORKLOAD_PENALTY_KM ?? 2);
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) throw new Error("DISPATCH_MAX_CANDIDATES must be a positive integer");
  if (!Number.isFinite(maxRadiusKm) || maxRadiusKm <= 0) throw new Error("DISPATCH_MAX_RADIUS_KM must be positive");
  if (!Number.isFinite(workloadPenaltyKm) || workloadPenaltyKm < 0) throw new Error("DISPATCH_WORKLOAD_PENALTY_KM must be non-negative");
  return { maxCandidates, maxRadiusKm, workloadPenaltyKm };
}
