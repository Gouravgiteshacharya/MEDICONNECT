import cors from "cors";
import express from "express";
import helmet from "helmet";

import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { apiRoutes } from "./routes/index.js";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.use("/api/v1", apiRoutes);

app.use(notFound);
app.use(errorHandler);
