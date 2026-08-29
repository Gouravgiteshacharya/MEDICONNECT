import type { UserRole } from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import type { UpdateUserProfileInput } from "../validators/user.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
} from "../utils/prismaErrors.js";

type UserProfileRecord = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UserProfile = UserProfileRecord;

type UserProfileSelect = {
  id: true;
  name: true;
  email: true;
  phone: true;
  role: true;
  isActive: true;
  createdAt: true;
  updatedAt: true;
};

type UserProfileUpdateData = {
  name?: string;
  email?: string;
  phone?: string | null;
};

export type UserProfileDataSource = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: UserProfileSelect;
    }): Promise<UserProfileRecord | null>;
    update(args: {
      where: { id: string };
      data: UserProfileUpdateData;
      select: UserProfileSelect;
    }): Promise<UserProfileRecord>;
  };
};

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies UserProfileSelect;

function toUserProfile(user: UserProfileRecord): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function invalidCurrentUserError() {
  return new ApiError(401, "Invalid authentication token.", "INVALID_TOKEN");
}

function translateProfileUpdateError(error: unknown): never {
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

  if (isRecordNotFoundError(error)) {
    throw invalidCurrentUserError();
  }

  throw error;
}

export async function getUserProfile(
  userId: string,
  dataSource: UserProfileDataSource = prisma,
): Promise<UserProfile> {
  const user = await dataSource.user.findUnique({
    where: { id: userId },
    select: userProfileSelect,
  });

  if (!user) {
    throw invalidCurrentUserError();
  }

  return toUserProfile(user);
}

export async function updateUserProfile(
  userId: string,
  input: UpdateUserProfileInput,
  dataSource: UserProfileDataSource = prisma,
): Promise<UserProfile> {
  const data: UserProfileUpdateData = {};

  if ("name" in input) {
    data.name = input.name;
  }

  if ("email" in input) {
    data.email = input.email;
  }

  if ("phone" in input) {
    data.phone = input.phone;
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "Invalid request body.", "VALIDATION_ERROR");
  }

  try {
    const user = await dataSource.user.update({
      where: { id: userId },
      data,
      select: userProfileSelect,
    });

    return toUserProfile(user);
  } catch (error) {
    translateProfileUpdateError(error);
  }
}
