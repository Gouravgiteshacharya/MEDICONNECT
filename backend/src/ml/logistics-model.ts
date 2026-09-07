export interface LogisticsFeatures { riderDistanceKm: number; workload: number; customerDistanceKm: number; peakHour: 0 | 1; batched: 0 | 1; }
export interface LogisticsPrediction { predictedCompletionMinutes: number; modelVersion: string; }
export interface LogisticsModel {
  predictDispatch(features: LogisticsFeatures): LogisticsPrediction;
  predictEta(features: LogisticsFeatures): LogisticsPrediction;
}
export function isPeakHour(date: Date, timezoneOffsetMinutes = 330): 0 | 1 { const hour = new Date(date.getTime() + timezoneOffsetMinutes * 60_000).getUTCHours(); return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21) ? 1 : 0; }
