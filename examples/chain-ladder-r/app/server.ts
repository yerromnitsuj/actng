/**
 * The chain-ladder example, as a running app — R engine.
 *
 * This server is what the CLI spine (../src/main.ts) looks like when a host
 * wraps it in HTTP: the SAME tools, the SAME ledger discipline, the SAME
 * advisor — plus a browser page. Its two siblings differ ONLY in the
 * computeWithEngine body and the engine banner: this app shells out to
 * Rscript for every compute (tools/interop/run-cl.R — a chain-ladder
 * projection from SUPPLIED per-column LDFs, since MackChainLadder always
 * derives its own and cannot accept these); the TypeScript app runs
 * @actuarial-ts/core in-process, the Python app calls the chainladder-python
 * sidecar.
 *
 * Everything secret lives HERE, never in the page: the Anthropic key (read
 * by the provider SDK from the environment at call time), any engine
 * credentials, and the tenant. The browser sends clicks; the server decides
 * who is acting. State is in-memory for one demo session — a real host adds
 * storage and auth, not different seams.
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  computeDevelopmentFactors,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import { parseDocument, triangleToDoc } from "@actuarial-ts/interchange";
import {
  createLedger,
  generateDisclosure,
  recordAssumption,
  type AssumptionLedger,
} from "@actuarial-ts/compliance";
import {
  createReservingAdvisor,
  defineActuarialTool,
  toolRegistry,
} from "@actuarial-ts/agents";
import { RequestContext } from "@mastra/core/request-context";
import { rscriptAvailable, runRscript } from "../src/rscript.js";

// ---------------------------------------------------------------- the data
const TAYLOR_ASHE: (number | null)[][] = [
  [357848, 1124788, 1735330, 2218270, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
  [352118, 1236139, 2170033, 3353322, 3799067, 4120063, 4647867, 4914039, 5339085, null],
  [290507, 1292306, 2218525, 3235179, 3985995, 4132918, 4628910, 4909315, null, null],
  [310608, 1418858, 2195047, 3757447, 4029929, 4381982, 4588268, null, null, null],
  [443160, 1136350, 2128333, 2897821, 3402672, 3873311, null, null, null, null],
  [396132, 1333217, 2180715, 2985752, 3691712, null, null, null, null, null],
  [440832, 1288463, 2419861, 3483130, null, null, null, null, null, null],
  [359480, 1421128, 2864498, null, null, null, null, null, null, null],
  [376686, 1363294, null, null, null, null, null, null, null, null],
  [344014, null, null, null, null, null, null, null, null, null],
];
const ORIGINS = ["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010"];
const AGES = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];
/** Boot-time constant for interchange documents (they stay deterministic per boot). */
const BOOT_AT = new Date().toISOString(); // host clock: servers own time; the SDK never reads it

const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);
const factors = computeDevelopmentFactors(triangle);
const triangleDoc = triangleToDoc(triangle, { createdAt: BOOT_AT, valuationDate: "2010-12-31" });
const DEV_COLS = AGES.length - 1;

// -------------------------------------------------------------- preflight
/**
 * Rscript IS this engine's compute backend — unlike @actuarial-ts/core,
 * which runs in-process, there is no math here without it. A CLI boot with
 * no Rscript on PATH fails loud with the exact install command, the same
 * posture as the CLI spine (../src/main.ts), rather than starting a server
 * whose every /api/compute silently 502s. Tests import this module directly
 * (never via `server.ts` on argv[1]), so they always run live here — Rscript
 * is a subprocess, not environment-scoped config, so there is nothing for a
 * test to override.
 */
if (process.argv[1]?.endsWith("server.ts") && !rscriptAvailable()) {
  console.error(
    "chain-ladder-r app needs Rscript on PATH: brew install r\n" +
      "  then: see tools/interop/README.md (ChainLadder + jsonlite)",
  );
  process.exit(2);
}
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUN_CL = join(REPO_ROOT, "tools", "interop", "run-cl.R");

