import {
  OrderStatus,
  PharmacyStaffRole,
  PrescriptionStatus,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type {
  DecideOrderInput,
  ReviewPrescriptionInput,
} from "../validators/pharmacyWorkflow.schemas.js";
import {
  getActivePharmacyMembership,
  type PharmacyMembershipDataSource,
  type PharmacyMembershipContext,
} from "./pharmacyMembership.service.js";

export const MAX_PHARMACY_WORKFLOW_ATTEMPTS = 3;

type MembershipReader = (
  userId: string,
  pharmacyId: string,
  dataSource: PharmacyMembershipDataSource,
) => Promise<PharmacyMembershipContext | null>;
type WorkflowClock = () => Date;
type WorkflowTransactionClient = Pick<
  Prisma.TransactionClient,
  "order" | "pharmacyStaff" | "prescription"
>;

export type PharmacyWorkflowDataSource = Pick<
  PrismaClient,
  "order" | "prescription"
> & {
  $transaction<T>(
    callback: (tx: WorkflowTransactionClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
};

const pharmacyPrescriptionSelect = {
  id: true,
  orderId: true,
  fileUrl: true,
  originalFilename: true,
  status: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewerStaffId: true,
  reviewNotes: true,
  rejectionReason: true,
} satisfies Prisma.PrescriptionSelect;

const pharmacyOrderSelect = {
  id: true,
  orderNumber: true,
  pharmacyId: true,
  fulfillmentMethod: true,
  status: true,
  medicineSubtotal: true,
  deliveryFee: true,
  totalAmount: true,
  confirmedAt: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

function forbiddenError() {
  return new ApiError(403, "Forbidden.", "FORBIDDEN");
}

function prescriptionNotFoundError() {
  return new ApiError(
    404,
    "Prescription not found.",
    "PRESCRIPTION_NOT_FOUND",
  );
}

function prescriptionAlreadyFinalizedError() {
  return new ApiError(
    409,
    "The prescription review has already been finalized.",
    "PRESCRIPTION_ALREADY_FINALIZED",
  );
}

function prescriptionReviewNotAllowedError() {
  return new ApiError(
    409,
    "Prescription review is not allowed for this order.",
    "PRESCRIPTION_REVIEW_NOT_ALLOWED",
  );
}

function prescriptionReviewConflictError() {
  return new ApiError(
    409,
    "Prescription review changed during this request. Please try again.",
    "PRESCRIPTION_REVIEW_CONFLICT",
  );
}

function orderNotFoundError() {
  return new ApiError(404, "Order not found.", "ORDER_NOT_FOUND");
}

function orderDecisionNotAllowedError() {
  return new ApiError(
    409,
    "The requested order decision is not allowed in its current state.",
    "ORDER_DECISION_NOT_ALLOWED",
  );
}

function orderDecisionConflictError() {
  return new ApiError(
    409,
    "Order decision changed during this request. Please try again.",
    "ORDER_DECISION_CONFLICT",
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function requireMembership(
  userId: string,
  pharmacyId: string,
  allowedRoles: readonly PharmacyStaffRole[],
  membershipReader: MembershipReader,
  dataSource: PharmacyMembershipDataSource,
) {
  const membership = await membershipReader(userId, pharmacyId, dataSource);
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw forbiddenError();
  }
  return membership;
}

const reviewableStatuses: PrescriptionStatus[] = [
  PrescriptionStatus.PENDING_REVIEW,
  PrescriptionStatus.ADDITIONAL_INFO_REQUIRED,
];

function validateReviewState(
  prescription: {
    status: PrescriptionStatus;
    order: { status: OrderStatus };
  } | null,
) {
  if (!prescription) throw prescriptionNotFoundError();
  if (
    prescription.status === PrescriptionStatus.APPROVED ||
    prescription.status === PrescriptionStatus.REJECTED
  ) {
    throw prescriptionAlreadyFinalizedError();
  }
  if (prescription.order.status !== OrderStatus.PRESCRIPTION_PENDING) {
    throw prescriptionReviewNotAllowedError();
  }
}

function aggregatePrescriptionStatus(statuses: PrescriptionStatus[]) {
  if (statuses.some((status) => status === PrescriptionStatus.REJECTED)) {
    return OrderStatus.PRESCRIPTION_REJECTED;
  }
  if (
    statuses.some(
      (status) =>
        status === PrescriptionStatus.PENDING_REVIEW ||
        status === PrescriptionStatus.ADDITIONAL_INFO_REQUIRED,
    )
  ) {
    return OrderStatus.PRESCRIPTION_PENDING;
  }
  if (
    statuses.length > 0 &&
    statuses.every((status) => status === PrescriptionStatus.APPROVED)
  ) {
    return OrderStatus.PRESCRIPTION_APPROVED;
  }
  return OrderStatus.PRESCRIPTION_PENDING;
}

async function reviewPrescriptionAttempt(
  userId: string,
  pharmacyId: string,
  prescriptionId: string,
  input: ReviewPrescriptionInput,
  now: Date,
  dataSource: PharmacyWorkflowDataSource,
  membershipReader: MembershipReader,
) {
  return dataSource.$transaction(
    async (tx) => {
      const membership = await requireMembership(
        userId,
        pharmacyId,
        [PharmacyStaffRole.PHARMACIST],
        membershipReader,
        tx,
      );
      const current = await tx.prescription.findFirst({
        where: { id: prescriptionId, order: { pharmacyId } },
        select: {
          id: true,
          orderId: true,
          status: true,
          order: { select: { status: true } },
        },
      });
      validateReviewState(current);

      const updated = await tx.prescription.updateMany({
        where: {
          id: prescriptionId,
          orderId: current!.orderId,
          status: { in: reviewableStatuses },
          order: { pharmacyId, status: OrderStatus.PRESCRIPTION_PENDING },
        },
        data: {
          status: input.status,
          reviewedAt: now,
          reviewerStaffId: membership.id,
          reviewNotes: input.reviewNotes ?? null,
          rejectionReason:
            input.status === PrescriptionStatus.REJECTED
              ? input.rejectionReason
              : null,
        },
      });
      if (updated.count !== 1) {
        const latest = await tx.prescription.findFirst({
          where: { id: prescriptionId, order: { pharmacyId } },
          select: {
            status: true,
            order: { select: { status: true } },
          },
        });
        validateReviewState(latest);
        throw prescriptionReviewConflictError();
      }

      const prescriptions = await tx.prescription.findMany({
        where: { orderId: current!.orderId },
        select: { status: true },
      });
      const orderStatus = aggregatePrescriptionStatus(
        prescriptions.map((item) => item.status),
      );
      const orderUpdated = await tx.order.updateMany({
        where: {
          id: current!.orderId,
          pharmacyId,
          status: OrderStatus.PRESCRIPTION_PENDING,
        },
        data: { status: orderStatus },
      });
      if (orderUpdated.count !== 1) throw prescriptionReviewNotAllowedError();

      const result = await tx.prescription.findUnique({
        where: { id: prescriptionId },
        select: pharmacyPrescriptionSelect,
      });
      if (!result) throw prescriptionNotFoundError();
      return result;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function reviewPharmacyPrescription(
  userId: string,
  pharmacyId: string,
  prescriptionId: string,
  input: ReviewPrescriptionInput,
  dataSource: PharmacyWorkflowDataSource = prisma,
  membershipReader: MembershipReader = getActivePharmacyMembership,
  clock: WorkflowClock = () => new Date(),
) {
  for (let attempt = 1; attempt <= MAX_PHARMACY_WORKFLOW_ATTEMPTS; attempt += 1) {
    try {
      return await reviewPrescriptionAttempt(
        userId,
        pharmacyId,
        prescriptionId,
        input,
        clock(),
        dataSource,
        membershipReader,
      );
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === MAX_PHARMACY_WORKFLOW_ATTEMPTS) {
        throw prescriptionReviewConflictError();
      }
    }
  }
  throw prescriptionReviewConflictError();
}

type DecisionOrder = {
  id: string;
  status: OrderStatus;
  items: { id: string }[];
};

function nextOrderStatus(order: DecisionOrder, input: DecideOrderInput) {
  if (input.decision === "REJECT") {
    if (
      order.status === OrderStatus.CREATED ||
      order.status === OrderStatus.PRESCRIPTION_APPROVED
    ) {
      return OrderStatus.REJECTED_BY_PHARMACY;
    }
    throw orderDecisionNotAllowedError();
  }

  const requiresPrescription = order.items.length > 0;
  if (
    (order.status === OrderStatus.CREATED && !requiresPrescription) ||
    (order.status === OrderStatus.PRESCRIPTION_APPROVED &&
      requiresPrescription)
  ) {
    return OrderStatus.CONFIRMED;
  }
  throw orderDecisionNotAllowedError();
}

async function decideOrderAttempt(
  userId: string,
  pharmacyId: string,
  orderId: string,
  input: DecideOrderInput,
  now: Date,
  dataSource: PharmacyWorkflowDataSource,
  membershipReader: MembershipReader,
) {
  return dataSource.$transaction(
    async (tx) => {
      await requireMembership(
        userId,
        pharmacyId,
        [
          PharmacyStaffRole.OWNER,
          PharmacyStaffRole.MANAGER,
          PharmacyStaffRole.PHARMACIST,
        ],
        membershipReader,
        tx,
      );
      const order = await tx.order.findFirst({
        where: { id: orderId, pharmacyId },
        select: {
          id: true,
          status: true,
          items: {
            where: { requiresPrescription: true },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!order) throw orderNotFoundError();

      const status = nextOrderStatus(order, input);
      const updated = await tx.order.updateMany({
        where: { id: order.id, pharmacyId, status: order.status },
        data: {
          status,
          ...(status === OrderStatus.CONFIRMED ? { confirmedAt: now } : {}),
        },
      });
      if (updated.count !== 1) throw orderDecisionNotAllowedError();

      const result = await tx.order.findUnique({
        where: { id: order.id },
        select: pharmacyOrderSelect,
      });
      if (!result) throw orderNotFoundError();
      return result;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function decidePharmacyOrder(
  userId: string,
  pharmacyId: string,
  orderId: string,
  input: DecideOrderInput,
  dataSource: PharmacyWorkflowDataSource = prisma,
  membershipReader: MembershipReader = getActivePharmacyMembership,
  clock: WorkflowClock = () => new Date(),
) {
  for (let attempt = 1; attempt <= MAX_PHARMACY_WORKFLOW_ATTEMPTS; attempt += 1) {
    try {
      return await decideOrderAttempt(
        userId,
        pharmacyId,
        orderId,
        input,
        clock(),
        dataSource,
        membershipReader,
      );
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === MAX_PHARMACY_WORKFLOW_ATTEMPTS) {
        throw orderDecisionConflictError();
      }
    }
  }
  throw orderDecisionConflictError();
}
