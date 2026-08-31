export interface BatchConfig { maxAssignments: number; maxPharmacySeparationKm: number; maxDropoffSeparationKm: number; maxEstimatedDetourMinutes: number; assumedSpeedKmh: number; }
export function loadBatchConfig(environment: NodeJS.ProcessEnv = process.env): BatchConfig {
  const maxAssignments = Number(environment.BATCH_MAX_ASSIGNMENTS ?? 2), maxPharmacySeparationKm = Number(environment.BATCH_MAX_PHARMACY_SEPARATION_KM ?? 3), maxDropoffSeparationKm = Number(environment.BATCH_MAX_DROPOFF_SEPARATION_KM ?? 3), maxEstimatedDetourMinutes = Number(environment.BATCH_MAX_ESTIMATED_DETOUR_MINUTES ?? 15), assumedSpeedKmh = Number(environment.BATCH_ASSUMED_SPEED_KMH ?? 20);
  if (!Number.isInteger(maxAssignments) || maxAssignments !== 2) throw new Error("BATCH_MAX_ASSIGNMENTS must be 2 for the current implementation");
  if (!Number.isFinite(maxPharmacySeparationKm) || maxPharmacySeparationKm <= 0) throw new Error("BATCH_MAX_PHARMACY_SEPARATION_KM must be positive");
  if (!Number.isFinite(maxDropoffSeparationKm) || maxDropoffSeparationKm <= 0) throw new Error("BATCH_MAX_DROPOFF_SEPARATION_KM must be positive");
  if (!Number.isFinite(maxEstimatedDetourMinutes) || maxEstimatedDetourMinutes <= 0) throw new Error("BATCH_MAX_ESTIMATED_DETOUR_MINUTES must be positive");
  if (!Number.isFinite(assumedSpeedKmh) || assumedSpeedKmh <= 0) throw new Error("BATCH_ASSUMED_SPEED_KMH must be positive");
  return { maxAssignments, maxPharmacySeparationKm, maxDropoffSeparationKm, maxEstimatedDetourMinutes, assumedSpeedKmh };
}
