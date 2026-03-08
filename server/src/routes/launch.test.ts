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

describe("launch routes", () => {
  let createTokenInfo: ReturnType<typeof vi.fn>;
  let createLaunchTx: ReturnType<typeof vi.fn>;
  let createFeeShareConfig: ReturnType<typeof vi.fn>;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let launchRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    createTokenInfo = vi.fn();
    createLaunchTx = vi.fn();
    createFeeShareConfig = vi.fn();
    mockPrepare = vi.fn();

    vi.doMock("../services/bags-api", () => ({
      BagsApiClient: vi.fn(function BagsApiClientMock(this: unknown) {
        return { createTokenInfo, createLaunchTx, createFeeShareConfig };
      })
    }));

    vi.doMock("../db", () => ({
      db: {
        prepare: mockPrepare
      }
    }));

    ({ default: launchRouter } = await import("./launch"));
  });

  it("POST /api/launch/preview validates required fields", async () => {
    const handler = getRouteHandler(launchRouter, "post", "/api/launch/preview");
    const res = createRes();

    await handler({ body: { name: "OnlyName" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createTokenInfo).not.toHaveBeenCalled();
  });

  it("POST /api/launch/preview returns metadataUri", async () => {
    createTokenInfo.mockResolvedValue({ metadataUri: "ipfs://x", raw: { ok: true } });
    const handler = getRouteHandler(launchRouter, "post", "/api/launch/preview");
    const res = createRes();

    await handler({ body: { name: "Token", symbol: "TKN" } }, res, vi.fn());

    expect(createTokenInfo).toHaveBeenCalledWith({
      name: "Token",
      symbol: "TKN",
      description: undefined,
      image: undefined,
      twitter: undefined,
      telegram: undefined,
      website: undefined
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { metadataUri: "ipfs://x", raw: { ok: true } }
    });
  });

  it("POST /api/launch/execute persists token when mint exists", async () => {
    const run = vi.fn();
    mockPrepare.mockReturnValue({ run });
    createLaunchTx.mockResolvedValue({ transaction: "tx", mint: "mint-1", raw: { ok: true } });
    const handler = getRouteHandler(launchRouter, "post", "/api/launch/execute");
    const res = createRes();

    await handler({ body: { creator: "wallet", name: "Token", symbol: "TKN", feeShareConfigId: "cfg" } }, res, vi.fn());

    expect(run).toHaveBeenCalledWith("mint-1", "Token", "TKN", "wallet", "cfg");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { transaction: "tx", mint: "mint-1", raw: { ok: true } }
    });
  });

  it("POST /api/launch/fee-share-config enforces 10000 bps", async () => {
    const handler = getRouteHandler(launchRouter, "post", "/api/launch/fee-share-config");
    const res = createRes();

    await handler({ body: { name: "cfg", shares: [{ wallet: "w", bps: 1000 }] } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createFeeShareConfig).not.toHaveBeenCalled();
  });

  it("GET /api/launch/tokens returns token list", async () => {
    const all = vi.fn().mockReturnValue([{ mint: "m1" }]);
    mockPrepare.mockReturnValue({ all });
    const handler = getRouteHandler(launchRouter, "get", "/api/launch/tokens");
    const res = createRes();

    await handler({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { count: 1, tokens: [{ mint: "m1" }] }
    });
  });
});
