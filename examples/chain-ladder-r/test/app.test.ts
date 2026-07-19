import { afterAll, describe, expect, it } from "vitest";
import { rscriptAvailable } from "../src/rscript.js";
import { startAppServer } from "../app/server.js";

const haveR = rscriptAvailable();
if (!haveR) {
  // Local machines without R skip LOUDLY; CI always provides one, so a real
  // regression still goes red there. Same gate as ../test/example.test.ts —
  // Rscript is a subprocess dependency, not environment-scoped config, so
  // there is nothing for a test to override per-instance (contrast the
  // Python app's per-server sidecarUrl/sidecarToken options).
  console.log(
    "SKIP chain-ladder-r app: Rscript not on PATH. Install with:\n" +
      "  brew install r   # then see tools/interop/README.md for ChainLadder + jsonlite",
  );
}

// One server for the whole file, ephemeral port, advisor forced OFF so the
// 503 path is deterministic regardless of the local environment's keys.
const app = haveR ? await startAppServer({ port: 0, advisorEnabled: false }) : undefined;
const base = app ? `http://127.0.0.1:${app.port}` : "";
afterAll(() => app?.close());

const ALL_WTD_BODY = async () => {
  const state = (await (await fetch(`${base}/api/state`)).json()) as {
    averages: { key: string; values: (number | null)[] }[];
  };
  const allWtd = state.averages.find((a) => a.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected all-wtd in state");
  return { selected: allWtd.values, tailFactor: 1 };
};

describe.skipIf(!haveR)("the chain-ladder app server", () => {
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

  it("refuses chat while the advisor is disabled", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(503);
  });
});
