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

  it("rejects a commit without a rationale, as a fail-closed envelope", async () => {
    const res = await fetch(`${base}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(await allWtdBody(base)), rationale: "" }),
    });
    const out = (await res.json()) as { success: false; error: { code: string } };
    expect(out.success).toBe(false);
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
