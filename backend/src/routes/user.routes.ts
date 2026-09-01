import { Router } from "express";

import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from "../controllers/address.controller.js";
import { getMe, updateMe } from "../controllers/user.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  addressParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from "../validators/address.schemas.js";
import { updateUserProfileSchema } from "../validators/user.schemas.js";

export const userRoutes = Router();

userRoutes.get("/me", authenticate, getMe);
userRoutes.patch(
  "/me",
  authenticate,
  validateRequest(updateUserProfileSchema),
  updateMe,
);
userRoutes.get("/me/addresses", authenticate, listAddresses);
userRoutes.post(
  "/me/addresses",
  authenticate,
  validateRequest(createAddressSchema),
  createAddress,
);
userRoutes.patch(
  "/me/addresses/:addressId",
  validateRequest({ params: addressParamsSchema }),
  authenticate,
  validateRequest(updateAddressSchema),
  updateAddress,
);
userRoutes.delete(
  "/me/addresses/:addressId",
  validateRequest({ params: addressParamsSchema }),
  authenticate,
  deleteAddress,
);
