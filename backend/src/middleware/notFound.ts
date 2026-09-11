import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../utils/ApiError.js";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "Route not found.", "ROUTE_NOT_FOUND"));
}
