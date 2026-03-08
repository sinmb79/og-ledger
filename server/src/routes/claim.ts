import { Router, Request, Response, NextFunction } from "express";
import { BagsApiClient } from "../services/bags-api";
import { config } from "../config";
import { db } from "../db";

const claimRouter = Router();
const bags = new BagsApiClient(config.bagsApiKey);

// GET /api/claim/:wallet — Get claimable fee positions for a wallet
claimRouter.get("/api/claim/:wallet", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = String(req.params.wallet);

    if (!wallet || wallet.length < 32) {
      res.status(400).json({ success: false, message: "Valid wallet address required" });
      return;
    }

    const result = await bags.getClaimablePositions({
      wallet,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined
    });

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/claim/execute — Create claim transaction for a specific position
claimRouter.post("/api/claim/execute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { wallet, mint, amount } = req.body;

    if (!wallet || !mint) {
      res.status(400).json({ success: false, message: "wallet and mint are required" });
      return;
    }

    const result = await bags.getClaimTxV3({ wallet, mint, amount });

    // Record the claim attempt in signatures table
    if (result.transaction) {
      db.prepare(
        "INSERT INTO signatures (wallet, action, tx_sig, created_at) VALUES (?, 'claim', ?, datetime('now'))"
      ).run(wallet, `pending:${mint}`);
    }

    res.json({
      success: true,
      data: {
        transaction: result.transaction,
        raw: result.raw
      }
    });
  } catch (err) {
    next(err);
  }
});

export default claimRouter;
