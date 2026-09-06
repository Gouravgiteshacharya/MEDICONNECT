import type { Request, Response } from "express";

import {
  createPharmacyInventoryItem,
  getPharmacyInventoryItem,
  listPharmacyInventory,
  updatePharmacyInventoryItem,
} from "../services/inventory.service.js";
import type {
  CreateInventoryInput,
  InventoryListQuery,
  UpdateInventoryInput,
} from "../validators/inventory.schemas.js";

function userId(req: Request) {
  return req.user!.id;
}

function routeParam(req: Request, name: "pharmacyId" | "inventoryId") {
  return req.params[name] as string;
}

export async function listInventory(req: Request, res: Response) {
  const result = await listPharmacyInventory(
    userId(req),
    routeParam(req, "pharmacyId"),
    req.query as unknown as InventoryListQuery,
  );
  res.status(200).json(result);
}

export async function getInventoryItem(req: Request, res: Response) {
  const inventoryItem = await getPharmacyInventoryItem(
    userId(req),
    routeParam(req, "pharmacyId"),
    routeParam(req, "inventoryId"),
  );
  res.status(200).json({ inventoryItem });
}

export async function createInventoryItem(req: Request, res: Response) {
  const inventoryItem = await createPharmacyInventoryItem(
    userId(req),
    routeParam(req, "pharmacyId"),
    req.body as CreateInventoryInput,
  );
  res.status(201).json({ inventoryItem });
}

export async function updateInventoryItem(req: Request, res: Response) {
  const inventoryItem = await updatePharmacyInventoryItem(
    userId(req),
    routeParam(req, "pharmacyId"),
    routeParam(req, "inventoryId"),
    req.body as UpdateInventoryInput,
  );
  res.status(200).json({ inventoryItem });
}
