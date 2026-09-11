import type { Request, Response } from "express";

import {
  createUserAddress,
  deleteUserAddress,
  listUserAddresses,
  updateUserAddress,
} from "../services/address.service.js";

function getAuthenticatedUserId(req: Request, res: Response) {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
    });
    return null;
  }

  return userId;
}

function getAddressId(req: Request) {
  const { addressId } = req.params;

  return Array.isArray(addressId) ? addressId[0] : addressId;
}

export async function listAddresses(req: Request, res: Response) {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const addresses = await listUserAddresses(userId);

  res.status(200).json({ addresses });
}

export async function createAddress(req: Request, res: Response) {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const address = await createUserAddress(userId, req.body);

  res.status(201).json({ address });
}

export async function updateAddress(req: Request, res: Response) {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const address = await updateUserAddress(userId, getAddressId(req), req.body);

  res.status(200).json({ address });
}

export async function deleteAddress(req: Request, res: Response) {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  await deleteUserAddress(userId, getAddressId(req));

  res.status(204).send();
}
