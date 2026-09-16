import "dotenv/config";

import {
  DeliveryPartnerAvailability,
  PharmacyStaffRole,
  UserRole,
  VehicleType,
  type UserRole as UserRoleValue,
  type VehicleType as VehicleTypeValue,
} from "../../generated/prisma/client.js";
import { hashPassword } from "../utils/password.js";

const REQUIRED_ENV_VARS = [
  "STAGING_ADMIN_EMAIL",
  "STAGING_ADMIN_PASSWORD",
  "STAGING_PHARMACY_EMAIL",
  "STAGING_PHARMACY_PASSWORD",
  "STAGING_RIDER_EMAIL",
  "STAGING_RIDER_PASSWORD",
  "STAGING_PHARMACY_ID",
  "STAGING_RIDER_VEHICLE_TYPE",
] as const;

const PHARMACY_STAFF_ROLE = PharmacyStaffRole.OWNER;

type AccountInput = {
  email: string;
  name: string;
  password: string;
  role: UserRoleValue;
};

type HashedAccountInput = Omit<AccountInput, "password"> & {
  passwordHash: string;
};

function refuse(message: string): never {
  console.error(`Refusing to provision staging accounts: ${message}`);
  process.exit(1);
}

function requireSafetyGuards() {
  if (process.env.ALLOW_STAGING_PROVISION !== "true") {
    refuse("set ALLOW_STAGING_PROVISION=true to acknowledge this staging-only database mutation.");
  }

  if (process.env.NODE_ENV === "production") {
    refuse("NODE_ENV=production is not allowed.");
  }
}

function requiredEnv(name: (typeof REQUIRED_ENV_VARS)[number]): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalName(name: string, fallback: string): string {
  const value = process.env[name]?.trim();

  return value && value.length > 0 ? value : fallback;
}

function parseVehicleType(value: string): VehicleTypeValue {
  const vehicleTypes = Object.values(VehicleType);

  if (!vehicleTypes.includes(value as VehicleTypeValue)) {
    throw new Error(
      `STAGING_RIDER_VEHICLE_TYPE must be one of: ${vehicleTypes.join(", ")}`,
    );
  }

  return value as VehicleTypeValue;
}

function readInputs() {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name];

    return !value || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    admin: {
      email: requiredEnv("STAGING_ADMIN_EMAIL").trim().toLowerCase(),
      name: optionalName("STAGING_ADMIN_NAME", "MediConnect Staging Admin"),
      password: requiredEnv("STAGING_ADMIN_PASSWORD"),
      role: UserRole.ADMIN,
    },
    pharmacy: {
      email: requiredEnv("STAGING_PHARMACY_EMAIL").trim().toLowerCase(),
      name: optionalName(
        "STAGING_PHARMACY_NAME",
        "MediConnect Staging Pharmacy Staff",
      ),
      password: requiredEnv("STAGING_PHARMACY_PASSWORD"),
      role: UserRole.PHARMACY_STAFF,
    },
    rider: {
      email: requiredEnv("STAGING_RIDER_EMAIL").trim().toLowerCase(),
      name: optionalName("STAGING_RIDER_NAME", "MediConnect Staging Rider"),
      password: requiredEnv("STAGING_RIDER_PASSWORD"),
      role: UserRole.DELIVERY_PARTNER,
    },
    pharmacyId: requiredEnv("STAGING_PHARMACY_ID").trim(),
    riderVehicleType: parseVehicleType(
      requiredEnv("STAGING_RIDER_VEHICLE_TYPE").trim(),
    ),
  } satisfies {
    admin: AccountInput;
    pharmacy: AccountInput;
    rider: AccountInput;
    pharmacyId: string;
    riderVehicleType: VehicleTypeValue;
  };
}

async function hashAccount(input: AccountInput): Promise<HashedAccountInput> {
  return {
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
  };
}

