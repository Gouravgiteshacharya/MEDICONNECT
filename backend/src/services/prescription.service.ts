import {
  OrderStatus,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type { CreatePrescriptionInput } from "../validators/prescription.schemas.js";

type PrescriptionTransactionClient = Pick<
  Prisma.TransactionClient,
  "order" | "prescription"
>;

export type PrescriptionDataSource = Pick<
  PrismaClient,
  "order" | "prescription"
> & {
  $transaction<T>(
    callback: (tx: PrescriptionTransactionClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
};

export const MAX_PRESCRIPTION_UPLOAD_ATTEMPTS = 3;

const customerPrescriptionSelect = {
  id: true,
  orderId: true,
  fileUrl: true,
  originalFilename: true,
  status: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewNotes: true,
  rejectionReason: true,
} satisfies Prisma.PrescriptionSelect;

function orderNotFoundError() {
  return new ApiError(404, "Order not found.", "ORDER_NOT_FOUND");
}

function prescriptionNotRequiredError() {
  return new ApiError(
    409,
    "This order does not require a prescription.",
    "PRESCRIPTION_NOT_REQUIRED",
  );
}

function prescriptionUploadNotAllowedError() {
  return new ApiError(
    409,
    "Prescription upload is not allowed for this order.",
    "PRESCRIPTION_UPLOAD_NOT_ALLOWED",
  );
}

function prescriptionUploadConflictError() {
  return new ApiError(
    409,
    "Prescription upload changed during this request. Please try again.",
    "PRESCRIPTION_UPLOAD_CONFLICT",
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function findOwnedOrderForUpload(
  customerId: string,
  orderId: string,
  dataSource: Pick<PrismaClient, "order">,
) {
  const order = await dataSource.order.findFirst({
    where: { id: orderId, customerId },
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
  return order;
}

async function assertOwnedOrder(
  customerId: string,
  orderId: string,
  dataSource: PrescriptionDataSource,
) {
  const order = await dataSource.order.findFirst({
    where: { id: orderId, customerId },
    select: { id: true },
  });

  if (!order) throw orderNotFoundError();
}

export async function createCustomerPrescription(
  customerId: string,
  orderId: string,
  input: CreatePrescriptionInput,
  dataSource: PrescriptionDataSource = prisma,
) {
  for (
    let attempt = 1;
    attempt <= MAX_PRESCRIPTION_UPLOAD_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await dataSource.$transaction(
        async (tx) => {
          const order = await findOwnedOrderForUpload(
            customerId,
            orderId,
            tx,
          );

          if (order.items.length === 0) throw prescriptionNotRequiredError();
          if (order.status !== OrderStatus.PRESCRIPTION_PENDING) {
            throw prescriptionUploadNotAllowedError();
          }

          return tx.prescription.create({
            data: {
              orderId: order.id,
              fileUrl: input.fileUrl,
              ...(input.storagePath === undefined
                ? {}
                : { storagePath: input.storagePath }),
              ...(input.originalFilename === undefined
                ? {}
                : { originalFilename: input.originalFilename }),
            },
            select: customerPrescriptionSelect,
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === MAX_PRESCRIPTION_UPLOAD_ATTEMPTS) {
        throw prescriptionUploadConflictError();
      }
    }
  }

  throw prescriptionUploadConflictError();
}

export async function listCustomerPrescriptions(
  customerId: string,
  orderId: string,
  dataSource: PrescriptionDataSource = prisma,
) {
  await assertOwnedOrder(customerId, orderId, dataSource);

  return dataSource.prescription.findMany({
    where: { orderId },
    select: customerPrescriptionSelect,
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
  });
}
