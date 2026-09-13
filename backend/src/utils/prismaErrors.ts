import { Prisma } from "../../generated/prisma/client.js";

export function isUniqueConstraintError(
  error: unknown,
  field: string,
) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;

  /*
   * Standard Prisma P2002 shape.
   */
  if (
    Array.isArray(target) &&
    target.some((value) => String(value) === field)
  ) {
    return true;
  }

  if (
    typeof target === "string" &&
    target.includes(field)
  ) {
    return true;
  }

  /*
   * Prisma 7 + driver adapters may expose the database
   * constraint in the error message instead of meta.target.
   *
   * Examples:
   *   User_email_key
   *   User_phone_key
   */
  const message = error.message ?? "";

  return (
    message.includes(`_${field}_key`) ||
    message.includes(`"${field}"`) ||
    message.includes(`\`${field}\``)
  );
}

export function isRecordNotFoundError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}
