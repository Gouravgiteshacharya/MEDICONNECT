import type { ErrorRequestHandler, RequestHandler } from "express";
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) { super(message); }
}
export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError(404, "Route not found", "NOT_FOUND"));
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON request body", code: "INVALID_JSON" });
    return;
  }
  const status = error instanceof ApiError ? error.status : Number(error?.status) || 500;
  const code = error instanceof ApiError ? error.code : error?.code || "INTERNAL_ERROR";
  const message = status >= 500 && code === "INTERNAL_ERROR" ? "Internal server error" : error?.message || "Internal server error";
  res.status(status).json({ error: message, code });
};
