import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  config: { apiSecret: "" }
}));

import { apiKeyAuth } from "./auth";
import { config } from "../config";

function mockReqResNext(headers: Record<string, string> = {}) {
  const req = { headers } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe("apiKeyAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip auth when apiSecret is not configured", () => {
    (config as any).apiSecret = "";
    const { req, res, next } = mockReqResNext();
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 when api key is missing", () => {
    (config as any).apiSecret = "test-secret";
    const { req, res, next } = mockReqResNext();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when api key is wrong", () => {
    (config as any).apiSecret = "test-secret";
    const { req, res, next } = mockReqResNext({ "x-api-key": "wrong-key" });
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next when api key matches", () => {
    (config as any).apiSecret = "test-secret";
    const { req, res, next } = mockReqResNext({ "x-api-key": "test-secret" });
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
