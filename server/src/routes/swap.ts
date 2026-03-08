import { Router, Request, Response, NextFunction } from "express";
import { BagsApiClient } from "../services/bags-api";
import { config } from "../config";

const swapRouter = Router();
const bags = new BagsApiClient(config.bagsApiKey);

// GET /api/swap/quote — Get a swap quote
swapRouter.get("/api/swap/quote", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inputMint, outputMint, amount, swapMode, slippageBps, platformFeeBps } = req.query;

    if (!inputMint || !outputMint || !amount) {
      res.status(400).json({ success: false, message: "inputMint, outputMint, and amount are required" });
      return;
    }

    const result = await bags.getQuote({
      inputMint: String(inputMint),
      outputMint: String(outputMint),
      amount: String(amount),
      swapMode: swapMode ? String(swapMode) : undefined,
      slippageBps: slippageBps ? Number(slippageBps) : undefined,
      platformFeeBps: platformFeeBps ? Number(platformFeeBps) : undefined
    });

    res.json({
      success: true,
      data: result.raw
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/swap/execute — Create swap transaction from quote
swapRouter.post("/api/swap/execute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { wallet, quoteResponse, wrapAndUnwrapSol } = req.body;

    if (!wallet || !quoteResponse) {
      res.status(400).json({ success: false, message: "wallet and quoteResponse are required" });
      return;
    }

    const result = await bags.createSwap({
      wallet,
      quoteResponse,
      wrapAndUnwrapSol
    });

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

export default swapRouter;
