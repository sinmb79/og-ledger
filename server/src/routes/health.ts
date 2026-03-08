import { Router, Request, Response, NextFunction } from "express";
import { BagsApiClient } from "../services/bags-api";
import { config } from "../config";

const healthRouter = Router();
const bags = new BagsApiClient(config.bagsApiKey);

// GET /health — Basic health check
healthRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
});

// GET /health/bags — Bags API connectivity check
healthRouter.get("/health/bags", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const start = Date.now();
    const result = await bags.ping();
    const latency = Date.now() - start;

    res.json({
      success: true,
      data: { status: "connected", latencyMs: latency, raw: result }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bags API unreachable";
    res.status(502).json({ success: false, message });
  }
});

// POST /api/transaction/send — Send a signed Solana transaction via Bags
healthRouter.post("/api/transaction/send", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tx, skipPreflight, maxRetries } = req.body;

    if (!tx) {
      res.status(400).json({ success: false, message: "tx (serialized transaction) is required" });
      return;
    }

    const result = await bags.sendTransaction({ tx, skipPreflight, maxRetries });

    res.json({
      success: true,
      data: { signature: result.signature, raw: result.raw }
    });
  } catch (err) {
    next(err);
  }
});

export default healthRouter;
