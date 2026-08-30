import type { RequestHandler } from "express";
import type { UserRole } from "../auth/authenticator.js";
import { ApiError } from "./errors.js";
export const requireAuthentication: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new ApiError(401, "Authentication required", "UNAUTHENTICATED"));
  next();
};
export const requireRole = (role: UserRole): RequestHandler => (req, _res, next) => {
  if (req.auth?.role !== role) return next(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
  next();
};
