import type { ErrorRequestHandler } from "express";

import { ApiError } from "../utils/ApiError.js";

type RequestBodyError = {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
};

function isRequestBodyError(error: unknown, type: string, statusCode: number) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as RequestBodyError;

  return (
    candidate.type === type &&
    (candidate.status === statusCode || candidate.statusCode === statusCode)
  );
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isRequestBodyError(error, "entity.too.large", 413)) {
    res.status(413).json({
      error: "Request body is too large.",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }

  if (isRequestBodyError(error, "entity.parse.failed", 400)) {
    res.status(400).json({
      error: "Malformed JSON body.",
      code: "MALFORMED_JSON",
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }

  res.status(500).json({
    error: "Internal server error.",
    code: "INTERNAL_SERVER_ERROR",
  });
};
