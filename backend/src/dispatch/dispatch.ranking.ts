export interface RankedCandidate { riderId: string; distanceKm: number; workload: number; score: number; }
export function rankDispatchCandidates(candidates: Omit<RankedCandidate, "score">[], workloadPenaltyKm: number): RankedCandidate[] {
  return candidates.map((candidate) => ({ ...candidate, score: candidate.distanceKm + candidate.workload * workloadPenaltyKm }))
    .sort((a, b) => a.score - b.score || a.distanceKm - b.distanceKm || a.workload - b.workload || a.riderId.localeCompare(b.riderId));
}
