import axios from "axios";
import { config } from "../config";

const BAGS_WALLET = config.bagsWallet || "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2";
const SOLANA_RPC = config.solanaRpc || "https://api.mainnet-beta.solana.com";

// OG recruitment period: Jan 2024 – Mar 2024
const OG_FROM_TS = Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000);
const OG_TO_TS = Math.floor(new Date("2024-04-01T00:00:00Z").getTime() / 1000);

// Valid OG amounts in lamports (1.5 SOL, 3 SOL)
const OG_AMOUNTS_LAM = [1_500_000_000, 3_000_000_000];
const TOLERANCE_LAM = 2_000_000; // 0.002 SOL tolerance

export interface OgVerificationInput {
  wallet: string;
}

export interface OgVerificationResult {
  verified: boolean;
  solAmount?: number;
  txSignature?: string;
  reason?: string;
}

interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface SignatureInfo {
  signature: string;
  blockTime?: number;
  err?: unknown;
}

interface ParsedTransaction {
  transaction: {
    message: {
      accountKeys: Array<string | { pubkey: string }>;
    };
  };
  meta?: {
    preBalances: number[];
    postBalances: number[];
    err?: unknown;
  };
}

async function rpc<T = unknown>(method: string, params: unknown[], retries = 3): Promise<T | null> {
  const payload = { jsonrpc: "2.0", id: 1, method, params };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.post<RpcResponse<T>>(SOLANA_RPC, payload, {
        timeout: 20000,
        headers: { "Content-Type": "application/json" }
      });

      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result ?? null;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }

  return null;
}

function getAddress(a: string | { pubkey: string }): string {
  return typeof a === "string" ? a : a.pubkey ?? "";
}

export class OgVerifyService {
  async verifyWallet(input: OgVerificationInput): Promise<OgVerificationResult> {
    const { wallet } = input;

    if (!wallet || wallet.length < 32 || wallet.length > 44) {
      return { verified: false, reason: "Invalid wallet address format" };
    }

    try {
      // 1. Get signatures for the wallet
      const sigs = await rpc<SignatureInfo[]>("getSignaturesForAddress", [
        wallet,
        { limit: 200 }
      ]);

      if (!sigs || sigs.length === 0) {
        return { verified: false, reason: "No transactions found for wallet" };
      }

      // 2. Filter signatures within OG recruitment period
      const inRange = sigs.filter(
        s => s.blockTime && s.blockTime >= OG_FROM_TS && s.blockTime <= OG_TO_TS && !s.err
      );

      if (inRange.length === 0) {
        return { verified: false, reason: "No transactions in OG recruitment period (Jan-Mar 2024)" };
      }

      // 3. Check up to 60 transactions for matching OG payment
      const toCheck = inRange.slice(0, 60);

      for (const sigInfo of toCheck) {
        const tx = await rpc<ParsedTransaction>("getTransaction", [
          sigInfo.signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }
        ]);

        if (!tx || !tx.meta || tx.meta.err) continue;

        const accs = tx.transaction.message.accountKeys;
        const pre = tx.meta.preBalances;
        const post = tx.meta.postBalances;

        // Find BAGS wallet and sender wallet indices
        const bagsIdx = accs.findIndex(a => getAddress(a) === BAGS_WALLET);
        const walletIdx = accs.findIndex(a => getAddress(a) === wallet);

        if (bagsIdx === -1 || walletIdx === -1) continue;

        // Calculate SOL sent/received
        const sent = pre[walletIdx] - post[walletIdx];
        const recv = post[bagsIdx] - pre[bagsIdx];

        // Check if amount matches known OG amounts
        for (const target of OG_AMOUNTS_LAM) {
          if (Math.abs(sent - target) <= TOLERANCE_LAM || Math.abs(recv - target) <= TOLERANCE_LAM) {
            return {
              verified: true,
              solAmount: target / 1e9,
              txSignature: sigInfo.signature
            };
          }
        }
      }

      return { verified: false, reason: "No matching OG payment found (1.5 or 3 SOL to BAGS wallet)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      return { verified: false, reason: `RPC error: ${message}` };
    }
  }
}
