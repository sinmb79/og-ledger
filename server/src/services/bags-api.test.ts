import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
      __mockInstance: mockInstance,
    }
  };
});

import axios from "axios";
import { BagsApiClient } from "./bags-api";

const mockHttp = (axios as any).__mockInstance;

describe("BagsApiClient", () => {
  let client: BagsApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BagsApiClient("test-api-key");
  });

  it("should create axios instance with correct config", () => {
    expect(axios.create).toHaveBeenCalledWith({
      baseURL: "https://public-api-v2.bags.fm/api/v1",
      headers: {
        "x-api-key": "test-api-key",
        "Content-Type": "application/json"
      },
      timeout: 30000
    });
  });

  it("should get quote", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { route: "test" } });
    const result = await client.getQuote({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000"
    });
    expect(mockHttp.get).toHaveBeenCalledWith("/trade/quote", {
      params: {
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1000000"
      }
    });
    expect(result.raw).toEqual({ route: "test" });
  });

  it("should create swap", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { transaction: "base64tx", swapTransaction: "base64tx2" } });
    const result = await client.createSwap({
      wallet: "wallet123",
      quoteResponse: { route: "test" }
    });
    expect(mockHttp.post).toHaveBeenCalledWith("/trade/swap", {
      wallet: "wallet123",
      quoteResponse: { route: "test" }
    });
    expect(result.transaction).toBe("base64tx");
  });

  it("should create token info", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { metadataUri: "https://arweave.net/abc" } });
    const result = await client.createTokenInfo({ name: "Test", symbol: "TST" });
    expect(mockHttp.post).toHaveBeenCalledWith("/token-launch/create-token-info", { name: "Test", symbol: "TST" });
    expect(result.metadataUri).toBe("https://arweave.net/abc");
  });

  it("should create launch tx", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { transaction: "launchTx", mint: "mintAddr" } });
    const result = await client.createLaunchTx({
      creator: "creator123",
      tokenInfo: { name: "Test", symbol: "TST" }
    });
    expect(result.transaction).toBe("launchTx");
    expect(result.mint).toBe("mintAddr");
  });

  it("should create fee share config", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { id: "config123", name: "OG Share" } });
    const result = await client.createFeeShareConfig({
      name: "OG Share",
      shares: [{ wallet: "w1", bps: 10000 }]
    });
    expect(result.id).toBe("config123");
    expect(result.name).toBe("OG Share");
  });

  it("should get claimable positions", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { positions: [{ mint: "m1", amount: "100" }] } });
    const result = await client.getClaimablePositions({ wallet: "wallet1" });
    expect(mockHttp.get).toHaveBeenCalledWith("/token-launch/claimable-positions", {
      params: { wallet: "wallet1" }
    });
    expect(result.raw).toEqual({ positions: [{ mint: "m1", amount: "100" }] });
  });

  it("should create claim tx v3", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { transaction: "claimTx" } });
    const result = await client.getClaimTxV3({ wallet: "w1", mint: "m1" });
    expect(result.transaction).toBe("claimTx");
  });

  it("should get token lifetime fees", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { totalFees: "500" } });
    const result = await client.getTokenLifetimeFees("mintAddr");
    expect(mockHttp.get).toHaveBeenCalledWith("/token-launch/lifetime-fees", { params: { tokenMint: "mintAddr" } });
    expect(result.raw).toEqual({ totalFees: "500" });
  });

  it("should send transaction", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { signature: "sig123" } });
    const result = await client.sendTransaction({ tx: "base64tx" });
    expect(result.signature).toBe("sig123");
  });

  it("should ping bags api", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { status: "ok" } });
    const result = await client.ping();
    expect(mockHttp.get).toHaveBeenCalledWith("/ping");
    expect(result).toEqual({ status: "ok" });
  });
});
