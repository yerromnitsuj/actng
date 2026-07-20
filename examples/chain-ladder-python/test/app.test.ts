import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { startAppServer } from "../app/server.js";

// Always-on server: advisor forced off (deterministic 503), sidecar pointed
// at an address nothing listens on. Safe because this describe never
// exercises a compute success path — /api/compute isn't called here, and
// /api/commit's engine-down catch swallows the failure (totals: null).
const app = await startAppServer({
  port: 0,
  advisorEnabled: false,
  sidecarUrl: "http://127.0.0.1:1",
  sidecarToken: "unused-fake-token",
});
const base = `http://127.0.0.1:${app.port}`;
afterAll(() => app.close());

const allWtdBody = async (fromBase: string) => {
  const state = (await (await fetch(`${fromBase}/api/state`)).json()) as {
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

  it("carries the full cumulative triangle for the exhibit", async () => {
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      triangle: { origins: string[]; ages: number[]; values: (number | null)[][] };
    };
    expect(state.triangle.origins).toHaveLength(10);
    expect(state.triangle.ages).toHaveLength(10);
    expect(state.triangle.values[0]!.filter((v) => v !== null)).toHaveLength(10);
    expect(state.triangle.values[9]!.filter((v) => v !== null)).toHaveLength(1);
  });

  it("rejects a commit without a rationale, as a fail-closed envelope", async () => {
    const res = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(await allWtdBody(base)), rationale: "" }),
    });
    const out = (await res.json()) as { success: false; error: { code: string } };
    expect(out.success).toBe(false);
  });

  it("refuses a second commit while one is in flight (COMMIT_BUSY)", async () => {
    const hold = heldCommit(base, {
      ...(await allWtdBody(base)),
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
        body: JSON.stringify({ ...(await allWtdBody(base)), tailFactor: 1.1, rationale: "second" }),
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

    // The flag released through the engine-failure catch path (this
    // describe's sidecar is dead): a follow-up sequential commit is not
    // blocked.
    const resFollowUp = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(await allWtdBody(base)), tailFactor: 1.07, rationale: "follow-up" }),
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

  it("fails with setup instructions when no sidecar is configured and no venv exists", async () => {
    // Scrub SIDECAR_URL/SIDECAR_TOKEN so this hits the venv-launch path even
    // when the suite is running against a live sidecar (CI's gated describe
    // below reads these from the environment for the whole test file).
    const savedUrl = process.env.SIDECAR_URL;
    const savedToken = process.env.SIDECAR_TOKEN;
    delete process.env.SIDECAR_URL;
    delete process.env.SIDECAR_TOKEN;
    try {
      const { resolveSidecar } = await import("../app/sidecar.js");
      await expect(resolveSidecar("/tmp/definitely-no-venv-here")).rejects.toThrow(/venv-interop/);
    } finally {
      if (savedUrl === undefined) delete process.env.SIDECAR_URL;
      else process.env.SIDECAR_URL = savedUrl;
      if (savedToken === undefined) delete process.env.SIDECAR_TOKEN;
      else process.env.SIDECAR_TOKEN = savedToken;
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects catchably (no process crash) when the venv python exists but cannot be spawned",
    async () => {
      const savedUrl = process.env.SIDECAR_URL;
      const savedToken = process.env.SIDECAR_TOKEN;
      delete process.env.SIDECAR_URL;
      delete process.env.SIDECAR_TOKEN;
      const fakeRoot = mkdtempSync(join(tmpdir(), "actng-noexec-venv-"));
      try {
        mkdirSync(join(fakeRoot, ".venv-interop", "bin"), { recursive: true });
        // exists (passes the existsSync guard) but is NOT executable → spawn EACCES
        writeFileSync(join(fakeRoot, ".venv-interop", "bin", "python"), "#!/bin/sh\n", { mode: 0o644 });
        const { resolveSidecar } = await import("../app/sidecar.js");
        await expect(resolveSidecar(fakeRoot)).rejects.toThrow(/could not be spawned.*EACCES|EACCES/);
      } finally {
        rmSync(fakeRoot, { recursive: true, force: true });
        if (savedUrl === undefined) delete process.env.SIDECAR_URL; else process.env.SIDECAR_URL = savedUrl;
        if (savedToken === undefined) delete process.env.SIDECAR_TOKEN; else process.env.SIDECAR_TOKEN = savedToken;
      }
    },
  );
});

// -------------------------------------------------- mock-sidecar race only
/** A one-off http server standing in for the real chainladder-python
 * sidecar: the first POST it receives is held 400 ms before answering 500
 * (simulating the finding's engine window — the real sidecar is a network
 * round-trip that can suspend for that long), every later POST answers 500
 * immediately. The 500 makes `computeWithEngine` throw, which the commit
 * handler's own catch swallows (`totals: null`) — this test is about the
 * ledger/committed race, not sidecar success. */
function startMockSidecar(): Promise<{ url: string; close: () => Promise<void> }> {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    const isFirst = calls === 1;
    req.resume(); // drain the request body; nothing in it is read
    req.on("end", async () => {
      if (isFirst) await setTimeout(400);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "MOCK_SIDECAR_DOWN", message: "mock sidecar always fails" } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("the chain-ladder app server — mock-sidecar engine-window race (finding #4)", () => {
  it("never leaves committed staler than the ledger when engine calls overlap", async () => {
    const mock = await startMockSidecar();
    const raceApp = await startAppServer({
      port: 0,
      advisorEnabled: false,
      sidecarUrl: mock.url,
      sidecarToken: "unused-fake-token",
    });
    const raceBase = `http://127.0.0.1:${raceApp.port}`;
    try {
      const commit = (tailFactor: number, rationale: string) =>
        allWtdBody(raceBase).then((body) =>
          fetch(`${raceBase}/api/commit`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...body, tailFactor, rationale }),
          }),
        );
      const resAPromise = commit(1.5, "A (slow engine window)");
      const resBPromise = setTimeout(50).then(() => commit(1.01, "B (overlaps A's engine window)"));
      const [resA, resB] = await Promise.all([resAPromise, resBPromise]);
      await resA.json(); // drain
      await resB.json(); // drain

      expect(resA.status).toBe(200); // A's own commit is never refused
      expect(resB.status).toBe(429); // B overlapped A's still-in-flight engine call

      const state = (await (await fetch(`${raceBase}/api/state`)).json()) as {
        committed: { selections: { tailFactor: number } };
        ledger: { field: string; value: unknown }[];
      };
      expect(state.committed.selections.tailFactor).toBe(1.5);
      const tailEntries = state.ledger.filter((e) => e.field === "chainLadder.tailFactor");
      expect(tailEntries[tailEntries.length - 1]?.value).toBe(1.5);
    } finally {
      await raceApp.close();
      await mock.close();
    }
  });
});

// ------------------------------------------------------ live sidecar only
const haveSidecar = Boolean(process.env.SIDECAR_URL && process.env.SIDECAR_TOKEN);
if (!haveSidecar) {
  // Local machines without the sidecar skip LOUDLY; CI always provides one,
  // so a real regression still goes red there.
  console.log(
    "SKIP chain-ladder-python app (live): no sidecar. Boot one with:\n" +
      "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar\n" +
      "then: SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npm test -w @actuarial-ts/example-chain-ladder-python",
  );
}
const liveApp = haveSidecar ? await startAppServer({ port: 0, advisorEnabled: false }) : undefined;
const liveBase = liveApp ? `http://127.0.0.1:${liveApp.port}` : "";
afterAll(() => liveApp?.close());

describe.skipIf(!haveSidecar)("the chain-ladder app server — live sidecar", () => {
  it("computes the published anchors for all-wtd + tail 1.0", async () => {
    const res = await fetch(`${liveBase}/api/compute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await allWtdBody(liveBase)),
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

  it("grows the ledger and disclosure Section 5 on a rationaled commit, with sidecar-computed totals", async () => {
    const res = await fetch(`${liveBase}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(await allWtdBody(liveBase)),
        rationale: "Volume-weighted all-period factors; stable development.",
      }),
    });
    const out = (await res.json()) as {
      success: true;
      ledger: unknown[];
      committed: { totals: { ultimate: number; unpaid: number } | null };
      disclosure: string;
    };
    expect(out.ledger.length).toBeGreaterThan(0);
    expect(out.disclosure).toContain("## 5. Assumptions and judgments");
    expect(out.committed.totals).not.toBeNull();
    expect(Math.round(out.committed.totals!.ultimate)).toBe(53_038_946);
    expect(Math.round(out.committed.totals!.unpaid)).toBe(18_680_856);
  });
});
