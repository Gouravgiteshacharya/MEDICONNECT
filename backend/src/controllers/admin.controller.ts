import type { Request, Response } from "express";
import { getAdminOrder, listAdminOrders } from "../services/admin.service.js";
import type { AdminOrderListQuery } from "../validators/admin.schemas.js";
import { getAdminPharmacy, listAdminInventory, listAdminPharmacies } from "../services/admin.service.js";
import type { AdminInventoryListQuery, AdminPharmacyListQuery } from "../validators/admin.schemas.js";

export async function listPharmacies(req: Request, res: Response) {
  res.status(200).json(await listAdminPharmacies(req.query as unknown as AdminPharmacyListQuery));
}
export async function getPharmacy(req: Request, res: Response) {
  res.status(200).json({ pharmacy: await getAdminPharmacy(req.params.pharmacyId as string) });
}
export async function listInventory(req: Request, res: Response) {
  res.status(200).json(await listAdminInventory(req.query as unknown as AdminInventoryListQuery));
}

export async function listOrders(req: Request, res: Response) {
  res.status(200).json(await listAdminOrders(req.query as unknown as AdminOrderListQuery));
}
export async function getOrder(req: Request, res: Response) {
  res.status(200).json({ order: await getAdminOrder(req.params.orderId as string) });
}
