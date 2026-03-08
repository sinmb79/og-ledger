import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  config: {
    bagsWallet: "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2",
    solanaRpc: "https://api.mainnet-beta.solana.com"
  }
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn()
  }
}));

import axios from "axios";
import { OgVerifyService } from "./og-verify";

const mockedAxios = vi.mocked(axios);

describe("OgVerifyService", () => {
  let service: OgVerifyService;

  beforeEach(() => {
    service = new OgVerifyService();
    vi.clearAllMocks();
  });

  it("should reject invalid wallet format (too short)", async () => {
    const result = await service.verifyWallet({ wallet: "abc" });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("Invalid wallet");
  });

  it("should reject invalid wallet format (too long)", async () => {
    const result = await service.verifyWallet({ wallet: "a".repeat(50) });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("Invalid wallet");
  });

  it("should return not verified when no signatures found", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { jsonrpc: "2.0", id: 1, result: [] }
    });

    const result = await service.verifyWallet({ wallet: "A".repeat(44) });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("No transactions");
  });

  it("should return not verified when no signatures in OG period", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: [
          { signature: "sig1", blockTime: 1700000000 }
        ]
      }
    });

    const result = await service.verifyWallet({ wallet: "B".repeat(44) });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("No transactions in OG recruitment period");
  });

  it("should verify a valid 3 SOL OG payment", async () => {
    const wallet = "C".repeat(44);
    const bagsWallet = "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2";
    const blockTime = 1706745600;

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: [{ signature: "txSig123", blockTime }]
      }
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: {
          transaction: {
            message: {
              accountKeys: [wallet, bagsWallet, "SomeProgram"]
            }
          },
          meta: {
            preBalances:  [10_000_000_000, 5_000_000_000, 1_000_000],
            postBalances: [7_000_000_000, 8_000_000_000, 1_000_000],
            err: null
          }
        }
      }
    });

    const result = await service.verifyWallet({ wallet });
    expect(result.verified).toBe(true);
    expect(result.solAmount).toBe(3);
    expect(result.txSignature).toBe("txSig123");
  });

  it("should verify a valid 1.5 SOL OG payment", async () => {
    const wallet = "D".repeat(44);
    const bagsWallet = "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2";
    const blockTime = 1706745600;

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: [{ signature: "txSig456", blockTime }]
      }
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: {
          transaction: {
            message: {
              accountKeys: [wallet, bagsWallet]
            }
          },
          meta: {
            preBalances:  [5_000_000_000, 3_000_000_000],
            postBalances: [3_500_000_000, 4_500_000_000],
            err: null
          }
        }
      }
    });

    const result = await service.verifyWallet({ wallet });
    expect(result.verified).toBe(true);
    expect(result.solAmount).toBe(1.5);
  });

  it("should return not verified when tx has no matching amount", async () => {
    const wallet = "E".repeat(44);
    const bagsWallet = "3nCpr7qw5mGVXofKS75PLNvv5xfJE3wY9c5JKDGPeAd2";
    const blockTime = 1706745600;

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: [{ signature: "txSig789", blockTime }]
      }
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jsonrpc: "2.0", id: 1,
        result: {
          transaction: {
            message: { accountKeys: [wallet, bagsWallet] }
          },
          meta: {
            preBalances:  [5_000_000_000, 3_000_000_000],
            postBalances: [4_900_000_000, 3_100_000_000],
            err: null
          }
        }
      }
    });

    const result = await service.verifyWallet({ wallet });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("No matching OG payment");
  });

  it("should handle RPC errors gracefully", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("RPC timeout"));

    const result = await service.verifyWallet({ wallet: "F".repeat(44) });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("RPC error");
  });
});
