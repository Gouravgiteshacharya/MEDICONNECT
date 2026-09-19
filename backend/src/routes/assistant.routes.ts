import { Router, type RequestHandler } from "express";

import { UserRole } from "../../generated/prisma/client.js";
import { createAssistantRespondController } from "../controllers/assistant.controller.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import type { AssistantResponder } from "../modules/intelligence-experience/contracts.js";
import { composeIntelligenceModule } from "../modules/intelligence-experience/composition.js";

export function createAssistantRoutes(
  authenticate: RequestHandler,
  assistant: AssistantResponder = composeIntelligenceModule(),
) {
  const router = Router();
  const respond = createAssistantRespondController(assistant);

  router.post(
    "/respond",
    authenticate,
    authorizeRoles(UserRole.CUSTOMER),
    respond,
  );

  return router;
}