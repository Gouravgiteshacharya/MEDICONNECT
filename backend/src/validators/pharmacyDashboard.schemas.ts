import { z } from "zod";

export const pharmacyDashboardQuerySchema = z.object({}).strict();

export type PharmacyDashboardQuery = z.infer<
  typeof pharmacyDashboardQuerySchema
>;
