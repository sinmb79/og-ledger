import express from "express";
import cors from "cors";
import { config } from "./config";
import { getDbPath, initializeDb } from "./db";
import healthRouter from "./routes/health";
import launchRouter from "./routes/launch";
import claimRouter from "./routes/claim";
import swapRouter from "./routes/swap";
import analyticsRouter from "./routes/analytics";
import ogRouter from "./routes/og";
import { errorHandler } from "./middleware/error-handler";
import { apiKeyAuth } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";

initializeDb();

const app = express();

app.use(cors());
app.use(express.json());

// Apply rate limiting to all requests
app.use(rateLimiter);

// Apply auth + rate limiting to /api/* routes only
app.use("/api", apiKeyAuth);

app.use(healthRouter);
app.use(launchRouter);
app.use(claimRouter);
app.use(swapRouter);
app.use(analyticsRouter);
app.use(ogRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`OG LEDGER server listening on port ${config.port}`);
  console.log(`SQLite DB initialized at ${getDbPath()}`);
});
