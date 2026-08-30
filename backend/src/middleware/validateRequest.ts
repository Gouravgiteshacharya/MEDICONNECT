import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ZodError } from "zod";

import { ApiError } from "../utils/ApiError.js";

type RequestValidationSchema = {
  body?: ZodType<unknown>;
  params?: ZodType<Record<string, string>>;
  query?: ZodType<unknown>;
};

function isZodSchema(
  schema: ZodType<unknown> | RequestValidationSchema,
): schema is ZodType<unknown> {
  return typeof (schema as ZodType<unknown>).parse === "function";
}

export function validateRequest(
  schema: ZodType<unknown> | RequestValidationSchema,
) {
  const schemas = isZodSchema(schema) ? { body: schema } : schema;

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query) as Request["query"];

        Object.defineProperty(req, "query", {
          configurable: true,
          enumerable: true,
          value: parsedQuery,
          writable: true,
        });
      }

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
