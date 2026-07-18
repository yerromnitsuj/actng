import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { ReservingError } from "@actuarial-ts/core";
import { HttpError } from "./services/workspaceService.js";

/**
 * Central error translation: typed errors become structured responses;
 * anything unexpected is logged with context and returned as a 500. Lives in
 * its own module (rather than inline in index.ts, which listens on import)
 * so route-level tests mount the SAME translation the server runs.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ReservingError) {
    res.status(422).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    res.status(400).json({
      error: {
        code: "VALIDATION",
        message: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid request"}`,
      },
    });
    return;
  }
  if (err instanceof MulterError) {
    res.status(400).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const anyErr = err as { statusCode?: number; code?: string; message?: string };
  if (typeof anyErr?.statusCode === "number" && anyErr.statusCode < 500) {
    res.status(anyErr.statusCode).json({
      error: { code: anyErr.code ?? "ERROR", message: anyErr.message ?? "Request failed" },
    });
    return;
  }
  console.error(`[server] Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}
