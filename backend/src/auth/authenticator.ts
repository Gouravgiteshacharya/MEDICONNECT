import type { RequestHandler } from "express";
export type UserRole = "CUSTOMER" | "PHARMACY_STAFF" | "DELIVERY_PARTNER" | "ADMIN";
export interface AuthenticatedUser { userId: string; role: UserRole; }
/** Replace with the auth owner's JWT middleware, which must verify the token and set req.auth. */
export type Authenticator = RequestHandler;
export const unconfiguredAuthenticator: Authenticator = (_req, _res, next) => {
  const error = Object.assign(new Error("Authentication integration is not configured"), {
    status: 503, code: "AUTH_NOT_CONFIGURED",
  });
  next(error);
};