async function main() {
  requireSafetyGuards();

  const inputs = readInputs();
  const [admin, pharmacyStaff, rider] = await Promise.all([
    hashAccount(inputs.admin),
    hashAccount(inputs.pharmacy),
    hashAccount(inputs.rider),
  ]);

  const { prisma } = await import("../lib/prisma.js");

  try {
    await prisma.$transaction(async (transaction) => {
      async function upsertRoleUser(account: HashedAccountInput) {
        const existing = await transaction.user.findUnique({
          where: { email: account.email },
          select: { id: true, email: true, role: true },
        });

        if (existing && existing.role !== account.role) {
          throw new Error(
            `User ${account.email} already exists with role ${existing.role}; refusing to change it to ${account.role}.`,
          );
        }

        if (existing) {
          return transaction.user.update({
            where: { id: existing.id },
            data: {
              name: account.name,
              passwordHash: account.passwordHash,
              isActive: true,
            },
            select: { id: true, email: true, role: true },
          });
        }

        return transaction.user.create({
          data: {
            name: account.name,
            email: account.email,
            passwordHash: account.passwordHash,
            role: account.role,
            isActive: true,
          },
          select: { id: true, email: true, role: true },
        });
      }

      const pharmacy = await transaction.pharmacy.findUnique({
        where: { id: inputs.pharmacyId },
        select: { id: true, name: true, isActive: true },
      });

      if (!pharmacy) {
        throw new Error(
          `Pharmacy ${inputs.pharmacyId} was not found; set STAGING_PHARMACY_ID to an existing pharmacy.`,
        );
      }

      if (!pharmacy.isActive) {
        throw new Error(
          `Pharmacy ${inputs.pharmacyId} is inactive; choose an active pharmacy.`,
        );
      }

      const adminUser = await upsertRoleUser(admin);
      const pharmacyUser = await upsertRoleUser(pharmacyStaff);
      const riderUser = await upsertRoleUser(rider);

      const existingMemberships = await transaction.pharmacyStaff.findMany({
        where: { userId: pharmacyUser.id },
        select: { pharmacyId: true },
      });
      const differentMembership = existingMemberships.find(
        (membership) => membership.pharmacyId !== inputs.pharmacyId,
      );

      if (differentMembership) {
        throw new Error(
          `User ${pharmacyUser.email} already has a pharmacy membership for ${differentMembership.pharmacyId}; refusing to reassign to ${inputs.pharmacyId}.`,
        );
      }

      await transaction.pharmacyStaff.upsert({
        where: {
          userId_pharmacyId: {
            userId: pharmacyUser.id,
            pharmacyId: inputs.pharmacyId,
          },
        },
        update: {
          role: PHARMACY_STAFF_ROLE,
          isActive: true,
        },
        create: {
          userId: pharmacyUser.id,
          pharmacyId: inputs.pharmacyId,
          role: PHARMACY_STAFF_ROLE,
          isActive: true,
        },
      });

      const existingRiderProfile =
        await transaction.deliveryPartner.findUnique({
          where: { userId: riderUser.id },
          select: {
            id: true,
            vehicleType: true,
            isActive: true,
          },
        });

      if (existingRiderProfile) {
        if (existingRiderProfile.vehicleType !== inputs.riderVehicleType) {
          throw new Error(
            `Rider profile for ${riderUser.email} already uses vehicle type ${existingRiderProfile.vehicleType}; refusing to overwrite it with ${inputs.riderVehicleType}.`,
          );
        }

        if (!existingRiderProfile.isActive) {
          throw new Error(
            `Rider profile for ${riderUser.email} is inactive; refusing to reactivate it silently.`,
          );
        }
      } else {
        await transaction.deliveryPartner.create({
          data: {
            userId: riderUser.id,
            vehicleType: inputs.riderVehicleType,
            availability: DeliveryPartnerAvailability.OFFLINE,
            isActive: true,
          },
        });
      }

      console.log("Staging privileged accounts are ready:");
      console.log(`- ADMIN: ${adminUser.email}`);
      console.log(
        `- PHARMACY_STAFF: ${pharmacyUser.email} (${PHARMACY_STAFF_ROLE}) for ${pharmacy.name}`,
      );
      console.log(
        `- DELIVERY_PARTNER: ${riderUser.email} (${inputs.riderVehicleType}, ${DeliveryPartnerAvailability.OFFLINE} on create)`,
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error.";

  console.error(`Failed to provision staging accounts: ${message}`);
  process.exitCode = 1;
});
