import { Router, Request, Response, NextFunction } from "express";
import { OgVerifyService } from "../services/og-verify";
import { db } from "../db";

const ogRouter = Router();
const ogVerify = new OgVerifyService();

// GET /api/og/verify/:wallet — Verify OG status on-chain and persist to DB
ogRouter.get("/api/og/verify/:wallet", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = String(req.params.wallet);

    // Check DB cache first
    const existing = db.prepare("SELECT * FROM og_members WHERE wallet = ?").get(wallet) as
      | { wallet: string; sol_amount: number; tx_signature: string; verified_at: string }
      | undefined;

    if (existing) {
      res.json({
        success: true,
        cached: true,
        data: {
          wallet: existing.wallet,
          verified: true,
          solAmount: existing.sol_amount,
          txSignature: existing.tx_signature,
          verifiedAt: existing.verified_at
        }
      });
      return;
    }

    // Verify on-chain
    const result = await ogVerify.verifyWallet({ wallet });

    if (result.verified) {
      // Persist to DB
      db.prepare(
        "INSERT OR IGNORE INTO og_members (wallet, sol_amount, tx_signature, verified_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(wallet, result.solAmount, result.txSignature);
    }

    res.json({
      success: true,
      cached: false,
      data: {
        wallet,
        verified: result.verified,
        solAmount: result.solAmount ?? null,
        txSignature: result.txSignature ?? null,
        reason: result.reason ?? null
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/og/registry — List all verified OG members
ogRouter.get("/api/og/registry", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const members = db.prepare(
      "SELECT wallet, sol_amount, tx_signature, verified_at, created_at FROM og_members ORDER BY created_at DESC"
    ).all() as Array<{
      wallet: string;
      sol_amount: number;
      tx_signature: string;
      verified_at: string;
      created_at: string;
    }>;

    const totalSol = members.reduce((sum, m) => sum + m.sol_amount, 0);

    res.json({
      success: true,
      data: {
        count: members.length,
        totalSol,
        members
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/og/stats — Quick stats without full member list
ogRouter.get("/api/og/stats", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as count, COALESCE(SUM(sol_amount), 0) as totalSol FROM og_members"
    ).get() as { count: number; totalSol: number };

    const sol3 = (db.prepare(
      "SELECT COUNT(*) as c FROM og_members WHERE ABS(sol_amount - 3.0) < 0.1"
    ).get() as { c: number }).c;

    const sol15 = (db.prepare(
      "SELECT COUNT(*) as c FROM og_members WHERE ABS(sol_amount - 1.5) < 0.1"
    ).get() as { c: number }).c;

    res.json({
      success: true,
      data: {
        count: row.count,
        totalSol: row.totalSol,
        sol3Count: sol3,
        sol15Count: sol15
      }
    });
  } catch (err) {
    next(err);
  }
});

export default ogRouter;
