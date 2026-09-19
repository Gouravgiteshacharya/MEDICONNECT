import { Router } from "express";

import { login, me, register } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authLoginRateLimit, authRegisterRateLimit } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { loginSchema, registerSchema } from "../validators/auth.schemas.js";

export const authRoutes = Router();

authRoutes.post("/register", authRegisterRateLimit, validateRequest(registerSchema), register);
authRoutes.post("/login", authLoginRateLimit, validateRequest(loginSchema), login);
authRoutes.get("/me", authenticate, me);
