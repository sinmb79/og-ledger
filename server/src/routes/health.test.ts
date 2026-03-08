import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  config: { bagsApiKey: "test-key" }
}));

const { mockPing, mockSendTransaction } = vi.hoisted(() => ({
  mockPing: vi.fn(),
  mockSendTransaction: vi.fn(),
}));

vi.mock("../services/bags-api", () => ({
  BagsApiClient: vi.fn(function BagsApiClientMock(this: any) {
    this.ping = mockPing;
    this.sendTransaction = mockSendTransaction;
  })
}));

import healthRouter from "./health";

function getHandler(method: "get" | "post", path: string) {
  const layer = (healthRouter as any).stack.find(
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

describe("health routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("should return ok status", () => {
      const handler = getHandler("get", "/health");
      const res = mockRes();
      handler({} as any, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", version: "1.0.0" })
      );
    });
  });

  describe("GET /health/bags", () => {
    it("should return connected when ping succeeds", async () => {
      mockPing.mockResolvedValueOnce({ status: "ok" });
      const handler = getHandler("get", "/health/bags");
      const res = mockRes();
      const next = vi.fn();
      await handler({} as any, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ status: "connected" })
        })
      );
    });

    it("should return 502 when ping fails", async () => {
      mockPing.mockRejectedValueOnce(new Error("Connection refused"));
      const handler = getHandler("get", "/health/bags");
      const res = mockRes();
      const next = vi.fn();
      await handler({} as any, res, next);
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Connection refused"
      });
    });
  });

  describe("POST /api/transaction/send", () => {
    it("should return 400 when tx is missing", async () => {
      const handler = getHandler("post", "/api/transaction/send");
      const req = { body: {} } as any;
      const res = mockRes();
      const next = vi.fn();
      await handler(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
