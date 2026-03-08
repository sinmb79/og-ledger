import { NextFunction, Request, Response } from "express";

interface RequestRecord {
  timestamp: number;
}

interface IpRecord {
  requests: RequestRecord[];
}

const ipStore = new Map<string, IpRecord>();
const LIMIT = 100; // requests per minute
const WINDOW_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL = 5 * 60 * 1000; // cleanup every 5 minutes

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipStore.entries()) {
    record.requests = record.requests.filter(r => now - r.timestamp < WINDOW_MS);
    if (record.requests.length === 0) {
      ipStore.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  if (!ipStore.has(ip)) {
    ipStore.set(ip, { requests: [] });
  }

  const record = ipStore.get(ip)!;
  record.requests = record.requests.filter(r => now - r.timestamp < WINDOW_MS);

  if (record.requests.length >= LIMIT) {
    res.status(429).json({ success: false, message: "Too many requests" });
    return;
  }

  record.requests.push({ timestamp: now });
  next();
}
