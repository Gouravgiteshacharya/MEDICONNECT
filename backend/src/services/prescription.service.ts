import { createHash, randomUUID } from "node:crypto";

import {
  OrderStatus,
  PrescriptionStatus,
  Prisma,
  UserRole,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import type {
  CreatePrescriptionInput,
  PrescriptionLibraryQuery,
} from "../validators/prescription.schemas.js";
import {
  getActivePharmacyMembership,
  type PharmacyMembershipContext,
} from "./pharmacyMembership.service.js";
import {
  prescriptionStorage,
  type PrescriptionStorage,
} from "./prescriptionStorage.service.js";

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

type PrescriptionIdentityGenerator = () => string;
type MembershipReader = (
  userId: string,
  pharmacyId: string,
) => Promise<PharmacyMembershipContext | null>;

export type CustomerPrescriptionUploadInput = CreatePrescriptionInput & {
  file: Express.Multer.File | undefined;
  idempotencyKey: string;
};

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
  supersedesPrescriptionId: true,
} satisfies Prisma.PrescriptionSelect;

const customerLibraryPrescriptionSelect = {
  id: true,
  orderId: true,
  originalFilename: true,
  status: true,
  uploadedAt: true,
  reviewedAt: true,
  reviewNotes: true,
  rejectionReason: true,
  supersedesPrescriptionId: true,
  supersededByPrescription: {
    select: {
      id: true,
      status: true,
      uploadedAt: true,
    },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
    },
  },
} satisfies Prisma.PrescriptionSelect;

