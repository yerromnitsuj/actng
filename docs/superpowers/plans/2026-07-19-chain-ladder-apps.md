# Chain-Ladder Interactive Apps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An `app/` in each shore example: a zero-build page showing the eight computed averages, click-to-select + override + tail, engine-computed ultimates, commit-with-rationale into the assumption ledger with a live ASOP 41 disclosure, and a streaming advisor chat with typed selection proposals.

**Architecture:** Per example: `app/server.ts` (node:http; all secrets and the RequestContext server-side) + `app/public/index.html` (vanilla JS, byte-identical across apps except title/banner) + `test/app.test.ts` (joins the existing suite). The compute handler body is the only engine-specific server code.

**Tech Stack:** node:http, tsx, zod, the five `@actuarial-ts` packages, `@mastra/core` (already devDeps in each example). ZERO new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-chain-ladder-app-design.md` — binding, including §4's per-engine compute contract.

## Global Constraints

- Repo `/Users/justinmorrey/ActNG2`; work on `main`; scoped `git add` only; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **The app contract requires all development columns selected** (numbers, no nulls) — the UI always has full defaults, so `z.array(z.number().positive()).length(triangle.ages.length - 1)`.
- **The server may read the clock** (it is a host); comment this where it happens. Interchange docs built at boot use one `BOOT_AT` constant. The CLI spines' purity is untouched.
- Secrets/tenant server-side only; the browser never sends identity. Ports: ts 8791 / py 8792 / r 8793, `APP_PORT` overrides.
- The advisor is enabled iff `ANTHROPIC_API_KEY` is present at boot (`startAppServer` takes an override for tests). Chat while disabled → 503 `{ success: false, error: { code: "ADVISOR_DISABLED", ... } }`.
- Tests never call a live model and never require a key.
- Anchors: all-wtd + tail 1.0 → ultimate `53_038_946`, unpaid `18_680_856` (rounded).
- `index.html` byte-identical across the three apps EXCEPT `<title>` and the banner string; `server.ts` differs only in: header comment, engine imports, preflight, `computeWithEngine` body, `ENGINE` constant, default port.
- Controller (not implementers) runs the Playwright drive between tasks and ships.

---

### Task A: The TypeScript app (template)

**Files:**
- Create: `examples/chain-ladder-typescript/app/server.ts`
- Create: `examples/chain-ladder-typescript/app/public/index.html`
- Create: `examples/chain-ladder-typescript/test/app.test.ts`
- Modify: `examples/chain-ladder-typescript/package.json` (add `"app": "tsx app/server.ts"` to scripts)

**Interfaces:**
- Produces: `startAppServer(options?: { port?: number; advisorEnabled?: boolean }): Promise<{ port: number; close(): Promise<void> }>` — Tasks B/C clone this file; the test file drives this export.
- Consumes: `@actuarial-ts/core` (`triangleFromGrid`, `computeDevelopmentFactors`, `runChainLadder`, `LdfSelections`), `@actuarial-ts/interchange` (`triangleToDoc`), `@actuarial-ts/compliance` (`createLedger`, `recordAssumption`, `generateDisclosure`), `@actuarial-ts/agents` (`defineActuarialTool`, `toolRegistry`, `createReservingAdvisor`), `@mastra/core/request-context` (`RequestContext`), `zod`.

- [ ] **Step 1: Write the failing test** — `examples/chain-ladder-typescript/test/app.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { startAppServer } from "../app/server.js";

// One server for the whole file, ephemeral port, advisor forced OFF so the
// 503 path is deterministic regardless of the local environment's keys.
const app = await startAppServer({ port: 0, advisorEnabled: false });
const base = `http://127.0.0.1:${app.port}`;
afterAll(() => app.close());