// ------------------------------------------------------------- the engine
/** THE ONLY ENGINE-SPECIFIC CODE. Siblings replace this body. */
const ENGINE = { name: "R (ldf projection)", badge: "computed by Rscript (R)" };
async function computeWithEngine(selections: LdfSelections) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "cl-r-app-"));
  try {
    const triPath = join(dir, "triangle.json");
    const outPath = join(dir, "result.json");
    writeFileSync(triPath, JSON.stringify(triangleDoc));
    const ran = await runRscript(RUN_CL, [
      "--in", triPath,
      "--ldfs", selections.selected.join(","),
      "--tail", String(selections.tailFactor),
      "--out", outPath,
      "--created-at", BOOT_AT,
    ]);
    if (!ran.ok) {
      throw new Error(
        `${ran.code}: ${ran.message}` + " — install R: brew install r; see tools/interop/README.md",
      );
    }
    const raw: unknown = JSON.parse(readFileSync(outPath, "utf8"));
    const parsed = parseDocument(raw, { strictness: "refuse" });
    if (parsed.doc.kind !== "method-result") {
      throw new Error(`expected a method-result document from Rscript, got kind "${parsed.doc.kind}"`);
    }
    const { rows, totals } = parsed.doc.result;
    return {
      rows: rows.map((r) => {
        const withLatest = r as typeof r & { latest?: number };
        return {
          origin: r.origin,
          latest: typeof withLatest.latest === "number" ? withLatest.latest : r.ultimate - r.unpaid,
          ultimate: r.ultimate,
          unpaid: r.unpaid,
        };
      }),
      totals: { ultimate: totals.ultimate, unpaid: totals.unpaid },
      engineMs: Date.now() - t0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------- app state
interface Committed {
  selections: { selected: number[]; tailFactor: number };
  totals: { ultimate: number; unpaid: number } | null;
}
let ledger: AssumptionLedger = createLedger();
let committed: Committed | null = null;
/** One advisor turn at a time: pendingProposals is shared, so a concurrent
 * chat could drain another turn's proposal onto the wrong SSE connection. */
let chatBusy = false;
/** One commit at a time: the ledger append and the committed write must land
 * as one judgment. The engine call between them can suspend (HTTP sidecar /
 * Rscript in the sibling apps), so an overlapping commit could otherwise
 * leave `committed` staler than the ledger's latest entries — inside the
 * generated disclosure itself. Same single-flight posture as chatBusy. */
let commitBusy = false;
const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
if (allWtd === undefined) throw new Error("expected an all-wtd average");
// Narrowing above doesn't cross the request-handler closure below (a
// TypeScript limitation, not a runtime concern); capture the non-null value.
const ALL_WTD_VALUES: (number | null)[] = allWtd.values;

function currentDisclosure(): string {
  return generateDisclosure({
    title: "Taylor & Ashe — interactive chain ladder (R ldf-projection engine)",
    metadata: {
      intendedPurpose: "interactive worked example accompanying the actuarial-ts SDK",
      intendedMeasure: { kind: "central-estimate" },
      basis: { grossNet: "gross", laeTreatment: "excluding-lae" },
      accountingDate: "2010-12-31",
      valuationDate: "2010-12-31",
    },
    methods: [
      {
        methodId: "chainLadder",
        basisLabel: "paid",
        ...(committed !== null && committed.totals !== null
          ? { resultSummary: committed.totals }
          : {}),
      },
    ],
    ledger,
    sdkVersion: "0.3.0",
    generatedAt: new Date().toISOString(), // host clock, see docblock
  });
}

// ---------------------------------------------------- tenant + tools + AI
/**
 * THE SECURITY SEAM: identity is set here, server-side, exactly as a real
 * host would set it from its authenticated session. The browser never sends
 * a projectId or an actor identity — and the tools would fail closed if the
 * context were missing.
 */
const requestContext = new RequestContext();
requestContext.set("projectId", "example-app");
requestContext.set("actorIdentity", "app-demo@example.com (local session)");

const selectionShape = {
  selected: z.array(z.number().positive()).length(DEV_COLS),
  tailFactor: z.number().positive(),
};

// Single chat at a time by design (see CHAT_BUSY), so the queue cannot bleed
// across turns; a multi-session host would scope proposals per conversation.
const pendingProposals: { selected: number[]; tailFactor: number; reasoning: string }[] = [];

const getTriangle = defineActuarialTool({
  id: "get_triangle",
  description: "Returns the Taylor & Ashe triangle document being analyzed",
  kind: "read",
  tenant: "required",
  inputSchema: z.object({}),
  execute: async () => ({ success: true as const, doc: triangleDoc }),
});
const computeChainLadder = defineActuarialTool({
  id: "compute_chain_ladder",
  description:
    "Runs the chain ladder for the given per-column LDFs and tail factor; returns per-origin and total ultimates and unpaid",
  kind: "read",
  tenant: "required",
  inputSchema: z.object(selectionShape),
  execute: async (input) => ({
    success: true as const,
    ...(await computeWithEngine({ selected: input.selected, tailFactor: input.tailFactor })),
  }),
});
const proposeSelection = defineActuarialTool({
  id: "propose_selection",
  description:
    "Proposes a complete selection (per-column LDFs plus tail) for the actuary to review and apply. Call this whenever you recommend specific factors.",
  kind: "read",
  tenant: "required",
  inputSchema: z.object({ ...selectionShape, reasoning: z.string() }),
  execute: async (input) => {
    pendingProposals.push({
      selected: input.selected,
      tailFactor: input.tailFactor,
      reasoning: input.reasoning,
    });
    return { success: true as const, acknowledged: true };
  },
});
const registry = toolRegistry([getTriangle, computeChainLadder, proposeSelection]);

// -------------------------------------------------------------- http bits
type Json = Record<string, unknown>;
function sendJson(res: import("node:http").ServerResponse, status: number, body: Json): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function envelope(code: string, message: string): Json {
  return { success: false, error: { code, message } };
}
async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
/** text-delta extraction across @mastra/core chunk shapes (1.49 + legacy). */
function textDeltaOf(chunk: unknown): string | null {
  const c = chunk as { type?: string; delta?: string; payload?: { text?: string; delta?: string } };
  if (c.type !== "text-delta") return null;
  return c.delta ?? c.payload?.delta ?? c.payload?.text ?? null;
}
function toolNameOf(chunk: unknown): string | null {
  const c = chunk as { type?: string; toolName?: string; payload?: { toolName?: string } };
  if (c.type !== "tool-call") return null;
  return c.payload?.toolName ?? c.toolName ?? null;
}

const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), "public", "index.html");

