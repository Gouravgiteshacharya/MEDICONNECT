import type { ErrorRequestHandler } from "express";

import { ApiError } from "../utils/ApiError.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
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