const ALL_WTD_BODY = async () => {
  const state = (await (await fetch(`${base}/api/state`)).json()) as {
    averages: { key: string; values: (number | null)[] }[];
  };
  const allWtd = state.averages.find((a) => a.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected all-wtd in state");
  return { selected: allWtd.values, tailFactor: 1 };
};

describe("the chain-ladder app server", () => {
  it("serves the page at /", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });

  it("exposes the eight computed averages in /api/state", async () => {
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      averages: unknown[];
      advisorEnabled: boolean;
    };
    expect(state.averages).toHaveLength(8);
    expect(state.advisorEnabled).toBe(false);
  });

  it("computes the published anchors for all-wtd + tail 1.0", async () => {
    const res = await fetch(`${base}/api/compute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await ALL_WTD_BODY()),
    });
    const out = (await res.json()) as {
      success: true;
      totals: { ultimate: number; unpaid: number };
    };
    expect(Math.round(out.totals.ultimate)).toBe(53_038_946);
    expect(Math.round(out.totals.unpaid)).toBe(18_680_856);
  });

  it("rejects a commit without a rationale, as a fail-closed envelope", async () => {
    const res = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(await ALL_WTD_BODY()), rationale: "" }),
    });
    const out = (await res.json()) as { success: false; error: { code: string } };
    expect(out.success).toBe(false);
  });

  it("grows the ledger and disclosure Section 5 on a rationaled commit", async () => {
    const res = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(await ALL_WTD_BODY()),
        rationale: "Volume-weighted all-period factors; stable development.",
      }),
    });
    const out = (await res.json()) as {
      success: true;
      ledger: unknown[];
      disclosure: string;
    };
    expect(out.ledger.length).toBeGreaterThan(0);
    expect(out.disclosure).toContain("## 5. Assumptions and judgments");
  });

  it("refuses chat while the advisor is disabled", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(503);
  });
});
```

Run: `npm test -w @actuarial-ts/example-chain-ladder-typescript` → the new file FAILS (`Cannot find module '../app/server.js'`); the existing example suite must stay green.

- [ ] **Step 2: Write `app/server.ts`:**

```ts
/**
 * The chain-ladder example, as a running app — TypeScript engine.
 *
 * This server is what the CLI spine (../src/main.ts) looks like when a host
 * wraps it in HTTP: the SAME tools, the SAME ledger discipline, the SAME
 * advisor — plus a browser page. Its two siblings differ ONLY in the
 * computeWithEngine body and the engine banner: the Python app calls the
 * chainladder-python sidecar, the R app shells out to Rscript.
 *
 * Everything secret lives HERE, never in the page: the Anthropic key (read
 * by the provider SDK from the environment at call time), any engine
 * credentials, and the tenant. The browser sends clicks; the server decides
 * who is acting. State is in-memory for one demo session — a real host adds
 * storage and auth, not different seams.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import { triangleToDoc } from "@actuarial-ts/interchange";
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

// ------------------------------------------------------------- the engine
/** THE ONLY ENGINE-SPECIFIC CODE. Siblings replace this body. */
const ENGINE = { name: "@actuarial-ts/core", badge: "computed in-process (TypeScript)" };
async function computeWithEngine(selections: LdfSelections) {
  const t0 = Date.now();
  const run = runChainLadder(triangle, selections);
  return {
    rows: run.rows.map((r) => ({
      origin: r.origin,
      latest: r.latest,
      ultimate: r.ultimate,
      unpaid: r.unpaid,
    })),
    totals: { ultimate: run.totals.ultimate, unpaid: run.totals.unpaid },
    engineMs: Date.now() - t0,
  };
}

// -------------------------------------------------------------- app state
interface Committed {
  selections: { selected: number[]; tailFactor: number };
  totals: { ultimate: number; unpaid: number } | null;
}
let ledger: AssumptionLedger = createLedger();
let committed: Committed | null = null;
const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
if (allWtd === undefined) throw new Error("expected an all-wtd average");

function currentDisclosure(): string {
  return generateDisclosure({
    title: "Taylor & Ashe — interactive chain ladder (TypeScript engine)",
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
          defaults: { selected: allWtd.values, tailFactor: 1 },
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
        const parsed = z.object({ message: z.string().min(1) }).safeParse(await readJson(req));
        if (!parsed.success) {
          sendJson(res, 400, envelope("BAD_INPUT", "message required"));
          return;
        }
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
        } catch (err) {
          emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
        }
        emit({ type: "done" });
        res.end();
        return;
      }
      sendJson(res, 404, envelope("NOT_FOUND", url));
    } catch (err) {
      sendJson(res, 500, envelope("INTERNAL", err instanceof Error ? err.message : String(err)));
    }
  });

  const requestedPort = options.port ?? Number(process.env.APP_PORT ?? 8791);
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
```

- [ ] **Step 3: Write `app/public/index.html`.** Complete file; the sibling apps change ONLY the `<title>` and the `<h1>` banner suffix (which render from `/api/state`'s engine badge anyway — keep the static strings generic so the file stays byte-identical; only `<title>` differs):

```html
<title>Chain ladder — TypeScript engine</title>
<style>
  :root { font-family: system-ui, sans-serif; color: #1a1d21; background: #fafbfc; }
  body { margin: 0 auto; max-width: 1100px; padding: 1.5rem; }
  h1 { font-size: 1.25rem; } h2 { font-size: 1rem; margin: 1.5rem 0 .5rem; }
  #banner { color: #555; font-size: .85rem; }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: .85rem; }
  .scroll { overflow-x: auto; }
  th, td { border: 1px solid #dde1e6; padding: .3rem .55rem; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  tr.avg td:not(:first-child) { cursor: pointer; }
  tr.avg td:not(:first-child):hover { background: #eef4ff; }
  td.selected { background: #dcebff; font-weight: 600; }
  input.override { width: 5.5rem; text-align: right; font: inherit; }
  #results-strip { display: flex; gap: 2rem; align-items: baseline; margin: .5rem 0; }
  #results-strip .big { font-size: 1.3rem; font-weight: 650; }
  .delta { color: #666; font-size: .8rem; }
  #commit-panel textarea { width: 100%; min-height: 3rem; font: inherit; box-sizing: border-box; }
  button { font: inherit; padding: .4rem .9rem; cursor: pointer; }
  #ledger li { margin: .25rem 0; font-size: .85rem; }
  .actor { padding: 0 .35rem; border-radius: .5rem; font-size: .75rem; }
  .actor.actuary { background: #e2f2e5; } .actor.agent { background: #fbe9d0; }
  #chat-log { border: 1px solid #dde1e6; background: #fff; padding: .6rem; min-height: 8rem;
    max-height: 20rem; overflow-y: auto; font-size: .9rem; white-space: pre-wrap; }
  .msg-user { font-weight: 600; margin-top: .5rem; }
  .chip { display: inline-block; background: #eef; border: 1px solid #ccd; border-radius: .6rem;
    padding: 0 .45rem; font-size: .75rem; margin: 0 .2rem; }
  .proposal { border: 1px dashed #b8862d; background: #fdf6e7; padding: .4rem; margin: .4rem 0; }
  .error-box { background: #fdecec; border: 1px solid #e5b5b5; padding: .5rem; margin: .5rem 0;
    font-size: .85rem; white-space: pre-wrap; display: none; }
  pre#disclosure { background: #fff; border: 1px solid #dde1e6; padding: .75rem; font-size: .75rem;
    max-height: 24rem; overflow: auto; }
</style>

<h1>Taylor &amp; Ashe — interactive chain ladder</h1>
<div id="banner">loading…</div>
<div id="engine-error" class="error-box"></div>

<h2>1 · Development factors — click an average to select it per column, or override</h2>
<div class="scroll"><table id="factors"></table></div>

<h2>2 · Results</h2>
<div id="results-strip">
  <span>ultimate <span class="big" id="tot-ult">—</span></span>
  <span>unpaid <span class="big" id="tot-unp">—</span></span>
  <span class="delta" id="delta"></span>
  <span class="delta" id="timing"></span>
</div>
<div class="scroll"><table id="results"></table></div>

<h2>3 · Commit — a selection becomes an assumption only with a rationale</h2>
<div id="commit-panel">
  <textarea id="rationale" placeholder="Why these factors? (required — the ledger refuses judgment without a rationale)"></textarea>
  <button id="commit">Commit selection</button>
  <span class="delta" id="commit-note"></span>
  <ul id="ledger"></ul>
  <details><summary>ASOP 41 disclosure (regenerates on commit)</summary><pre id="disclosure"></pre></details>
</div>

<h2>4 · Advisor</h2>
<div id="chat-disabled" class="error-box"></div>
<div id="chat-log"></div>
<div id="proposal-box"></div>
<form id="chat-form">
  <input id="chat-input" style="width: 80%; font: inherit; padding: .35rem;"
    placeholder="Ask the reserving advisor — it can read the triangle, run the ladder, and propose selections" />
  <button type="submit">Send</button>
</form>

<script>
"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const f4 = (n) => (n === null ? "—" : n.toFixed(4));

let state = null;            // /api/state payload
let selected = [];           // current exploratory LDFs (numbers)
let tailFactor = 1;
let committedTotals = null;
let computeTimer = null;

async function boot() {
  state = await (await fetch("/api/state")).json();
  document.title = "Chain ladder — " + state.engine.badge;
  $("banner").textContent = state.engine.name + " — " + state.engine.badge;
  selected = state.defaults.selected.slice();
  tailFactor = state.defaults.tailFactor;
  committedTotals = state.committed && state.committed.totals;
  if (!state.advisorEnabled) {
    const box = $("chat-disabled");
    box.style.display = "block";
    box.textContent =
      "Advisor disabled: no ANTHROPIC_API_KEY in the server environment.\n" +
      "export ANTHROPIC_API_KEY=...   then restart: npm run app";
    $("chat-input").disabled = true;
  }
  renderFactors();
  renderLedger(state.ledger);
  refreshDisclosure();
  compute();
}

function renderFactors() {
  const ages = state.triangle.ages;
  const head = ["<tr><th>average</th>"];
  for (let j = 0; j < ages.length - 1; j++) head.push(`<th>${ages[j]}–${ages[j + 1]}</th>`);
  head.push("</tr>");
  const rows = state.averages.map((a) => {
    const cells = a.values
      .map((v, j) => {
        const sel = v !== null && Math.abs(v - selected[j]) < 1e-12 ? " selected" : "";
        return `<td class="pick${sel}" data-key="${a.key}" data-col="${j}" data-v="${v}">${f4(v)}</td>`;
      })
      .join("");
    return `<tr class="avg"><td>${a.label}</td>${cells}</tr>`;
  });
  const overrides = selected
    .map((v, j) => `<td><input class="override" data-col="${j}" step="0.0001" type="number" value="${v.toFixed(4)}"></td>`)
    .join("");
  const tail = `<tr><td><b>Selected</b> · tail <input id="tail" class="override" step="0.01" type="number" value="${tailFactor}"></td>${overrides}</tr>`;
  $("factors").innerHTML = head.join("") + rows.join("") + tail;

  $("factors").querySelectorAll("td.pick").forEach((td) =>
    td.addEventListener("click", () => {
      const v = Number(td.dataset.v);
      if (Number.isFinite(v)) { selected[Number(td.dataset.col)] = v; renderFactors(); scheduleCompute(); }
    }),
  );
  $("factors").querySelectorAll("input.override").forEach((inp) =>
    inp.addEventListener("change", () => {
      selected[Number(inp.dataset.col)] = Number(inp.value); renderFactors(); scheduleCompute();
    }),
  );
  $("tail").addEventListener("change", (e) => { tailFactor = Number(e.target.value); scheduleCompute(); });
}

function scheduleCompute() { clearTimeout(computeTimer); computeTimer = setTimeout(compute, 250); }

async function compute() {
  const res = await fetch("/api/compute", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ selected, tailFactor }),
  });
  const out = await res.json();
  const errBox = $("engine-error");
  if (!out.success) {
    errBox.style.display = "block";
    errBox.textContent = out.error.code + ": " + out.error.message;
    return;
  }
  errBox.style.display = "none";
  $("tot-ult").textContent = fmt(out.totals.ultimate);
  $("tot-unp").textContent = fmt(out.totals.unpaid);
  $("timing").textContent = "engine " + out.engineMs + " ms";
  $("delta").textContent = committedTotals
    ? "vs committed: " + fmt(out.totals.unpaid - committedTotals.unpaid)
    : "nothing committed yet";
  $("results").innerHTML =
    "<tr><th>origin</th><th>latest</th><th>ultimate</th><th>unpaid</th></tr>" +
    out.rows.map((r) => `<tr><td>${r.origin}</td><td>${fmt(r.latest)}</td><td>${fmt(r.ultimate)}</td><td>${fmt(r.unpaid)}</td></tr>`).join("");
}

function renderLedger(entries) {
  $("ledger").innerHTML = entries
    .map((e) => `<li>#${e.seq} <span class="actor ${e.actor}">${e.actor}</span> <b>${e.field}</b> — ${e.rationale ?? ""}</li>`)
    .join("");
}
async function refreshDisclosure() {
  const out = await (await fetch("/api/disclosure")).json();
  $("disclosure").textContent = out.disclosure;
}

$("commit").addEventListener("click", async () => {
  const rationale = $("rationale").value;
  const res = await fetch("/api/commit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ selected, tailFactor, rationale, actor: lastAppliedProposal ? "agent" : "actuary" }),
  });
  const out = await res.json();
  if (!out.success) { $("commit-note").textContent = out.error.message; return; }
  $("commit-note").textContent = "committed";
  $("rationale").value = "";
  lastAppliedProposal = false;
  committedTotals = out.committed.totals;
  renderLedger(out.ledger);
  $("disclosure").textContent = out.disclosure;
  compute();
});

// ------------------------------------------------------------------ chat
let lastAppliedProposal = false;
function chatLine(cls, text) {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = text;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return div;
}
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = $("chat-input").value.trim();
  if (!message) return;
  $("chat-input").value = "";
  chatLine("msg-user", "you: " + message);
  const reply = chatLine("", "");
  const res = await fetch("/api/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.status !== 200) { reply.textContent = "(advisor unavailable)"; return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (!line.startsWith("data: ")) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "text") reply.textContent += ev.delta;
      if (ev.type === "tool") {
        const chip = document.createElement("span");
        chip.className = "chip"; chip.textContent = "→ " + ev.name;
        reply.appendChild(chip);
      }
      if (ev.type === "proposal") renderProposal(ev.selection);
      if (ev.type === "error") chatLine("", "(error: " + ev.message + ")");
    }
  }
});
function renderProposal(p) {
  const box = $("proposal-box");
  box.innerHTML = `<div class="proposal"><b>Advisor proposes:</b> tail ${p.tailFactor} · ${p.reasoning}
    <button id="apply-proposal">Apply to selection</button></div>`;
  $("apply-proposal").addEventListener("click", () => {
    selected = p.selected.slice(); tailFactor = p.tailFactor; lastAppliedProposal = true;
    renderFactors(); scheduleCompute();
    box.innerHTML = "";
  });
}

