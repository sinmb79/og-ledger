import { Router, Request, Response, NextFunction } from "express";
import { BagsApiClient } from "../services/bags-api";
import { config } from "../config";

const analyticsRouter = Router();
const bags = new BagsApiClient(config.bagsApiKey);

// GET /api/analytics/token/:mint — Aggregated analytics for a single token
analyticsRouter.get("/api/analytics/token/:mint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mint = String(req.params.mint);

    // Fetch lifetime fees and claim stats in parallel
    const [lifetimeFees, claimStats] = await Promise.all([
      bags.getTokenLifetimeFees(mint).catch(() => ({ raw: null })),
      bags.getTokenClaimStats(mint).catch(() => ({ raw: null }))
    ]);

    res.json({
      success: true,
      data: {
        mint,
        lifetimeFees: lifetimeFees.raw,
        claimStats: claimStats.raw
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/token/:mint/claim-events — Claim events for a token
analyticsRouter.get("/api/analytics/token/:mint/claim-events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mint = String(req.params.mint);
    const { mode, limit, offset, from, to } = req.query;

    const result = await bags.getTokenClaimEvents({
      tokenMint: mint,
      mode: mode ? String(mode) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined
    });

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/token/:mint/creator — Creator info for a token
analyticsRouter.get("/api/analytics/token/:mint/creator", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mint = String(req.params.mint);
    const result = await bags.getTokenCreatorV3(mint);

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/platform — Platform-level partner stats
analyticsRouter.get("/api/analytics/platform", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partner = req.query.partner ? String(req.query.partner) : config.bagsWallet;

    const result = await bags.getPartnerStats({ partner });

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/pools — List bags pools
analyticsRouter.get("/api/analytics/pools", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const onlyMigrated = req.query.onlyMigrated === "true";

    const result = await bags.getBagsPools({ onlyMigrated });

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/pool/:mint — Single pool by token mint
analyticsRouter.get("/api/analytics/pool/:mint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mint = String(req.params.mint);
    const result = await bags.getBagsPoolByMint(mint);

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

export default analyticsRouter;
