import { Router } from "express";

import { getMe, updateMe } from "../controllers/user.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { updateUserProfileSchema } from "../validators/user.schemas.js";

export const userRoutes = Router();

userRoutes.get("/me", authenticate, getMe);
userRoutes.patch(
  "/me",
  authenticate,
  validateRequest(updateUserProfileSchema),
  updateMe,
);