boot();
</script>
```

- [ ] **Step 4: package.json** — add to scripts: `"app": "tsx app/server.ts",`

- [ ] **Step 5: Verify** — `npm test -w @actuarial-ts/example-chain-ladder-typescript` (existing 9 + new 6 pass); `npm run typecheck` clean; boot `npm run app -w @actuarial-ts/example-chain-ladder-typescript` and curl `/`, `/api/state`, a compute, a commit, kill.

- [ ] **Step 6: Commit** — `git add examples/chain-ladder-typescript` — `feat(examples): interactive chain-ladder app — TypeScript engine (app A)`.

*(Controller then Playwright-drives the page and ships.)*

---

### Task B: The Python app

**Files:** Create `examples/chain-ladder-python/app/server.ts`, `app/public/index.html`, `test/app.test.ts`; modify its `package.json`.

Copy Task A's three files EXACTLY, then apply ONLY:

1. `index.html`: `<title>Chain ladder — Python engine</title>` (single line; everything else renders from `/api/state`).
2. `server.ts` header comment: name the engine (chainladder-python over the HTTP sidecar) and the siblings.
3. Imports: drop `runChainLadder`; add `callRemoteMethod` from `@actuarial-ts/agents`, `parseDocument`, `selectionsToDoc` from `@actuarial-ts/interchange`.
4. Boot preflight (right after the imports/constants): missing `SIDECAR_URL`/`SIDECAR_TOKEN` in CLI mode → exit 2 printing the boot command (same posture as the CLI spine); `startAppServer` accepts them via options for tests: add `sidecarUrl?/sidecarToken?` options, defaulting from env.
5. `ENGINE = { name: "chainladder-python 0.9.2", badge: "computed by the sidecar (Python)" }`; default port `8792`.
6. `computeWithEngine` body — the engine-specific core. It must express ARBITRARY per-column values as a selection document. **Read `packages/interchange/src/convert/selection.ts` + `src/schemas/selection.ts` first** and use the value-carrying intent kind the schema defines for externally-supplied factors (the chainladder-python bridge explicitly supports value-only replays — see `interop/python/tests/test_bridge_selection.py`, "strict_allows_pure_value_only_selections"). Supply its required provenance field with the honest string `"interactive selection in the example app"`. Then: `selectionsToDoc(selections, { triangleDoc, createdAt: BOOT_AT, intents, strictness: "refuse" }).doc` → `callRemoteMethod({ sidecarUrl, method: "Chainladder", headers: { authorization: Bearer } , timeoutMs: 120_000 }, { triangles: { primary: triangleDoc }, selection: selectionDoc })` → non-success → throw Error(`${code}: ${message}`) → read rows/totals off `remote.doc.result` (integrity already verified by callRemoteMethod). Map per-origin rows to `{ origin, latest, ultimate, unpaid }` (latest = ultimate − unpaid if the doc lacks it).
7. Tail handling: the wire selection doc carries the tail intent when `tailFactor !== 1` (`tailIntent` — read the type; supply the same provenance string).
8. `test/app.test.ts`: same file with the compute-anchors test AND the commit-grows test's engine-dependent totals expectation gated by `describe.skipIf(!process.env.SIDECAR_URL || !process.env.SIDECAR_TOKEN)` — split the file: an always-on describe (page, state shape, no-rationale envelope, chat 503) constructing the server with a FAKE sidecar url (engine never called), and a live describe for compute + commit anchors. Print the skip reason like the sibling tests do.

**Acceptance (live, before commit):** boot the sidecar; run the app tests (all pass); ALSO the parity check — a hand-run script or test comparing `/api/compute` for (a) all-wtd, (b) all-wtd with column 3 overridden to 1.9 and tail 1.05, against the TS app's `/api/compute` for identical inputs: totals must agree within 1e-9 relative. Paste both pairs in the report. If the overridden case cannot be expressed or disagrees — STOP and report; do not fudge intents.

Commit: `git add examples/chain-ladder-python` — `feat(examples): interactive chain-ladder app — Python engine (app B)`.

---

### Task C: The R app + `tools/interop/run-cl.R`

**Files:** Create `tools/interop/run-cl.R`; create `examples/chain-ladder-r/app/server.ts`, `app/public/index.html`, `test/app.test.ts`; modify its `package.json`; update `tools/interop/README.md` (document run-cl.R).

**C1 — `tools/interop/run-cl.R`** (new, ~60 lines): chain-ladder projection from SUPPLIED factors — R does the arithmetic, honestly, with no fit object:

```r
#!/usr/bin/env Rscript
# Chain-ladder projection from SUPPLIED per-column LDFs (+ tail): the honest
# way for R to serve an app whose user picks arbitrary factors —
# MackChainLadder always derives its own and cannot accept these.
#
#   Rscript tools/interop/run-cl.R --in <triangle.json> --ldfs 1.5,1.2,... \
#     --tail 1.0 --out <result.json> --created-at <iso8601>
```

Body: source the adapter (conformance.R bootstrap pattern), parse args (reuse run-mack.R's parser shape; `--ldfs` = comma-separated, count must equal ncol−1; `--tail` default 1), `ats_read_document` → `ats_triangle_to_matrix` → per origin: latest = last non-NA; ultimate = latest × prod(ldfs beyond the latest's column) × tail; unpaid = ultimate − latest. Assemble a method-result body by hand: `rows` (origin/latest/ultimate/unpaid), `totals`, `method = "r:ldf-projection"`, `engine = list(name = "R ldf projection", version = as.character(getRversion()))`, `parameters = list(ldfs = ..., tail = ...)`, `appliesTo = list(triangleIntegrity = tri_doc$integrity, selectionIntegrity = NULL)` → `ats_assemble_document("method-result", body, created_at = args$`created-at`)` → `ats_write_document`. Smoke: run against the taylor-ashe fixture triangle with the committed all-wtd LDFs (extract them via a 3-line Rscript from `selection.json`'s values or hardcode the 9 published factors from `deterministic-cl.json`'s parameters — implementer picks and documents) — `totals$unpaid` within 1 of 18,680,856.

**C2 — the app**: copy Task A's files; apply the same seven kinds of changes as Task B but for R: title "R engine"; imports drop `runChainLadder`, add `mkdtemp/rm/write/read` fs bits and the example's existing `../src/rscript.js` helpers; preflight = `rscriptAvailable()` (exit 2 with brew line in CLI mode; tests always run — R is installed and the engine is a subprocess, no env needed); `ENGINE = { name: "R " + "(ldf projection)", badge: "computed by Rscript (R)" }`; port `8793`; `computeWithEngine` = temp dir → write triangle.json → `runRscript(RUN_CL, ["--in", ..., "--ldfs", selected.join(","), "--tail", String(tailFactor), "--out", ..., "--created-at", BOOT_AT])` → `parseDocument(..., { strictness: "refuse" })` → rows/totals. Tests: full suite runs live when `rscriptAvailable()`, else skips loudly (same gate as the example suite).

**Acceptance:** app tests live-pass; parity check vs the TS app for the same two input pairs as Task B, within 1e-9. `run-cl.R` smoke output in the report.

Commit: `git add tools/interop examples/chain-ladder-r` — `feat(examples): interactive chain-ladder app — R engine + run-cl.R (app C)`.

---

## Self-review notes

- The page renders title/banner from `/api/state`, so `index.html` differs across apps by ONE line (`<title>`) — the byte-discipline check is `diff` with exactly that hunk.
- `lastAppliedProposal` → commit `actor: "agent"` implements the spec's agent-attribution rule; it resets on commit and on manual edits? — manual edits after applying a proposal keep the flag; acceptable simplification, noted here deliberately: the commit records that the *selection originated* from the advisor. Reviewers should not "fix" this without a spec change.
- Engine-down commits record with `totals: null` — the disclosure omits the summary rather than faking one.
- The chat handler drains `pendingProposals` inside the chunk loop — proposals are captured by the tool's own execute, never parsed from prose or from chunk args (chunk arg shapes vary across @mastra/core minors).
- Tests force `advisorEnabled: false` so the 503 path is deterministic even on machines with a key.
