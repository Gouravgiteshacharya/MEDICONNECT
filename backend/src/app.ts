import cors from "cors";
import express from "express";

import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { apiRoutes } from "./routes/index.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1", apiRoutes);

app.use(notFound);
app.use(errorHandler);
