import { UserRole } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type { LoginInput, RegisterInput } from "../validators/auth.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { signAuthToken } from "../utils/jwt.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import { isUniqueConstraintError } from "../utils/prismaErrors.js";

type AuthUserRecord = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
};

type SafeUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
};

export type AuthResponse = {
  token: string;
  user: SafeUser;
};

export type AuthDataSource = {
  user: {
    create(args: {
      data: {
        name: string;
        email: string;
        phone?: string;
        passwordHash: string;
        role: UserRole;
      };
      select: AuthUserSelect;
    }): Promise<AuthUserRecord>;
    findUnique(args: {
      where: { email: string } | { id: string };
      select: AuthUserSelect;
    }): Promise<AuthUserRecord | null>;
  };
};

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  passwordHash: true,
  role: true,
  isActive: true,
} satisfies AuthUserSelect;

type AuthUserSelect = {
  id: true;
  name: true;
  email: true;
  phone: true;
  passwordHash: true;
  role: true;
  isActive: true;
};

function toSafeUser(user: AuthUserRecord): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

function buildAuthResponse(user: AuthUserRecord): AuthResponse {
  return {
    token: signAuthToken({
      userId: user.id,
      role: user.role,
    }),
    user: toSafeUser(user),
  };
}

export async function registerCustomer(
  input: RegisterInput,
  dataSource: AuthDataSource = prisma,
): Promise<AuthResponse> {
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await dataSource.user.create({
      data: {
        name: input.name,
        email: input.email,
        ...(input.phone ? { phone: input.phone } : {}),
        passwordHash,
        role: UserRole.CUSTOMER,
      },
      select: safeUserSelect,
    });

    return buildAuthResponse(user);
  } catch (error) {
    if (isUniqueConstraintError(error, "email")) {
      throw new ApiError(
        409,
        "An account with this email already exists.",
        "EMAIL_ALREADY_EXISTS",
      );
    }

    if (isUniqueConstraintError(error, "phone")) {
      throw new ApiError(
        409,
        "An account with this phone already exists.",
        "PHONE_ALREADY_EXISTS",
      );
    }

    throw error;
  }
}

export async function loginCustomer(
  input: LoginInput,
  dataSource: AuthDataSource = prisma,
): Promise<AuthResponse> {
  const invalidCredentialsError = new ApiError(
    401,
    "Invalid email or password.",
    "INVALID_CREDENTIALS",
  );

  const user = await dataSource.user.findUnique({
    where: { email: input.email },
    select: safeUserSelect,
  });

  if (!user) {
    throw invalidCredentialsError;
  }

  const passwordMatches = await comparePassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw invalidCredentialsError;
  }

  if (!user.isActive) {
    throw new ApiError(401, "Account is inactive.", "ACCOUNT_INACTIVE");
  }

  return buildAuthResponse(user);
}

export async function getCurrentUser(
  userId: string,
  dataSource: AuthDataSource = prisma,
): Promise<SafeUser> {
  const user = await dataSource.user.findUnique({
    where: { id: userId },
    select: safeUserSelect,
  });

  if (!user) {
    throw new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
  }

  if (!user.isActive) {
    throw new ApiError(401, "Account is inactive.", "ACCOUNT_INACTIVE");
  }

  return toSafeUser(user);
}
