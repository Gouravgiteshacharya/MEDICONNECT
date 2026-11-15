import type { Server } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { loadLocationConfig } from "./location/config.js";
import { loadDispatchConfig } from "./dispatch/dispatch.config.js";
import type { DispatchOptions } from "./dispatch/dispatch.service.js";
import { startDispatchWorker } from "./dispatch/dispatch.worker.js";
import { loadMlConfig } from "./ml/ml.config.js";
import { prisma } from "./lib/prisma.js";

let server: Server | undefined;
let stopDispatchWorker: (() => Promise<void>) | undefined;
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
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}. Shutting down MediConnect API.`);

  try {
    await closeHttpServer();

    if (stopDispatchWorker) {
      await stopDispatchWorker();
    }

    await prisma.$disconnect();

    console.log("MediConnect API shutdown complete.");
    process.exit(0);
  } catch (error) {
    console.error("MediConnect API shutdown failed.", error);
    process.exit(1);
  }
}

try {
  server = app.listen(env.port, () => {
    console.log(`MediConnect API listening on port ${env.port}`);

    const locationConfig = loadLocationConfig();
    const mlConfig = loadMlConfig();

    const dispatchOptions: DispatchOptions = {
      ...loadDispatchConfig(),
      freshnessThresholdMs: locationConfig.freshnessThresholdMs,
      mlModel: null,
      maxPredictionMinutes: mlConfig.maxPredictionMinutes,
      timezoneOffsetMinutes: mlConfig.timezoneOffsetMinutes,
      now: () => new Date(),
    };

    stopDispatchWorker = startDispatchWorker(prisma, dispatchOptions);
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
