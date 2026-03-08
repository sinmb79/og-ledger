import { beforeEach, describe, expect, it, vi } from "vitest";

function getRouteHandler(router: any, method: "get" | "post", path: string) {
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>;
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("nft routes", () => {
  let prepareMintTx: ReturnType<typeof vi.fn>;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let nftRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    prepareMintTx = vi.fn();
    mockPrepare = vi.fn();

    vi.doMock("../services/nft-mint", () => ({
      NftMintService: vi.fn(function NftMintServiceMock(this: unknown) {
        return { prepareMintTx };
      }),
    }));

    vi.doMock("../db", () => ({
      db: {
        prepare: mockPrepare,
      },
    }));

    ({ default: nftRouter } = await import("./nft"));
  });

  it("POST /api/nft/prepare-mint validates required fields", async () => {
    const handler = getRouteHandler(nftRouter, "post", "/api/nft/prepare-mint");
    const res = createRes();

    await handler({ body: { creator: "wallet", name: "Badge" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prepareMintTx).not.toHaveBeenCalled();
  });

  it("POST /api/nft/prepare-mint returns serialized transaction and persists prepared asset", async () => {
    const run = vi.fn();
    mockPrepare.mockReturnValue({ run });
    prepareMintTx.mockResolvedValue({
      transaction: "base64tx",
      mint: "mint-1",
      metadataPda: "meta-1",
      masterEditionPda: "edition-1",
    });

    const handler = getRouteHandler(nftRouter, "post", "/api/nft/prepare-mint");
    const res = createRes();

    await handler(
      {
        body: {
          creator: "wallet-1",
          name: "OG Badge",
          symbol: "OGB",
          uri: "https://example.com/metadata.json",
        },
      },
      res,
      vi.fn(),
    );

    expect(run).toHaveBeenCalledWith(
      "mint-1",
      "wallet-1",
      "OG Badge",
      "OGB",
      "https://example.com/metadata.json",
      "meta-1",
      "edition-1",
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        transaction: "base64tx",
        mint: "mint-1",
        metadataPda: "meta-1",
        masterEditionPda: "edition-1",
      },
    });
  });

  it("POST /api/nft/record-mint stores signature and marks minted", async () => {
    const runUpdate = vi.fn();
    const runInsert = vi.fn();
    mockPrepare.mockReturnValueOnce({ run: runUpdate }).mockReturnValueOnce({ run: runInsert });

    const handler = getRouteHandler(nftRouter, "post", "/api/nft/record-mint");
    const res = createRes();

    await handler(
      { body: { mint: "mint-1", creator: "wallet-1", txSignature: "sig-1" } },
      res,
      vi.fn(),
    );

    expect(runUpdate).toHaveBeenCalledWith("sig-1", "mint-1", "wallet-1");
    expect(runInsert).toHaveBeenCalledWith("wallet-1", "sig-1");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { mint: "mint-1", txSignature: "sig-1" },
    });
  });

  it("GET /api/nft/assets returns list", async () => {
    const all = vi.fn().mockReturnValue([{ mint: "m1" }]);
    mockPrepare.mockReturnValue({ all });

    const handler = getRouteHandler(nftRouter, "get", "/api/nft/assets");
    const res = createRes();

    await handler({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { count: 1, assets: [{ mint: "m1" }] },
    });
  });
});
