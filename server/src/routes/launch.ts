import { Router, Request, Response, NextFunction } from "express";
import { BagsApiClient } from "../services/bags-api";
import { config } from "../config";
import { db } from "../db";

const launchRouter = Router();
const bags = new BagsApiClient(config.bagsApiKey);

// POST /api/launch/preview — Create token metadata (returns metadataUri for review)
launchRouter.post("/api/launch/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, symbol, description, image, twitter, telegram, website } = req.body;

    if (!name || !symbol) {
      res.status(400).json({ success: false, message: "name and symbol are required" });
      return;
    }

    const result = await bags.createTokenInfo({
      name,
      symbol,
      description,
      image,
      twitter,
      telegram,
      website
    });

    res.json({
      success: true,
      data: {
        metadataUri: result.metadataUri,
        raw: result.raw
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/launch/execute — Create launch transaction (returns serialized tx for client to sign)
launchRouter.post("/api/launch/execute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { creator, name, symbol, description, image, twitter, telegram, website, initialBuyAmount, feeShareConfigId } = req.body;

    if (!creator || !name || !symbol) {
      res.status(400).json({ success: false, message: "creator, name, and symbol are required" });
      return;
    }

    const result = await bags.createLaunchTx({
      creator,
      tokenInfo: { name, symbol, description, image, twitter, telegram, website },
      initialBuyAmount,
      feeShareConfigId
    });

    // Persist token to DB if we got a mint
    if (result.mint) {
      db.prepare(
        "INSERT OR IGNORE INTO tokens (mint, name, symbol, creator_wallet, launched_at, fee_share_config) VALUES (?, ?, ?, ?, datetime('now'), ?)"
      ).run(result.mint, name, symbol, creator, feeShareConfigId ?? null);
    }

    res.json({
      success: true,
      data: {
        transaction: result.transaction,
        mint: result.mint,
        raw: result.raw
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/launch/fee-share-config — Create a fee share configuration
launchRouter.post("/api/launch/fee-share-config", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, shares } = req.body;

    if (!name || !shares || !Array.isArray(shares) || shares.length === 0) {
      res.status(400).json({ success: false, message: "name and shares array are required" });
      return;
    }

    // Validate BPS sum = 10000
    const totalBps = shares.reduce((sum: number, s: { bps: number }) => sum + s.bps, 0);
    if (totalBps !== 10000) {
      res.status(400).json({ success: false, message: `shares BPS must sum to 10000, got ${totalBps}` });
      return;
    }

    const result = await bags.createFeeShareConfig({ name, shares });

    res.json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        raw: result.raw
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/launch/tokens — List tokens launched via OG LEDGER
launchRouter.get("/api/launch/tokens", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = db.prepare(
      "SELECT mint, name, symbol, creator_wallet, launched_at, fee_share_config, created_at FROM tokens ORDER BY created_at DESC"
    ).all();

    res.json({
      success: true,
      data: { count: tokens.length, tokens }
    });
  } catch (err) {
    next(err);
  }
});

export default launchRouter;
