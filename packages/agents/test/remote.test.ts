import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runChainLadder, triangleFromGrid } from "@actuarial-ts/core";
import {
  resultToDoc,
  triangleToDoc,
  type MethodResultDoc,
  type TriangleDoc,
} from "@actuarial-ts/interchange";
import { defineRemoteMethod, type RemoteMethodResult } from "../src/remote.js";
import { zodObjectShape } from "../src/tools.js";
import type { ToolEnvelopeFailure } from "../src/tools.js";

/**
 * defineRemoteMethod against a local stub HTTP server (node:http, in-test):
 * the wire shape sent, the envelope mappings (auth, timeout, abort,
 * transport, invalid response document), and the tenant-seam guarantees the
 * factory inherits from defineActuarialTool.
 */

const CREATED_AT = "2026-07-18T00:00:00Z";

/** A tiny valid triangle + chain-ladder result, authored through the real
 * interchange package so integrity tags verify end to end. */
const triangle = triangleFromGrid(
  "paid",
  ["2021", "2022", "2023"],
  [12, 24, 36],
  [
    [100, 180, 200],
    [110, 190, null],
    [120, null, null],
  ],
);
const triangleDoc: TriangleDoc = triangleToDoc(triangle, {
  createdAt: CREATED_AT,
  valuationDate: "2023-12-31",
});
const resultDoc: MethodResultDoc = resultToDoc(
  runChainLadder(triangle, { selected: [1.7, 1.11], tailFactor: 1 }),
  {
    triangleDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "stub" },
  },
);

/** The all-null "nothing extra" input slots (the schema is nullable, not optional). */
const bareInput = {
  selection: null,
  exposure: null,
  parameters: null,
  seed: null,
} as const;

interface StubCapture {
  method?: string;
  url?: string;
  headers?: http.IncomingHttpHeaders;
  body?: unknown;
}

type Responder = (req: http.IncomingMessage, res: http.ServerResponse, capture: StubCapture) => void;

const servers: http.Server[] = [];

async function startStub(respond: Responder): Promise<{ url: string; capture: StubCapture }> {
  const capture: StubCapture = {};
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      capture.method = req.method ?? undefined;
      capture.url = req.url ?? undefined;
      capture.headers = req.headers;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        capture.body = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        capture.body = raw;
      }
      respond(req, res, capture);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, capture };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function makeTool(sidecarUrl: string, extra?: { timeoutMs?: number; headers?: Record<string, string> }) {
  return defineRemoteMethod({
    id: "clpy_chainladder",
    description: "Run chainladder-python Chainladder on interchange documents via the sidecar.",
    sidecarUrl,
    method: "Chainladder",
    ...extra,
  });
}

