import { Router } from "express";

import {
  addCartItem,
  deleteCartItem,
  getCart,
  updateCartItem,
  updateCartFulfillment,
} from "../controllers/cart.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  addCartItemSchema,
  cartItemParamsSchema,
  updateCartFulfillmentSchema,
  updateCartItemQuantitySchema,
} from "../validators/cart.schemas.js";
import { UserRole } from "../../generated/prisma/client.js";

export const cartRoutes = Router();

cartRoutes.use(authenticate, authorizeRoles(UserRole.CUSTOMER));

cartRoutes.get("/", getCart);
cartRoutes.patch(
  "/",
  validateRequest(updateCartFulfillmentSchema),
  updateCartFulfillment,
);
cartRoutes.post("/items", validateRequest(addCartItemSchema), addCartItem);
cartRoutes.patch(
  "/items/:itemId",
  validateRequest({ params: cartItemParamsSchema }),
  validateRequest(updateCartItemQuantitySchema),
  updateCartItem,
);
cartRoutes.delete(
  "/items/:itemId",
  validateRequest({ params: cartItemParamsSchema }),
  deleteCartItem,
);
