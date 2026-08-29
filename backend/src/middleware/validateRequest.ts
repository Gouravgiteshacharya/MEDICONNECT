import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ZodError } from "zod";

import { ApiError } from "../utils/ApiError.js";

export function validateRequest<TBody>(schema: ZodType<TBody>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ApiError(400, "Invalid request body.", "VALIDATION_ERROR"));
        return;
      }

      next(error);
    }
  };
}
