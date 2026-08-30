import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./db/prisma.js";
import type { RiderStore } from "./riders/rider.service.js";
import type { LocationStore } from "./location/location.service.js";
import type { DeliveryQuoteStore } from "./delivery-quotes/delivery-quote.service.js";
const port = Number(process.env.PORT ?? 3000);
createApp({ store: prisma as unknown as RiderStore & LocationStore & DeliveryQuoteStore }).listen(port, () => console.log(`MediConnect backend listening on port ${port}`));