describe("defineRemoteMethod", () => {
  it("POSTs the spec-7 wire shape, forwards headers, and returns the parsed result document", async () => {
    const { url, capture } = await startStub((_req, res) => json(res, 200, resultDoc));
    const tool = makeTool(url, { headers: { authorization: "Bearer stub-token" } });
    const result = (await tool.execute!(
      {
        triangles: { primary: triangleDoc, secondary: null },
        ...bareInput,
        parameters: {
          average: null,
          n_periods: null,
          strictness: "warn",
          sigma_interpolation: null,
          apriori: null,
          n_iters: null,
          trend: null,
          decay: null,
          growth: null,
          n_sims: null,
        },
      },
      {} as never,
    )) as RemoteMethodResult;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.kind).toBe("method-result");
      expect(result.doc).toEqual(resultDoc);
      expect(result.parseWarnings).toEqual([]);
    }
    expect(capture.method).toBe("POST");
    expect(capture.url).toBe("/v1/run/Chainladder");
    expect(capture.headers?.["authorization"]).toBe("Bearer stub-token");
    expect(capture.headers?.["content-type"]).toBe("application/json");
    // Null slots are OMITTED from the wire; non-null parameters are compacted.
    expect(capture.body).toEqual({
      triangles: { primary: triangleDoc },
      parameters: { strictness: "warn" },
    });
  });

  it("relays the sidecar's own error code on a schema'd 401", async () => {
    const { url } = await startStub((_req, res) =>
      json(res, 401, { error: { code: "UNAUTHORIZED", message: "a valid bearer token is required" } }),
    );
    const tool = makeTool(url);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result).toEqual({
      success: false,
      error: { code: "UNAUTHORIZED", message: "a valid bearer token is required" },
    });
  });

  it("falls back to SIDECAR_HTTP_<status> when a non-2xx body is not schema'd", async () => {
    const { url } = await startStub((_req, res) => {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("upstream down");
    });
    const tool = makeTool(url);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("SIDECAR_HTTP_503");
  });

  it("maps a hung sidecar to SIDECAR_TIMEOUT at the client deadline", async () => {
    const { url } = await startStub(() => {
      /* never respond */
    });
    const tool = makeTool(url, { timeoutMs: 120 });
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("SIDECAR_TIMEOUT");
    expect(result.error.message).toContain("120 ms");
  });

  it("maps a caller abort (Mastra abortSignal, forwarded) to ABORTED", async () => {
    const { url } = await startStub(() => {
      /* never respond */
    });
    const tool = makeTool(url, { timeoutMs: 10_000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      { abortSignal: controller.signal } as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("ABORTED");
  });

  it("maps a dead endpoint to SIDECAR_UNREACHABLE", async () => {
    // Grab a port that is then closed again: nothing listens there.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const tool = makeTool(`http://127.0.0.1:${port}`, { timeoutMs: 2_000 });
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("SIDECAR_UNREACHABLE");
  });

  it("refuses a 2xx body that is not a result document: REMOTE_RESULT_INVALID", async () => {
    const { url } = await startStub((_req, res) => json(res, 200, { hello: "world" }));
    const tool = makeTool(url);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("REMOTE_RESULT_INVALID");
  });

  it("refuses a 2xx result document whose integrity tag is broken: REMOTE_RESULT_INVALID", async () => {
    const tampered = structuredClone(resultDoc) as { result: { totals: { ultimate: number } } };
    tampered.result.totals.ultimate += 1; // body no longer matches the stated tag
    const { url } = await startStub((_req, res) => json(res, 200, tampered));
    const tool = makeTool(url);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("REMOTE_RESULT_INVALID");
    expect(result.error.message).toContain("Integrity tag mismatch");
  });

  it("refuses a 2xx interchange document of a non-result kind: REMOTE_RESULT_INVALID", async () => {
    const { url } = await startStub((_req, res) => json(res, 200, triangleDoc));
    const tool = makeTool(url);
    const result = (await tool.execute!(
      { triangles: { primary: triangleDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("REMOTE_RESULT_INVALID");
  });

  it("validates embedded documents CLIENT-side before anything leaves the process", async () => {
    let reached = false;
    const { url } = await startStub((_req, res) => {
      reached = true;
      json(res, 200, resultDoc);
    });
    const tool = makeTool(url);

    // Wrong kind in the primary slot: refused with the sidecar's vocabulary.
    const wrongKind = (await tool.execute!(
      { triangles: { primary: resultDoc, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(wrongKind.success).toBe(false);
    expect(wrongKind.error.code).toBe("WRONG_DOCUMENT_KIND");

    // A tampered triangle: parseDocument refuses (BAD_INTERCHANGE, enveloped).
    const tamperedTriangle = structuredClone(triangleDoc) as { triangle: { valuationDate: string } };
    tamperedTriangle.triangle.valuationDate = "2024-12-31";
    const badTag = (await tool.execute!(
      { triangles: { primary: tamperedTriangle, secondary: null }, ...bareInput },
      {} as never,
    )) as ToolEnvelopeFailure;
    expect(badTag.success).toBe(false);
    expect(badTag.error.code).toBe("BAD_INTERCHANGE");

    expect(reached).toBe(false);
  });

  it("is a read-kind tool whose model surface cannot express a tenant id", () => {
    const tool = makeTool("http://127.0.0.1:1");
    expect(tool.kind).toBe("read");
    // defineActuarialTool's tenant lint ran at definition time (a violating
    // schema would have thrown TENANT_IN_SCHEMA before this line); the
    // declared surface is exactly the spec-7 wire minus engagementRef.
    const shape = zodObjectShape(tool.inputSchema);
    expect(shape).not.toBeNull();
    expect(Object.keys(shape!).sort()).toEqual(["exposure", "parameters", "seed", "selection", "triangles"]);
    for (const key of Object.keys(shape!)) {
      expect(key).not.toMatch(/^(project|tenant)[_-]?id$/i);
    }
  });
});
