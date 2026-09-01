import { prisma } from "../lib/prisma.js";
import type {
  CreateAddressInput,
  UpdateAddressInput,
} from "../validators/address.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { isRecordNotFoundError } from "../utils/prismaErrors.js";

type AddressRecord = {
  id: string;
  userId?: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SafeAddress = Omit<AddressRecord, "userId">;

type AddressSelect = {
  id: true;
  label: true;
  addressLine1: true;
  addressLine2: true;
  landmark: true;
  city: true;
  state: true;
  postalCode: true;
  latitude: true;
  longitude: true;
  isDefault: true;
  createdAt: true;
  updatedAt: true;
};

type AddressOwnershipSelect = {
  id: true;
};

type AddressWriteData = {
  label?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
};

type AddressCreateData = AddressWriteData & {
  userId: string;
  label: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
};

type AddressOrderBy =
  | { isDefault: "desc" }
  | { updatedAt: "desc" }
  | { createdAt: "desc" }
  | { id: "asc" };

type AddressDelegateDataSource = {
  address: {
    count(args: { where: { userId: string } }): Promise<number>;
    findMany(args: {
      where: { userId: string };
      select: AddressSelect;
      orderBy: AddressOrderBy[];
    }): Promise<AddressRecord[]>;
    findFirst(args: {
      where: { id: string; userId: string };
      select: AddressOwnershipSelect;
    }): Promise<{ id: string } | null>;
    create(args: {
      data: AddressCreateData;
      select: AddressSelect;
    }): Promise<AddressRecord>;
    update(args: {
      where: { id: string };
      data: AddressWriteData;
      select: AddressSelect;
    }): Promise<AddressRecord>;
    updateMany(args: {
      where: { userId: string; id?: { not: string } };
      data: { isDefault: false };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }>;
  };
};

type AddressDataSource = AddressDelegateDataSource & {
  $transaction<T>(callback: (tx: AddressDelegateDataSource) => Promise<T>): Promise<T>;
};

const addressSelect = {
  id: true,
  label: true,
  addressLine1: true,
  addressLine2: true,
  landmark: true,
  city: true,
  state: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies AddressSelect;

const addressOrderBy = [
  { isDefault: "desc" },
  { updatedAt: "desc" },
  { createdAt: "desc" },
  { id: "asc" },
] satisfies AddressOrderBy[];

function addressNotFoundError() {
  return new ApiError(404, "Address not found.", "ADDRESS_NOT_FOUND");
}

function toSafeAddress(address: AddressRecord): SafeAddress {
  return {
    id: address.id,
    label: address.label,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

function buildAddressCreateData(
  userId: string,
  input: CreateAddressInput,
  isDefault: boolean,
): AddressCreateData {
  return {
    userId,
    label: input.label,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    landmark: input.landmark,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    latitude: input.latitude,
    longitude: input.longitude,
    isDefault,
  };
}

function buildAddressUpdateData(input: UpdateAddressInput): AddressWriteData {
  const data: AddressWriteData = {};

  if ("label" in input) {
    data.label = input.label;
  }

  if ("addressLine1" in input) {
    data.addressLine1 = input.addressLine1;
  }

  if ("addressLine2" in input) {
    data.addressLine2 = input.addressLine2;
  }

  if ("landmark" in input) {
    data.landmark = input.landmark;
  }

  if ("city" in input) {
    data.city = input.city;
  }

  if ("state" in input) {
    data.state = input.state;
  }

  if ("postalCode" in input) {
    data.postalCode = input.postalCode;
  }

  if ("latitude" in input) {
    data.latitude = input.latitude;
  }

  if ("longitude" in input) {
    data.longitude = input.longitude;
  }

  if ("isDefault" in input) {
    data.isDefault = input.isDefault;
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "Invalid request body.", "VALIDATION_ERROR");
  }

  return data;
}

async function ensureOwnedAddress(
  userId: string,
  addressId: string,
  dataSource: AddressDelegateDataSource,
) {
  const address = await dataSource.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true },
  });

  if (!address) {
    throw addressNotFoundError();
  }
}

function translateAddressMutationError(error: unknown): never {
  if (isRecordNotFoundError(error)) {
    throw addressNotFoundError();
  }

  throw error;
}

export async function listUserAddresses(
  userId: string,
  dataSource: AddressDataSource = prisma,
): Promise<SafeAddress[]> {
  const addresses = await dataSource.address.findMany({
    where: { userId },
    select: addressSelect,
    orderBy: addressOrderBy,
  });

  return addresses.map(toSafeAddress);
}

export async function createUserAddress(
  userId: string,
  input: CreateAddressInput,
  dataSource: AddressDataSource = prisma,
): Promise<SafeAddress> {
  if (input.isDefault !== false) {
    const address = await dataSource.$transaction(async (tx) => {
      const existingAddressCount = await tx.address.count({
        where: { userId },
      });
      const shouldBeDefault = input.isDefault ?? existingAddressCount === 0;

      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: buildAddressCreateData(userId, input, shouldBeDefault),
        select: addressSelect,
      });
    });

    return toSafeAddress(address);
  }

  const address = await dataSource.address.create({
    data: buildAddressCreateData(userId, input, false),
    select: addressSelect,
  });

  return toSafeAddress(address);
}

export async function updateUserAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput,
  dataSource: AddressDataSource = prisma,
): Promise<SafeAddress> {
  const data = buildAddressUpdateData(input);

  try {
    if (data.isDefault === true) {
      const address = await dataSource.$transaction(async (tx) => {
        await ensureOwnedAddress(userId, addressId, tx);

        await tx.address.updateMany({
          where: { userId, id: { not: addressId } },
          data: { isDefault: false },
        });

        return tx.address.update({
          where: { id: addressId },
          data,
          select: addressSelect,
        });
      });

      return toSafeAddress(address);
    }

    await ensureOwnedAddress(userId, addressId, dataSource);

    const address = await dataSource.address.update({
      where: { id: addressId },
      data,
      select: addressSelect,
    });

    return toSafeAddress(address);
  } catch (error) {
    translateAddressMutationError(error);
  }
}

export async function deleteUserAddress(
  userId: string,
  addressId: string,
  dataSource: AddressDataSource = prisma,
): Promise<void> {
  const result = await dataSource.address.deleteMany({
    where: { id: addressId, userId },
  });

  if (result.count === 0) {
    throw addressNotFoundError();
  }
}
