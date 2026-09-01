import { UserRole } from "../../generated/prisma/client.js";
import { authorizeRoles } from "./authorizeRoles.js";

const authenticatedRoles = Object.values(UserRole);

/** Compatibility names for Delivery routers; authorization is delegated to Platform Core. */
export const requireAuthentication = authorizeRoles(...authenticatedRoles);
export const requireRole = (role: UserRole) => authorizeRoles(role);
