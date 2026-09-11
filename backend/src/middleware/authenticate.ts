import type { NextFunction, Request, Response } from "express";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyAuthToken } from "../utils/jwt.js";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const authorization = req.header("Authorization");

    if (!authorization) {
      throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
    }

    const [scheme, token, extra] = authorization.split(" ");

    if (scheme !== "Bearer" || !token || extra) {
      throw new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
    }

    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });

    if (!user) {
      throw new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
    }

    if (!user.isActive) {
      throw new ApiError(401, "Account is inactive.", "ACCOUNT_INACTIVE");
    }

    req.user = {
      id: user.id,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}