// ---------------------------------------------------------------- server
export async function startAppServer(options: { port?: number; advisorEnabled?: boolean } = {}) {
  const advisorEnabled = options.advisorEnabled ?? Boolean(process.env.ANTHROPIC_API_KEY);
  // Constructing the advisor is free and offline; only chat turns call the
  // provider. Built once so every chat shares tool wiring.
  const advisor = advisorEnabled
    ? createReservingAdvisor({
        model: process.env.ACTNG_EVAL_MODEL ?? "anthropic/claude-sonnet-4-5",
        tools: registry.tools,
        domainInstructions: [
          "## This app",
          "You are embedded in an interactive chain-ladder page for the Taylor and Ashe triangle. " +
            "Use get_triangle to inspect the data and compute_chain_ladder to evaluate candidate selections. " +
            "When you recommend specific factors, ALWAYS call propose_selection with the exact per-column values and tail so the actuary can apply them with one click. " +
            "You never commit selections; committing is the actuary's act.",
        ].join("\n"),
      })
    : null;

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    try {
      if (req.method === "GET" && url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(HTML_PATH, "utf8"));
        return;
      }
      if (req.method === "GET" && url === "/api/state") {
        sendJson(res, 200, {
          engine: ENGINE,
          advisorEnabled,
          triangle: { origins: ORIGINS, ages: AGES, values: TAYLOR_ASHE },
          averages: factors.averages.map((a) => ({
            key: a.spec.key,
            label: a.spec.label,
            values: a.values,
          })),
          defaults: { selected: ALL_WTD_VALUES, tailFactor: 1 },
          committed,
          ledger: ledger.entries,
        });
        return;
      }
      if (req.method === "GET" && url === "/api/disclosure") {
        sendJson(res, 200, { success: true, disclosure: currentDisclosure() });
        return;
      }
      if (req.method === "POST" && url === "/api/compute") {
        const parsed = z.object(selectionShape).safeParse(await readJson(req));
        if (!parsed.success) {
          sendJson(res, 400, envelope("BAD_INPUT", parsed.error.issues[0]?.message ?? "invalid"));
          return;
        }
        try {
          sendJson(res, 200, { success: true, ...(await computeWithEngine(parsed.data)) });
        } catch (err) {
          sendJson(res, 502, envelope("ENGINE_FAILED", err instanceof Error ? err.message : String(err)));
        }
        return;
      }
      if (req.method === "POST" && url === "/api/commit") {
        if (commitBusy) {
          sendJson(res, 429, envelope("COMMIT_BUSY", "one commit at a time in this demo app"));
          return;
        }
        commitBusy = true; // set before any await: no window between check and set
        try {
          const parsed = z
            .object({
              ...selectionShape,
              rationale: z.string().trim().min(1, "a rationale is required to commit"),
              actor: z.enum(["actuary", "agent"]).optional(),
            })
            .safeParse(await readJson(req));
          if (!parsed.success) {
            sendJson(res, 400, envelope("BAD_INPUT", parsed.error.issues[0]?.message ?? "invalid"));
            return;
          }
          const { selected, tailFactor, rationale } = parsed.data;
          const actor = parsed.data.actor ?? "actuary";
          const now = new Date().toISOString(); // host clock, see docblock
          ledger = recordAssumption(
            recordAssumption(ledger, {
              timestamp: now,
              actor,
              field: "chainLadder.ldfs",
              value: selected,
              rationale,
            }),
            { timestamp: now, actor, field: "chainLadder.tailFactor", value: tailFactor, rationale },
          );
          let totals: Committed["totals"] = null;
          try {
            totals = (await computeWithEngine({ selected, tailFactor })).totals;
          } catch {
            totals = null; // engine down: the commit still records; disclosure omits the summary
          }
          committed = { selections: { selected, tailFactor }, totals };
          sendJson(res, 200, {
            success: true,
            ledger: ledger.entries,
            committed,
            disclosure: currentDisclosure(),
          });
        } finally {
          commitBusy = false;
        }
        return;
      }
      if (req.method === "POST" && url === "/api/chat") {
        if (advisor === null) {
          sendJson(
            res,
            503,
            envelope(
              "ADVISOR_DISABLED",
              "No ANTHROPIC_API_KEY in the server environment. export ANTHROPIC_API_KEY=... and restart npm run app.",
            ),
          );
          return;
        }
        if (chatBusy) {
          sendJson(res, 429, envelope("CHAT_BUSY", "one advisor turn at a time in this demo app"));
          return;
        }
        const parsed = z.object({ message: z.string().min(1) }).safeParse(await readJson(req));
        if (!parsed.success) {
          sendJson(res, 400, envelope("BAD_INPUT", "message required"));
          return;
        }
        chatBusy = true;
        try {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          const emit = (ev: Json) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
          try {
            const stream = await advisor.stream([{ role: "user", content: parsed.data.message }], {
              requestContext,
              maxSteps: 8,
            });
            for await (const chunk of stream.fullStream) {
              const delta = textDeltaOf(chunk);
              if (delta !== null) emit({ type: "text", delta });
              const tool = toolNameOf(chunk);
              if (tool !== null) emit({ type: "tool", name: tool });
              while (pendingProposals.length > 0) {
                emit({ type: "proposal", selection: pendingProposals.shift() });
              }
            }
            while (pendingProposals.length > 0) {
              emit({ type: "proposal", selection: pendingProposals.shift() });
            }
          } catch (err) {
            emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
          }
          emit({ type: "done" });
          res.end();
        } finally {
          // A turn's proposals never outlive it: clear any that survived a
          // stream error so they cannot leak into the next chat turn.
          pendingProposals.length = 0;
          chatBusy = false;
        }
        return;
      }
      sendJson(res, 404, envelope("NOT_FOUND", url));
    } catch (err) {
      sendJson(res, 500, envelope("INTERNAL", err instanceof Error ? err.message : String(err)));
    }
  });

  const requestedPort = options.port ?? Number(process.env.APP_PORT ?? 8793);
  await new Promise<void>((resolve) => server.listen(requestedPort, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

/* c8 ignore start */
if (process.argv[1]?.endsWith("server.ts")) {
  const app = await startAppServer();
  console.log(`chain-ladder app (${ENGINE.badge}) → http://127.0.0.1:${app.port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("advisor disabled: export ANTHROPIC_API_KEY=... to enable the chat panel");
  }
}
/* c8 ignore stop */
