import jwt, { type JwtPayload } from "jsonwebtoken";

import { UserRole } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";
import { ApiError } from "./ApiError.js";

type SignAuthTokenInput = {
  userId: string;
  role: UserRole;
};

export type AuthTokenPayload = JwtPayload & {
  sub: string;
  role: UserRole;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUserRole(value: unknown): value is UserRole {
  return Object.values(UserRole).includes(value as UserRole);
}

export function signAuthToken(input: SignAuthTokenInput) {
  return jwt.sign(
    {
      role: input.role,
    },
    env.jwtSecret,
    {
      algorithm: "HS256",
      expiresIn: env.jwtExpiresIn,
      subject: input.userId,
    },
  );
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      !uuidRegex.test(payload.sub) ||
      !isUserRole(payload.role)
    ) {
      throw new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
    }

    return payload as AuthTokenPayload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
  }
}