function orderNotFoundError() {
  return new ApiError(
    404,
    "Order not found.",
    "ORDER_NOT_FOUND",
  );
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

function prescriptionSupersessionNotAllowedError() {
  return new ApiError(
    409,
    "The selected prescription cannot be superseded.",
    "PRESCRIPTION_SUPERSESSION_NOT_ALLOWED",
  );
}

function prescriptionSupersessionConflictError() {
  return new ApiError(
    409,
    "This prescription has already been superseded.",
    "PRESCRIPTION_SUPERSESSION_CONFLICT",
  );
}

function prescriptionIdempotencyConflictError() {
  return new ApiError(
    409,
    "This idempotency key was already used for a different prescription upload.",
    "PRESCRIPTION_IDEMPOTENCY_CONFLICT",
  );
}

function prescriptionFileRequiredError() {
  return new ApiError(
    400,
    "A prescription document is required.",
    "PRESCRIPTION_FILE_REQUIRED",
  );
}

function prescriptionFileTypeError() {
  return new ApiError(
    415,
    "The prescription document type is not supported or does not match its content.",
    "PRESCRIPTION_FILE_TYPE_UNSUPPORTED",
  );
}

function prescriptionNotFoundError() {
  return new ApiError(
    404,
    "Prescription not found.",
    "PRESCRIPTION_NOT_FOUND",
  );
}

function prescriptionDocumentUnavailableError() {
  return new ApiError(
    409,
    "Managed prescription document content is unavailable.",
    "PRESCRIPTION_DOCUMENT_UNAVAILABLE",
  );
}

function forbiddenError() {
  return new ApiError(403, "Forbidden.", "FORBIDDEN");
}

function prescriptionCleanupError() {
  return new ApiError(
    500,
    "Prescription upload could not be completed safely.",
    "PRESCRIPTION_UPLOAD_CLEANUP_FAILED",
  );
}

function isTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isSupersessionUniqueConflict(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;

  return (
    Array.isArray(target) &&
    target.some(
      (field) => field === "supersedesPrescriptionId",
    )
  );
}

async function findOwnedOrderForUpload(
  customerId: string,
  orderId: string,
  dataSource: Pick<PrismaClient, "order">,
) {
  const order = await dataSource.order.findFirst({
    where: {
      id: orderId,
      customerId,
    },
    select: {
      id: true,
      status: true,
      items: {
        where: {
          requiresPrescription: true,
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!order) {
    throw orderNotFoundError();
  }

  return order;
}

async function assertOwnedOrder(
  customerId: string,
  orderId: string,
  dataSource: PrescriptionDataSource,
) {
  const order = await dataSource.order.findFirst({
    where: {
      id: orderId,
      customerId,
    },
    select: {
      id: true,
    },
  });

  if (!order) {
    throw orderNotFoundError();
  }
}

async function validateSupersession(
  orderId: string,
  supersedesPrescriptionId: string,
  dataSource: PrescriptionTransactionClient,
) {
  const previousPrescription =
    await dataSource.prescription.findUnique({
      where: {
        id: supersedesPrescriptionId,
      },
      select: {
        id: true,
        orderId: true,
        status: true,
      },
    });

  if (
    !previousPrescription ||
    previousPrescription.orderId !== orderId ||
    previousPrescription.status !==
      PrescriptionStatus.ADDITIONAL_INFO_REQUIRED
  ) {
    throw prescriptionSupersessionNotAllowedError();
  }

  const existingReplacement =
    await dataSource.prescription.findFirst({
      where: {
        supersedesPrescriptionId:
          previousPrescription.id,
      },
      select: {
        id: true,
      },
    });

  if (existingReplacement) {
    throw prescriptionSupersessionConflictError();
  }

  return previousPrescription;
}

function isUploadIdempotencyUniqueConflict(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  return (
    Array.isArray(target) &&
    target.length === 2 &&
    target[0] === "orderId" &&
    target[1] === "uploadIdempotencyKey"
  );
}

function fingerprintUpload(
  file: Express.Multer.File,
  supersedesPrescriptionId: string | undefined,
) {
  return createHash("sha256")
    .update("mime\0")
    .update(file.mimetype)
    .update("\0supersedes\0")
    .update(supersedesPrescriptionId ?? "null")
    .update("\0bytes\0")
    .update(file.buffer)
    .digest("hex");
}

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function hasValidFileSignature(file: Express.Multer.File) {
  if (file.mimetype === "application/pdf") {
    return file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  }
  if (file.mimetype === "image/jpeg") {
    return (
      file.buffer.length >= 3 &&
      file.buffer[0] === 0xff &&
      file.buffer[1] === 0xd8 &&
      file.buffer[2] === 0xff
    );
  }
  if (file.mimetype === "image/png") {
    return file.buffer.subarray(0, 8).equals(pngSignature);
  }
  return false;
}

function sanitizeFilename(filename: string, mimetype: string) {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const sanitized = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
  if (sanitized) return sanitized;

  const extension =
    mimetype === "application/pdf"
      ? "pdf"
      : mimetype === "image/png"
        ? "png"
        : "jpg";
  return `prescription.${extension}`;
}

function validateUploadFile(file: Express.Multer.File | undefined) {
  if (!file) throw prescriptionFileRequiredError();
  if (!hasValidFileSignature(file)) throw prescriptionFileTypeError();
  return file;
}

async function findIdempotentUpload(
  orderId: string,
  idempotencyKey: string,
  dataSource: Pick<PrismaClient, "prescription">,
) {
  return dataSource.prescription.findFirst({
    where: {
      orderId,
      uploadIdempotencyKey: idempotencyKey,
    },
    select: {
      ...customerPrescriptionSelect,
      uploadRequestHash: true,
    },
  });
}

function resolveIdempotentUpload(
  existing: Awaited<ReturnType<typeof findIdempotentUpload>>,
  requestHash: string,
) {
  if (!existing) return null;
  if (existing.uploadRequestHash !== requestHash) {
    throw prescriptionIdempotencyConflictError();
  }

  const { uploadRequestHash: _uploadRequestHash, ...prescription } = existing;
  return prescription;
}

async function createPrescriptionRecord(
  customerId: string,
  orderId: string,
  prescriptionId: string,
  storagePath: string,
  originalFilename: string,
  idempotencyKey: string,
  requestHash: string,
  input: CreatePrescriptionInput,
  dataSource: PrescriptionDataSource,
) {
  for (
    let attempt = 1;
    attempt <= MAX_PRESCRIPTION_UPLOAD_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await dataSource.$transaction(
        async (tx) => {
          const order = await findOwnedOrderForUpload(customerId, orderId, tx);
          if (order.items.length === 0) throw prescriptionNotRequiredError();
          if (order.status !== OrderStatus.PRESCRIPTION_PENDING) {
            throw prescriptionUploadNotAllowedError();
          }

          if (input.supersedesPrescriptionId !== undefined) {
            await validateSupersession(
              order.id,
              input.supersedesPrescriptionId,
              tx,
            );
          }

          return tx.prescription.create({
            data: {
              id: prescriptionId,
              orderId: order.id,
              fileUrl: `/api/v1/prescriptions/${prescriptionId}/document-access`,
              storagePath,
              originalFilename,
              uploadIdempotencyKey: idempotencyKey,
              uploadRequestHash: requestHash,
              ...(input.supersedesPrescriptionId === undefined
                ? {}
                : {
                    supersedesPrescriptionId:
                      input.supersedesPrescriptionId,
                  }),
            },
            select: customerPrescriptionSelect,
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (isSupersessionUniqueConflict(error)) {
        throw prescriptionSupersessionConflictError();
      }
      if (!isTransactionConflict(error)) throw error;
      if (attempt === MAX_PRESCRIPTION_UPLOAD_ATTEMPTS) {
        throw prescriptionUploadConflictError();
      }
    }
  }
  throw prescriptionUploadConflictError();
}

export async function createCustomerPrescription(
  customerId: string,
  orderId: string,
  input: CustomerPrescriptionUploadInput,
  dataSource: PrescriptionDataSource = prisma,
  storage: PrescriptionStorage = prescriptionStorage,
  identityGenerator: PrescriptionIdentityGenerator = randomUUID,
) {
  const order = await findOwnedOrderForUpload(customerId, orderId, dataSource);
  const file = validateUploadFile(input.file);
  const requestHash = fingerprintUpload(
    file,
    input.supersedesPrescriptionId,
  );
  const replay = resolveIdempotentUpload(
    await findIdempotentUpload(orderId, input.idempotencyKey, dataSource),
    requestHash,
  );
  if (replay) return replay;

  if (order.items.length === 0) throw prescriptionNotRequiredError();
  if (order.status !== OrderStatus.PRESCRIPTION_PENDING) {
    throw prescriptionUploadNotAllowedError();
  }

  const prescriptionId = identityGenerator();
  const storagePath = [
    "prescriptions",
    customerId,
    orderId,
    prescriptionId,
    `${identityGenerator()}-${sanitizeFilename(file.originalname, file.mimetype)}`,
  ].join("/");

  await storage.upload({
    key: storagePath,
    content: file.buffer,
    contentType: file.mimetype,
  });

  try {
    return await createPrescriptionRecord(
      customerId,
      orderId,
      prescriptionId,
      storagePath,
      sanitizeFilename(file.originalname, file.mimetype),
      input.idempotencyKey,
      requestHash,
      input,
      dataSource,
    );
  } catch (error) {
    try {
      await storage.delete(storagePath);
    } catch {
      throw prescriptionCleanupError();
    }

    if (isUploadIdempotencyUniqueConflict(error)) {
      const winner = resolveIdempotentUpload(
        await findIdempotentUpload(orderId, input.idempotencyKey, dataSource),
        requestHash,
      );
      if (winner) return winner;
    }

    throw error;
  }
}

export async function listCustomerPrescriptions(
  customerId: string,
  orderId: string,
  dataSource: PrescriptionDataSource = prisma,
) {
  await assertOwnedOrder(
    customerId,
    orderId,
    dataSource,
  );

  return dataSource.prescription.findMany({
    where: {
      orderId,
    },
    select: customerPrescriptionSelect,
    orderBy: [
      { uploadedAt: "asc" },
      { id: "asc" },
    ],
  });
}

export async function listCustomerPrescriptionLibrary(
  customerId: string,
  query: PrescriptionLibraryQuery,
  dataSource: Pick<PrismaClient, "prescription"> = prisma,
) {
  const records = await dataSource.prescription.findMany({
    where: { order: { customerId } },
    select: customerLibraryPrescriptionSelect,
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor === undefined
      ? {}
      : { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = records.length > query.limit;
  const prescriptions = hasMore
    ? records.slice(0, query.limit)
    : records;
  return {
    prescriptions,
    nextCursor: hasMore
      ? prescriptions[prescriptions.length - 1]?.id ?? null
      : null,
  };
}

export async function getCustomerPrescription(
  customerId: string,
  prescriptionId: string,
  dataSource: Pick<PrismaClient, "prescription"> = prisma,
) {
  const prescription = await dataSource.prescription.findFirst({
    where: { id: prescriptionId, order: { customerId } },
    select: customerLibraryPrescriptionSelect,
  });
  if (!prescription) throw prescriptionNotFoundError();
  return prescription;
}

export async function createPrescriptionDocumentAccess(
  userId: string,
  userRole: UserRole,
  prescriptionId: string,
  dataSource: Pick<PrismaClient, "prescription"> = prisma,
  storage: PrescriptionStorage = prescriptionStorage,
  membershipReader: MembershipReader = getActivePharmacyMembership,
  clock: () => Date = () => new Date(),
) {
  if (
    userRole !== UserRole.CUSTOMER &&
    userRole !== UserRole.PHARMACY_STAFF
  ) {
    throw forbiddenError();
  }

  const prescription = await dataSource.prescription.findUnique({
    where: { id: prescriptionId },
    select: {
      id: true,
      storagePath: true,
      order: {
        select: { customerId: true, pharmacyId: true },
      },
    },
  });
  if (!prescription) throw prescriptionNotFoundError();

  if (userRole === UserRole.CUSTOMER) {
    if (prescription.order.customerId !== userId) {
      throw prescriptionNotFoundError();
    }
  } else {
    const membership = await membershipReader(
      userId,
      prescription.order.pharmacyId,
    );
    if (!membership) throw prescriptionNotFoundError();
  }

  if (!prescription.storagePath) {
    throw prescriptionDocumentUnavailableError();
  }

  const expiresInSeconds = env.prescriptionSignedUrlTtlSeconds;
  const url = await storage.createSignedUrl(
    prescription.storagePath,
    expiresInSeconds,
  );
  return {
    url,
    expiresAt: new Date(
      clock().getTime() + expiresInSeconds * 1000,
    ),
  };
}
