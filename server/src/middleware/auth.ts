import { NextFunction, Request, Response } from "express";
import { config } from "../config";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // If no apiSecret configured, skip auth (dev mode)
  if (!config.apiSecret) {
    next();
    return;
  }

  const apiKey = req.headers["x-api-key"] as string;

  if (!apiKey || apiKey !== config.apiSecret) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  next();
}
