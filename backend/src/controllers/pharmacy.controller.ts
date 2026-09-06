import type { Request, Response } from "express";

import {
  getOperationalPharmacyProfile,
  getPublicPharmacyProfile,
  updateOperationalPharmacyProfile,
} from "../services/pharmacy.service.js";

function authenticatedUserId(req: Request) {
  return req.user!.id;
}

function requestedPharmacyId(req: Request) {
  return req.params.pharmacyId as string;
}

export async function getPublicProfile(req: Request, res: Response) {
  const pharmacy = await getPublicPharmacyProfile(requestedPharmacyId(req));
  res.status(200).json({ pharmacy });
}

export async function getOperationalProfile(req: Request, res: Response) {
  const pharmacy = await getOperationalPharmacyProfile(
    authenticatedUserId(req),
    requestedPharmacyId(req),
  );
  res.status(200).json({ pharmacy });
}

export async function updateOperationalProfile(req: Request, res: Response) {
  const pharmacy = await updateOperationalPharmacyProfile(
    authenticatedUserId(req),
    requestedPharmacyId(req),
    req.body,
  );
  res.status(200).json({ pharmacy });
}
