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

describe("swap routes", () => {
  let getQuote: ReturnType<typeof vi.fn>;
  let createSwap: ReturnType<typeof vi.fn>;
  let swapRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    getQuote = vi.fn();
    createSwap = vi.fn();

    vi.doMock("../services/bags-api", () => ({
      BagsApiClient: vi.fn(function BagsApiClientMock(this: unknown) {
        return { getQuote, createSwap };
      })
    }));

    ({ default: swapRouter } = await import("./swap"));
  });

  it("GET /api/swap/quote validates required params", async () => {
    const handler = getRouteHandler(swapRouter, "get", "/api/swap/quote");
    const res = createRes();

    await handler({ query: { inputMint: "a" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("GET /api/swap/quote forwards quote query", async () => {
    getQuote.mockResolvedValue({ raw: { outAmount: "99" } });
    const handler = getRouteHandler(swapRouter, "get", "/api/swap/quote");
    const res = createRes();

    await handler(
      {
        query: {
          inputMint: "A",
          outputMint: "B",
          amount: "100",
          swapMode: "ExactIn",
          slippageBps: "50",
          platformFeeBps: "20"
        }
      },
      res,
      vi.fn()
    );

    expect(getQuote).toHaveBeenCalledWith({
      inputMint: "A",
      outputMint: "B",
      amount: "100",
      swapMode: "ExactIn",
      slippageBps: 50,
      platformFeeBps: 20
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { outAmount: "99" } });
  });

  it("POST /api/swap/execute creates swap tx", async () => {
    createSwap.mockResolvedValue({ transaction: "tx", raw: { ok: true } });
    const handler = getRouteHandler(swapRouter, "post", "/api/swap/execute");
    const res = createRes();

    await handler({ body: { wallet: "w", quoteResponse: { route: 1 }, wrapAndUnwrapSol: true } }, res, vi.fn());

    expect(createSwap).toHaveBeenCalledWith({ wallet: "w", quoteResponse: { route: 1 }, wrapAndUnwrapSol: true });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { transaction: "tx", raw: { ok: true } }
    });
  });
});
