import type { RequestHandler } from "express";
export type { UserRole } from "../../generated/prisma/client.js";
/** Injectable middleware seam for route-level tests; production uses Platform Core's authenticate middleware. */
export type Authenticator = RequestHandler;
