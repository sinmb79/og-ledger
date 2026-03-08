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

describe("analytics routes", () => {
  let getTokenLifetimeFees: ReturnType<typeof vi.fn>;
  let getTokenClaimStats: ReturnType<typeof vi.fn>;
  let getTokenClaimEvents: ReturnType<typeof vi.fn>;
  let getTokenCreatorV3: ReturnType<typeof vi.fn>;
  let getPartnerStats: ReturnType<typeof vi.fn>;
  let getBagsPools: ReturnType<typeof vi.fn>;
  let getBagsPoolByMint: ReturnType<typeof vi.fn>;
  let analyticsRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    getTokenLifetimeFees = vi.fn();
    getTokenClaimStats = vi.fn();
    getTokenClaimEvents = vi.fn();
    getTokenCreatorV3 = vi.fn();
    getPartnerStats = vi.fn();
    getBagsPools = vi.fn();
    getBagsPoolByMint = vi.fn();

    vi.doMock("../services/bags-api", () => ({
      BagsApiClient: vi.fn(function BagsApiClientMock(this: unknown) {
        return {
          getTokenLifetimeFees,
          getTokenClaimStats,
          getTokenClaimEvents,
          getTokenCreatorV3,
          getPartnerStats,
          getBagsPools,
          getBagsPoolByMint
        };
      })
    }));

    ({ default: analyticsRouter } = await import("./analytics"));
  });

  it("GET /api/analytics/token/:mint aggregates lifetime fees and claim stats", async () => {
    getTokenLifetimeFees.mockResolvedValue({ raw: { fees: 10 } });
    getTokenClaimStats.mockResolvedValue({ raw: { claims: 2 } });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/token/:mint");
    const res = createRes();

    await handler({ params: { mint: "mint-1" } }, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { mint: "mint-1", lifetimeFees: { fees: 10 }, claimStats: { claims: 2 } }
    });
  });

  it("GET /api/analytics/token/:mint/claim-events forwards query options", async () => {
    getTokenClaimEvents.mockResolvedValue({ raw: [{ id: 1 }] });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/token/:mint/claim-events");
    const res = createRes();

    await handler(
      { params: { mint: "mint-1" }, query: { mode: "all", limit: "10", offset: "5", from: "a", to: "b" } },
      res,
      vi.fn()
    );

    expect(getTokenClaimEvents).toHaveBeenCalledWith({ tokenMint: "mint-1", mode: "all", limit: 10, offset: 5, from: "a", to: "b" });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });
  });

  it("GET /api/analytics/token/:mint/creator returns creator data", async () => {
    getTokenCreatorV3.mockResolvedValue({ raw: { creator: "wallet" } });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/token/:mint/creator");
    const res = createRes();

    await handler({ params: { mint: "mint-1" } }, res, vi.fn());

    expect(getTokenCreatorV3).toHaveBeenCalledWith("mint-1");
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { creator: "wallet" } });
  });

  it("GET /api/analytics/platform returns partner stats", async () => {
    getPartnerStats.mockResolvedValue({ raw: { partnerFees: 20 } });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/platform");
    const res = createRes();

    await handler({ query: { partner: "partner-wallet" } }, res, vi.fn());

    expect(getPartnerStats).toHaveBeenCalledWith({ partner: "partner-wallet" });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { partnerFees: 20 } });
  });

  it("GET /api/analytics/pools returns pools list", async () => {
    getBagsPools.mockResolvedValue({ raw: [{ pool: 1 }] });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/pools");
    const res = createRes();

    await handler({ query: { onlyMigrated: "true" } }, res, vi.fn());

    expect(getBagsPools).toHaveBeenCalledWith({ onlyMigrated: true });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ pool: 1 }] });
  });

  it("GET /api/analytics/pool/:mint returns single pool", async () => {
    getBagsPoolByMint.mockResolvedValue({ raw: { pool: "mint-1" } });
    const handler = getRouteHandler(analyticsRouter, "get", "/api/analytics/pool/:mint");
    const res = createRes();

    await handler({ params: { mint: "mint-1" } }, res, vi.fn());

    expect(getBagsPoolByMint).toHaveBeenCalledWith("mint-1");
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { pool: "mint-1" } });
  });
});
