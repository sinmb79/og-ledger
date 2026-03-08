import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  config: { bagsApiKey: "test-key", bagsWallet: "testWallet", solanaRpc: "https://test.rpc" }
}));

const { mockPrepare, mockVerifyWallet } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockVerifyWallet: vi.fn(),
}));

vi.mock("../db", () => ({
  db: { prepare: mockPrepare }
}));

vi.mock("../services/og-verify", () => ({
  OgVerifyService: vi.fn(function OgVerifyServiceMock(this: any) {
    this.verifyWallet = mockVerifyWallet;
  })
}));

import ogRouter from "./og";

function getHandler(method: "get" | "post", path: string) {
  const layer = (ogRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} handler found`);
  const handlers = layer.route.stack.filter((s: any) => s.method === method);
  return handlers[handlers.length - 1].handle;
}

function mockRes() {
  const res: any = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

describe("og routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/og/verify/:wallet", () => {
    it("should return cached result if wallet exists in DB", async () => {
      const cachedMember = {
        wallet: "testWallet123456789012345678901234",
        sol_amount: 3.0,
        tx_signature: "cachedSig",
        verified_at: "2024-02-01"
      };
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(cachedMember) });

      const handler = getHandler("get", "/api/og/verify/:wallet");
      const req = { params: { wallet: "testWallet123456789012345678901234" } } as any;
      const res = mockRes();
      const next = vi.fn();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          cached: true,
          data: expect.objectContaining({ verified: true, solAmount: 3.0 })
        })
      );
    });

    it("should verify on-chain and persist when not cached", async () => {
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
      mockVerifyWallet.mockResolvedValueOnce({
        verified: true,
        solAmount: 1.5,
        txSignature: "newSig"
      });
      const mockRun = vi.fn();
      mockPrepare.mockReturnValueOnce({ run: mockRun });

      const handler = getHandler("get", "/api/og/verify/:wallet");
      const req = { params: { wallet: "newWallet12345678901234567890123456" } } as any;
      const res = mockRes();
      const next = vi.fn();
      await handler(req, res, next);

      expect(mockRun).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          cached: false,
          data: expect.objectContaining({ verified: true, solAmount: 1.5 })
        })
      );
    });

    it("should return not verified without persisting", async () => {
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
      mockVerifyWallet.mockResolvedValueOnce({
        verified: false,
        reason: "No matching OG payment"
      });

      const handler = getHandler("get", "/api/og/verify/:wallet");
      const req = { params: { wallet: "noOGwallet1234567890123456789012345" } } as any;
      const res = mockRes();
      const next = vi.fn();
      await handler(req, res, next);

      expect(mockPrepare).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verified: false })
        })
      );
    });
  });

  describe("GET /api/og/stats", () => {
    it("should return aggregated stats", async () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 5, totalSol: 12.0 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ c: 3 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ c: 2 }) });

      const handler = getHandler("get", "/api/og/stats");
      const res = mockRes();
      const next = vi.fn();
      await handler({} as any, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { count: 5, totalSol: 12.0, sol3Count: 3, sol15Count: 2 }
      });
    });
  });

  describe("GET /api/og/registry", () => {
    it("should return member list with total", async () => {
      const members = [
        { wallet: "w1", sol_amount: 3.0, tx_signature: "s1", verified_at: "2024-02-01", created_at: "2024-02-01" },
        { wallet: "w2", sol_amount: 1.5, tx_signature: "s2", verified_at: "2024-02-02", created_at: "2024-02-02" }
      ];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(members) });

      const handler = getHandler("get", "/api/og/registry");
      const res = mockRes();
      const next = vi.fn();
      await handler({} as any, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { count: 2, totalSol: 4.5, members }
      });
    });
  });
});
