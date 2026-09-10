import type {
  EtaPredictor,
  OperationalRiskLevel,
  OperationalRiskScorer,
  Prediction,
  RiderSuitabilityPredictor,
} from "./contracts.js";

export class DeterministicEtaPredictor implements EtaPredictor<{ distanceKm: number; averageSpeedKph: number }> {
  async predictEta(_input: { distanceKm: number; averageSpeedKph: number }): Promise<Prediction<{ minutes: number }>> {
    throw new PredictorUnavailableError("ETA prediction");
  }
}

export class DeterministicRiderSuitabilityPredictor implements RiderSuitabilityPredictor<{ distanceKm: number; activeAssignments: number }> {
  async predictSuitability(_input: { distanceKm: number; activeAssignments: number }): Promise<Prediction<{ score: number }>> {
    throw new PredictorUnavailableError("Rider suitability prediction");
  }
}

export interface OperationalRiskSignals {
  readonly cancellations: number;
  readonly failedDeliveries: number;
  readonly refunds: number;
  readonly complaints: number;
  readonly paymentFailures: number;
}

export class DeterministicOperationalRiskScorer implements OperationalRiskScorer<OperationalRiskSignals> {
  async scoreOperationalRisk(_input: OperationalRiskSignals): Promise<Prediction<{ score: number; level: OperationalRiskLevel; reviewRecommended: boolean }>> {
    throw new PredictorUnavailableError("Operational risk scoring");
  }
}

export class PredictorUnavailableError extends Error {
  readonly code = "unavailable" as const;

  constructor(predictor: string) {
    super(`${predictor} is not implemented in Milestone 1.`);
    this.name = "PredictorUnavailableError";
  }
}
