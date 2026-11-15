import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { LIVE_ASSIGNMENT_STATUSES } from "../delivery-assignments/assignment.service.js";
import { dispatchOrder, type DispatchOptions, type DispatchStore } from "./dispatch.service.js";

interface ClaimedDispatchJob {
  id: string;
  orderId: string;
  attempts: number;
}

export interface WorkerConfig {
  pollIntervalMs: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  pollIntervalMs: 3000,
  leaseMs: 5 * 60 * 1000,
  maxAttempts: 8,
  baseRetryDelayMs: 5000,
  maxRetryDelayMs: 5 * 60 * 1000,
};

async function claimNextJob(
  prisma: PrismaClient,
  workerId: string,
  leaseMs: number,
): Promise<ClaimedDispatchJob | null> {
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<ClaimedDispatchJob[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "DispatchJob"
        WHERE (
          "status" = 'PENDING'
          AND "nextAttemptAt" <= NOW()
        ) OR (
          "status" = 'PROCESSING'
          AND "lockedAt" < NOW() - (${leaseMs} * INTERVAL '1 millisecond')
        )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "DispatchJob" AS job
      SET
        "status" = 'PROCESSING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "attempts" = job."attempts" + 1,
        "updatedAt" = NOW()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."orderId", job."attempts"
    `;

    return jobs[0] ?? null;
  });
}

function retryDelay(attempts: number, config: WorkerConfig): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    config.maxRetryDelayMs,
    config.baseRetryDelayMs * 2 ** exponent,
  );
}


function startLeaseHeartbeat(
  prisma: PrismaClient,
  workerId: string,
  job: ClaimedDispatchJob,
  leaseMs: number,
): {
  hasLostLease: () => boolean;
  stop: () => Promise<void>;
} {
  const intervalMs = Math.max(250, Math.floor(leaseMs / 3));

  let stopped = false;
  let leaseLost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const renew = async (): Promise<void> => {
    if (stopped || leaseLost) return;

    inFlight = (async () => {
      try {
        const result = await prisma.dispatchJob.updateMany({
          where: {
            id: job.id,
            status: "PROCESSING",
            lockedBy: workerId,
          },
          data: {
            lockedAt: new Date(),
          },
        });

        if (result.count !== 1) {
          leaseLost = true;
          console.warn(
            `[dispatch-worker] Lost lease for job ${job.id}; another worker may have claimed it`,
          );
        }
      } catch (error) {
        console.error(
          `[dispatch-worker] Lease renewal failed for job ${job.id}:`,
          error,
        );
      }
    })();

    await inFlight;
    inFlight = undefined;

    if (!stopped && !leaseLost) {
      timer = setTimeout(() => {
        void renew();
      }, intervalMs);
    }
  };

  timer = setTimeout(() => {
    void renew();
  }, intervalMs);

  return {
    hasLostLease: () => leaseLost,

    stop: async () => {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (inFlight) {
        await inFlight;
      }
    },
  };
}

export async function processJob(
  prisma: PrismaClient,
  workerId: string,
  job: ClaimedDispatchJob,
  dispatchOptions: DispatchOptions,
  config: WorkerConfig,
): Promise<void> {
  const heartbeat = startLeaseHeartbeat(
    prisma,
    workerId,
    job,
    config.leaseMs,
  );

  try {
    await dispatchOrder(
      prisma as unknown as DispatchStore,
      job.orderId,
      dispatchOptions,
    );

    const activeAssignment = await prisma.deliveryAssignment.findFirst({
      where: {
        orderId: job.orderId,
        status: { in: [...LIVE_ASSIGNMENT_STATUSES] },
      },
      select: { id: true },
    });

    if (!activeAssignment) {
      throw new Error(
        "Dispatch returned without creating or finding an active assignment",
      );
    }

    // Keep renewing during dispatch and assignment verification.
    // Stop immediately before the ownership-checked completion update.
    await heartbeat.stop();

    if (heartbeat.hasLostLease()) {
      console.warn(
        `[dispatch-worker] Job ${job.id} was dispatched, but this worker lost its lease; leaving job for recovery`,
      );
      return;
    }

    const completed = await prisma.dispatchJob.updateMany({
      where: {
        id: job.id,
        status: "PROCESSING",
        lockedBy: workerId,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });

    if (completed.count !== 1) {
      console.warn(
        `[dispatch-worker] Could not mark job ${job.id} completed because this worker no longer owns it`,
      );
      return;
    }

    console.log(
      `[dispatch-worker] Completed job ${job.id} for order ${job.orderId}`,
    );
  } catch (error) {
    await heartbeat.stop();

    if (heartbeat.hasLostLease()) {
      console.warn(
        `[dispatch-worker] Not retrying job ${job.id}; this worker lost its lease`,
      );
      return;
    }

    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2000);

    const exhausted = job.attempts >= config.maxAttempts;
    const nextAttemptAt = new Date(
      Date.now() + retryDelay(job.attempts, config),
    );

    const result = await prisma.dispatchJob.updateMany({
      where: {
        id: job.id,
        status: "PROCESSING",
        lockedBy: workerId,
      },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });

    if (result.count > 0) {
      console.error(
        `[dispatch-worker] Job ${job.id} failed (${job.attempts}/${config.maxAttempts}): ${message}`,
      );
    } else {
      console.warn(
        `[dispatch-worker] Could not update failed job ${job.id}; this worker no longer owns it`,
      );
    }
  } finally {
    await heartbeat.stop();
  }
}

export function startDispatchWorker(
  prisma: PrismaClient,
  dispatchOptions: DispatchOptions,
  overrides: Partial<WorkerConfig> = {},
): () => Promise<void> {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const workerId = `dispatch-${process.pid}-${randomUUID()}`;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const run = async (): Promise<void> => {
    if (stopped) return;

    inFlight = (async () => {
      try {
        const job = await claimNextJob(prisma, workerId, config.leaseMs);

        if (job) {
          await processJob(
            prisma,
            workerId,
            job,
            dispatchOptions,
            config,
          );
        }
      } catch (error) {
        console.error("[dispatch-worker] Worker cycle failed:", error);
      }
    })();

    await inFlight;
    inFlight = undefined;

    if (!stopped) {
      timer = setTimeout(() => {
        void run();
      }, config.pollIntervalMs);
    }
  };

  console.log(`[dispatch-worker] Started (${workerId})`);
  void run();

  return async () => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (inFlight) {
      await inFlight;
    }

    console.log("[dispatch-worker] Stopped");
  };
}
