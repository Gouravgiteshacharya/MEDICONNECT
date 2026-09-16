import { validateRiskDetection } from "./risk.evidence.js";
import { validateLifecycle, type OperationalRiskRepository } from "./risk.repository.js";
import type { OperationalRiskDetection, OperationalRiskLifecycleResult, RiskLifecycleInput, RiskOpenQuery, RiskPage } from "./risk.types.js";

/** Internal infrastructure only. Callers must authenticate/authorize actors before invoking. */
export class OperationalRiskService {
  constructor(private readonly repository: OperationalRiskRepository) {}

  getAdminById(id: string) { return this.repository.getAdminById(id); }
  listAdminOpen(query?: RiskOpenQuery) { return this.repository.listAdminOpen(query); }

  async recordDetection(input: OperationalRiskDetection) { return this.repository.createOrGetOccurrence(validateRiskDetection(input)); }
  getById(id: string) { return this.repository.getById(id); }
  listByOrder(orderId: string, page?: RiskPage) { return this.repository.listByOrder(orderId, page); }
  listOpen(query?: RiskOpenQuery) { return this.repository.listOpen(query); }

  acknowledgeAssessment(input: RiskLifecycleInput) { return this.transition(input, "ACKNOWLEDGED"); }
  resolveAssessment(input: RiskLifecycleInput) { return this.transition(input, "RESOLVED"); }
  dismissAssessment(input: RiskLifecycleInput) { return this.transition(input, "DISMISSED"); }

  private async transition(input: RiskLifecycleInput, targetStatus: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED"): Promise<OperationalRiskLifecycleResult> {
    const command = validateLifecycle({ ...input, expectedStatus: "OPEN", targetStatus });
    const current = await this.repository.getById(command.id);
    if (!current) return { status: "not_found" };
    return this.repository.updateLifecycle({ ...command, expectedStatus: current.status });
  }
}
