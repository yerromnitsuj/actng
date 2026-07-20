import { setTimeout } from "node:timers/promises";
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

/** Fires a /api/commit whose request body is streamed in two chunks with a
 * gate between them, so the request provably reaches the server (headers +
 * partial body) and stays open until `release()` is called — the
 * deterministic way to make a second, fully-formed commit request overlap
 * the first one in flight. */
function heldCommit(fromBase: string, payload: object) {
  const body = JSON.stringify(payload);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(enc.encode(body.slice(0, 10)));
      await gate;
      c.enqueue(enc.encode(body.slice(10)));
      c.close();
    },
  });
  const done = fetch(`${fromBase}/api/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  return { release, done };
}

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
      rows: { origin: string; latest: number; ultimate: number; unpaid: number }[];
      totals: { ultimate: number; unpaid: number };
    };
    expect(Math.round(out.totals.ultimate)).toBe(53_038_946);
    expect(Math.round(out.totals.unpaid)).toBe(18_680_856);
    expect(out.rows[0]).toMatchObject({ origin: "2001" });
    expect(typeof out.rows[0]?.latest).toBe("number");
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

  it("refuses a second commit while one is in flight (COMMIT_BUSY)", async () => {
    const hold = heldCommit(base, {
      ...(await ALL_WTD_BODY()),
      tailFactor: 1.05,
      rationale: "first (held)",
    });
    // Always release and drain the held request before asserting anything,
    // regardless of what resB turns out to be — an unreleased stream would
    // otherwise leave the connection open forever and hang this file's
    // afterAll(() => app.close()).
    let resB!: Response;
    let doneRes!: Response;
    try {
      await setTimeout(50); // headers reach the server; the guard is set before the body finishes
      resB = await fetch(`${base}/api/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(await ALL_WTD_BODY()), tailFactor: 1.1, rationale: "second" }),
      });
    } finally {
      hold.release();
      doneRes = await hold.done;
    }
    const resBBody = (await resB.json()) as { error?: { code: string } };
    expect(resB.status).toBe(429);
    expect(resBBody.error?.code).toBe("COMMIT_BUSY");
    expect(doneRes.status).toBe(200);
    await doneRes.json(); // drain

    // committed coheres with the ledger's latest entries: A's held commit is
    // the only one that landed, so both reflect its tailFactor (1.05), never
    // rejected B's (1.1).
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      committed: { selections: { tailFactor: number } };
      ledger: { field: string; value: unknown }[];
    };
    expect(state.committed.selections.tailFactor).toBe(1.05);
    const tailEntries = state.ledger.filter((e) => e.field === "chainLadder.tailFactor");
    expect(tailEntries[tailEntries.length - 1]?.value).toBe(1.05);

    // The flag released through the try/finally: a follow-up sequential
    // commit is not blocked.
    const resFollowUp = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(await ALL_WTD_BODY()), tailFactor: 1.07, rationale: "follow-up" }),
    });
    expect(resFollowUp.status).toBe(200);
    await resFollowUp.json(); // drain
  });

  it("refuses chat while the advisor is disabled", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(503);
  });

  it("carries the full cumulative triangle for the exhibit", async () => {
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      triangle: { origins: string[]; ages: number[]; values: (number | null)[][] };
    };
    expect(state.triangle.origins).toHaveLength(10);
    expect(state.triangle.ages).toHaveLength(10);
    expect(state.triangle.values[0]!.filter((v) => v !== null)).toHaveLength(10);
    expect(state.triangle.values[9]!.filter((v) => v !== null)).toHaveLength(1);
  });
});
