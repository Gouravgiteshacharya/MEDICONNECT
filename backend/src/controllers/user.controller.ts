import type { Request, Response } from "express";

import {
  getUserProfile,
  updateUserProfile,
} from "../services/user.service.js";

export async function getMe(req: Request, res: Response) {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const user = await getUserProfile(userId);

  res.status(200).json({ user });
}

export async function updateMe(req: Request, res: Response) {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const user = await updateUserProfile(userId, req.body);

  res.status(200).json({ user });
}
