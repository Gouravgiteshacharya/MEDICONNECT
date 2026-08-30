import type { PharmacyStaffRole } from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";

export type PharmacyMembershipContext = {
  id: string;
  userId: string;
  pharmacyId: string;
  role: PharmacyStaffRole;
};

type PharmacyMembershipSelect = {
  id: true;
  userId: true;
  pharmacyId: true;
  role: true;
};

export type PharmacyMembershipDataSource = {
  pharmacyStaff: {
    findFirst(args: {
      where: {
        userId: string;
        pharmacyId: string;
        isActive: true;
      };
      select: PharmacyMembershipSelect;
    }): Promise<PharmacyMembershipContext | null>;
  };
};

const pharmacyMembershipSelect = {
  id: true,
  userId: true,
  pharmacyId: true,
  role: true,
} satisfies PharmacyMembershipSelect;

function toPharmacyMembershipContext(
  membership: PharmacyMembershipContext,
): PharmacyMembershipContext {
  return {
    id: membership.id,
    userId: membership.userId,
    pharmacyId: membership.pharmacyId,
    role: membership.role,
  };
}

export async function getActivePharmacyMembership(
  userId: string,
  pharmacyId: string,
  dataSource: PharmacyMembershipDataSource = prisma,
): Promise<PharmacyMembershipContext | null> {
  const membership = await dataSource.pharmacyStaff.findFirst({
    where: {
      userId,
      pharmacyId,
      isActive: true,
    },
    select: pharmacyMembershipSelect,
  });

  return membership ? toPharmacyMembershipContext(membership) : null;
}
