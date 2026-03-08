import { describe, it, expect, vi } from "vitest";
import { rateLimiter } from "./rate-limit";

function mockReqResNext(ip = "127.0.0.1") {
  const req = { ip, socket: { remoteAddress: ip } } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe("rateLimiter", () => {
  it("should allow requests under the limit", () => {
    const { req, res, next } = mockReqResNext("10.0.0.1");
    rateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should block requests over the limit", () => {
    const testIp = "10.0.0.99";

    for (let i = 0; i < 100; i++) {
      const { req, res, next } = mockReqResNext(testIp);
      rateLimiter(req, res, next);
    }

    const { req, res, next } = mockReqResNext(testIp);
    rateLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Too many requests" });
    expect(next).not.toHaveBeenCalled();
  });
});
