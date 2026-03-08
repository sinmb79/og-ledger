import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { config } from "../config";
import { NftMintService } from "../services/nft-mint";

const nftRouter = Router();
const nftMint = new NftMintService(config.solanaRpc || "https://api.mainnet-beta.solana.com");

// POST /api/nft/prepare-mint — Build unsigned NFT mint transaction
nftRouter.post("/api/nft/prepare-mint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { creator, name, symbol, uri, sellerFeeBasisPoints } = req.body;

    if (!creator || !name || !symbol || !uri) {
      res.status(400).json({ success: false, message: "creator, name, symbol, and uri are required" });
      return;
    }

    if (String(name).length > 32 || String(symbol).length > 10 || String(uri).length > 200) {
      res.status(400).json({ success: false, message: "name/symbol/uri length exceeds Solana metadata limits" });
      return;
    }

    const result = await nftMint.prepareMintTx({
      creator: String(creator),
      name: String(name),
      symbol: String(symbol),
      uri: String(uri),
      sellerFeeBasisPoints: sellerFeeBasisPoints ? Number(sellerFeeBasisPoints) : undefined,
    });

    db.prepare(
      "INSERT OR IGNORE INTO nft_assets (mint, creator_wallet, name, symbol, uri, metadata_pda, master_edition_pda, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', datetime('now'))",
    ).run(
      result.mint,
      String(creator),
      String(name),
      String(symbol),
      String(uri),
      result.metadataPda,
      result.masterEditionPda,
    );

    res.json({
      success: true,
      data: {
        transaction: result.transaction,
        mint: result.mint,
        metadataPda: result.metadataPda,
        masterEditionPda: result.masterEditionPda,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft/record-mint — Record broadcast signature for prepared NFT
nftRouter.post("/api/nft/record-mint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mint, creator, txSignature } = req.body;

    if (!mint || !creator || !txSignature) {
      res.status(400).json({ success: false, message: "mint, creator, and txSignature are required" });
      return;
    }

    db.prepare(
      "UPDATE nft_assets SET status='minted', tx_signature=?, minted_at=datetime('now') WHERE mint=? AND creator_wallet=?",
    ).run(String(txSignature), String(mint), String(creator));

    db.prepare(
      "INSERT INTO signatures (wallet, action, tx_sig, created_at) VALUES (?, 'nft_mint', ?, datetime('now'))",
    ).run(String(creator), String(txSignature));

    res.json({
      success: true,
      data: { mint, txSignature },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft/assets — List prepared/minted NFT assets
nftRouter.get("/api/nft/assets", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = db.prepare(
      "SELECT mint, creator_wallet, name, symbol, uri, metadata_pda, master_edition_pda, status, tx_signature, created_at, minted_at FROM nft_assets ORDER BY created_at DESC",
    ).all();

    res.json({
      success: true,
      data: { count: rows.length, assets: rows },
    });
  } catch (err) {
    next(err);
  }
});

export default nftRouter;
