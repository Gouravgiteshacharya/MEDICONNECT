import type { Request, Response } from "express";

import {
  getCurrentUser,
  loginCustomer,
  registerCustomer,
} from "../services/auth.service.js";

export async function register(req: Request, res: Response) {
  const result = await registerCustomer(req.body);

  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await loginCustomer(req.body);

  res.status(200).json(result);
}

export async function me(req: Request, res: Response) {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const user = await getCurrentUser(userId);

  res.status(200).json({ user });
}
