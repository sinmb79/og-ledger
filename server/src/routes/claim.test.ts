import { beforeEach, describe, expect, it, vi } from "vitest";

function getRouteHandler(router: any, method: "get" | "post", path: string) {
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>;
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
}

describe("claim routes", () => {
  let getClaimablePositions: ReturnType<typeof vi.fn>;
  let getClaimTxV3: ReturnType<typeof vi.fn>;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let claimRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    getClaimablePositions = vi.fn();
    getClaimTxV3 = vi.fn();
    mockPrepare = vi.fn();

    vi.doMock("../services/bags-api", () => ({
      BagsApiClient: vi.fn(function BagsApiClientMock(this: unknown) {
        return { getClaimablePositions, getClaimTxV3 };
      })
    }));

    vi.doMock("../db", () => ({
      db: {
        prepare: mockPrepare
      }
    }));

    ({ default: claimRouter } = await import("./claim"));
  });

  it("GET /api/claim/:wallet validates wallet", async () => {
    const handler = getRouteHandler(claimRouter, "get", "/api/claim/:wallet");
    const res = createRes();

    await handler({ params: { wallet: "short" }, query: {} }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getClaimablePositions).not.toHaveBeenCalled();
  });

  it("GET /api/claim/:wallet passes query params", async () => {
    getClaimablePositions.mockResolvedValue({ raw: [{ mint: "m1" }] });
    const handler = getRouteHandler(claimRouter, "get", "/api/claim/:wallet");
    const res = createRes();

    await handler(
      {
        params: { wallet: "11111111111111111111111111111111" },
        query: { page: "2", pageSize: "10" }
      },
      res,
      vi.fn()
    );

    expect(getClaimablePositions).toHaveBeenCalledWith({ wallet: "11111111111111111111111111111111", page: 2, pageSize: 10 });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ mint: "m1" }] });
  });

  it("POST /api/claim/execute records claim attempts", async () => {
    const run = vi.fn();
    mockPrepare.mockReturnValue({ run });
    getClaimTxV3.mockResolvedValue({ transaction: "tx", raw: { ok: true } });
    const handler = getRouteHandler(claimRouter, "post", "/api/claim/execute");
    const res = createRes();

    await handler({ body: { wallet: "w1", mint: "mint-1", amount: "5" } }, res, vi.fn());

    expect(getClaimTxV3).toHaveBeenCalledWith({ wallet: "w1", mint: "mint-1", amount: "5" });
    expect(run).toHaveBeenCalledWith("w1", "pending:mint-1");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { transaction: "tx", raw: { ok: true } }
    });
  });
});
