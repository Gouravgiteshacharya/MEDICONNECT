
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";

vi.mock("../src/dispatch/dispatch.service.js", () => ({
  dispatchOrder: vi.fn(),
}));

import { dispatchOrder, type DispatchOptions } from "../src/dispatch/dispatch.service.js";
import {
  processJob,
  type WorkerConfig,
} from "../src/dispatch/dispatch.worker.js";

const mockedDispatchOrder = vi.mocked(dispatchOrder);

const dispatchResult = {
  assignment: { id: "assignment-1" },
  alreadyDispatched: false,
  evaluatedCandidates: 1,
} as Awaited<ReturnType<typeof dispatchOrder>>;

const job = {
  id: "job-1",
  orderId: "order-1",
  attempts: 1,
};

const config: WorkerConfig = {
  pollIntervalMs: 3000,
  leaseMs: 3000,
  maxAttempts: 3,
  baseRetryDelayMs: 5000,
  maxRetryDelayMs: 300000,
};

const dispatchOptions = {} as DispatchOptions;

function makePrisma(updateMany = vi.fn().mockResolvedValue({ count: 1 })) {
  const prisma = {
    dispatchJob: {
      updateMany,
    },
    deliveryAssignment: {
      findFirst: vi.fn().mockResolvedValue({ id: "assignment-1" }),
    },
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    updateMany,
  };
}

describe("dispatch worker job processing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedDispatchOrder.mockResolvedValue(dispatchResult);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a successfully dispatched job as completed", async () => {
    const { prisma, updateMany } = makePrisma();

    await processJob(prisma, "worker-1", job, dispatchOptions, config);

    expect(mockedDispatchOrder).toHaveBeenCalledWith(
      prisma,
      job.orderId,
      dispatchOptions,
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: job.id,
          status: "PROCESSING",
          lockedBy: "worker-1",
        },
        data: expect.objectContaining({
          status: "COMPLETED",
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        }),
      }),
    );
  });

  it("returns a failed dispatch to the pending queue for retry", async () => {
    mockedDispatchOrder.mockRejectedValueOnce(new Error("No eligible rider"));

    const { prisma, updateMany } = makePrisma();

    await processJob(prisma, "worker-1", job, dispatchOptions, config);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: job.id,
          lockedBy: "worker-1",
        }),
        data: expect.objectContaining({
          status: "PENDING",
          lastError: "No eligible rider",
          lockedAt: null,
          lockedBy: null,
        }),
      }),
    );
  });

  it("marks a job failed after the maximum number of attempts", async () => {
    mockedDispatchOrder.mockRejectedValueOnce(new Error("Still no eligible rider"));

    const { prisma, updateMany } = makePrisma();

    await processJob(
      prisma,
      "worker-1",
      { ...job, attempts: config.maxAttempts },
      dispatchOptions,
      config,
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: "Still no eligible rider",
        }),
      }),
    );
  });

  it("does not mark a job completed after losing its lease", async () => {
    let resolveDispatch!: (value: Awaited<ReturnType<typeof dispatchOrder>>) => void;

    mockedDispatchOrder.mockReturnValueOnce(
      new Promise<Awaited<ReturnType<typeof dispatchOrder>>>((resolve) => {
        resolveDispatch = resolve;
      }),
    );

    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { prisma } = makePrisma(updateMany);

    const processing = processJob(
      prisma,
      "worker-1",
      job,
      dispatchOptions,
      config,
    );

    // The heartbeat runs after one-third of the lease, with a 250ms minimum.
    await vi.advanceTimersByTimeAsync(1000);

    resolveDispatch(dispatchResult);
    await processing;

    // The only update was the failed lease renewal. No completion update follows.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lockedAt: expect.any(Date) },
      }),
    );
  });
});
