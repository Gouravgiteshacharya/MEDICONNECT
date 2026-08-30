import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./db/prisma.js";
import type { RiderStore } from "./riders/rider.service.js";
const port = Number(process.env.PORT ?? 3000);
createApp({ store: prisma as unknown as RiderStore }).listen(port, () => console.log(`MediConnect backend listening on port ${port}`));
