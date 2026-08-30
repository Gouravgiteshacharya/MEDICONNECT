import type { AuthenticatedUser } from "../auth/authenticator.js";
declare global { namespace Express { interface Request { auth?: AuthenticatedUser; } } }
export {};
