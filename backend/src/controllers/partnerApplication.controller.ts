import type { Request, Response } from "express";

import {
  approvePharmacyApplication,
  approveRiderApplication,
  createPharmacyPhotoAccess,
  getPharmacyApplication,
  getRiderApplication,
  listPharmacyApplications,
  listRiderApplications,
  recordFieldVisit,
  recordOfficeVerification,
  submitPharmacyApplication,
  submitRiderApplication,
  transitionPharmacyApplication,
  transitionRiderApplication,
} from "../services/partnerApplication.service.js";
import type {
  FieldVisitInput,
  OfficeVerificationInput,
  PharmacyApplicationInput,
  PharmacyApplicationListInput,
  PharmacyTransitionInput,
  RiderApplicationInput,
  RiderApplicationListInput,
  RiderTransitionInput,
} from "../validators/partnerApplication.schemas.js";

const applicationId = (req: Request) => req.params.applicationId as string;

export async function createPharmacyApplication(req: Request, res: Response) {
  const application = await submitPharmacyApplication(req.body as PharmacyApplicationInput, req.file);
  res.status(201).json({ application, message: "Application received. MediConnect will review your documents and arrange a field visit before activation." });
}

export async function createRiderApplication(req: Request, res: Response) {
  const application = await submitRiderApplication(req.body as RiderApplicationInput);
  res.status(201).json({ application, message: "Your application has been received. Before activation, you must complete an in-person verification at a MediConnect verification office. MediConnect will contact you with the nearest verification centre and appointment details." });
}

export async function adminListPharmacyApplications(req: Request, res: Response) {
  res.json(await listPharmacyApplications(req.query as unknown as PharmacyApplicationListInput));
}

export async function adminGetPharmacyApplication(req: Request, res: Response) {
  res.json({ application: await getPharmacyApplication(applicationId(req)) });
}

export async function adminListRiderApplications(req: Request, res: Response) {
  res.json(await listRiderApplications(req.query as unknown as RiderApplicationListInput));
}

export async function adminGetRiderApplication(req: Request, res: Response) {
  res.json({ application: await getRiderApplication(applicationId(req)) });
}

export async function adminTransitionPharmacyApplication(req: Request, res: Response) {
  res.json({ application: await transitionPharmacyApplication(applicationId(req), req.body as PharmacyTransitionInput) });
}

export async function adminTransitionRiderApplication(req: Request, res: Response) {
  res.json({ application: await transitionRiderApplication(applicationId(req), req.body as RiderTransitionInput) });
}

export async function adminRecordFieldVisit(req: Request, res: Response) {
  res.json({ verification: await recordFieldVisit(applicationId(req), req.user!.id, req.body as FieldVisitInput) });
}

export async function adminRecordOfficeVerification(req: Request, res: Response) {
  res.json({ verification: await recordOfficeVerification(applicationId(req), req.user!.id, req.body as OfficeVerificationInput) });
}

export async function adminApprovePharmacyApplication(req: Request, res: Response) {
  res.json(await approvePharmacyApplication(applicationId(req)));
}

export async function adminApproveRiderApplication(req: Request, res: Response) {
  res.json(await approveRiderApplication(applicationId(req)));
}

export async function adminGetPharmacyPhotoAccess(req: Request, res: Response) {
  const url = await createPharmacyPhotoAccess(applicationId(req));
  res.json({ documentAccess: { url, expiresAt: new Date(Date.now() + 300_000) } });
}
