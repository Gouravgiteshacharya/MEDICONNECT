import { Router } from "express";
import type { Authenticator } from "../auth/authenticator.js";
import { requireAuthentication, requireRole } from "../middleware/authorization.js";
import type { BatchOptions, BatchStore } from "./batch.service.js";
import { createCompatibleBatch } from "./batch.service.js";
import { parseBatchInput } from "./batch.validation.js";
export function createBatchRouter(store: BatchStore, authenticate: Authenticator, options: BatchOptions): Router { const router = Router(); router.post("/evaluate", authenticate, requireAuthentication, requireRole("ADMIN"), async (req, res) => res.status(201).json({ data: await createCompatibleBatch(store, parseBatchInput(req.body), options) })); return router; }
