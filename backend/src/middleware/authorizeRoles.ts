import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../../generated/prisma/client.js";

import { ApiError } from "../utils/ApiError.js";

export function authorizeRoles(...allowedRoles: UserRole[]) {
  const allowedRoleSet = new Set(allowedRoles);

  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new ApiError(401, "Authentication required.", "AUTH_REQUIRED"));
      return;
    }

    if (!allowedRoleSet.has(req.user.role)) {
      next(
        new ApiError(
          403,
          "You do not have permission to perform this action.",
          "FORBIDDEN",
        ),
      );
      return;
    }

    next();
  };
}
