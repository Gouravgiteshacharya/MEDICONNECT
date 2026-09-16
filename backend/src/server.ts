import { PrismaOperationalRiskRepository } from "./risk/risk.repository.js";
import { OperationalRiskService } from "./risk/risk.service.js";
import { createDispatchRuntime } from "./ml/dispatch-runtime.js";
import { createEtaRuntime } from "./ml/eta-runtime.js";
import type { Server } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

let server: Server | undefined;
let isShuttingDown = false;

function closeHttpServer() {
  return new Promise<void>((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down MediConnect API.`);

  try {
    await closeHttpServer();
    await prisma.$disconnect();
    console.log("MediConnect API shutdown complete.");
    process.exit(0);
  } catch (error) {
    console.error("MediConnect API shutdown failed.", error);
    process.exit(1);
  }
}

try {
  const etaRuntime = await createEtaRuntime({ ...process.env, NODE_ENV: env.nodeEnv });
  const dispatchShadowRuntime = await createDispatchRuntime({ ...process.env, NODE_ENV: env.nodeEnv });
  const riskService = new OperationalRiskService(new PrismaOperationalRiskRepository(prisma.operationalRiskAssessment));
  const app = createApp({ etaRuntime, dispatchShadowRuntime, riskService,
    readActiveRiskAssignments: async riderId => (await prisma.deliveryAssignment.findMany({
      where: { riderId, status: { in: ["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } },
      select: { id: true, status: true, orderId: true },
    })).map(row => ({ assignmentId: row.id, assignmentStatus: row.status, orderId: row.orderId })),
    onRiskHookError: event => { console.warn("Operational risk hook unavailable", event); },
  });
  server = app.listen(env.port, () => {
    console.log(`MediConnect API listening on port ${env.port}`);
  });

  server.on("error", (error) => {
    console.error("Failed to start MediConnect API server.", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Unexpected startup failure.", error);
  process.exit(1);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
