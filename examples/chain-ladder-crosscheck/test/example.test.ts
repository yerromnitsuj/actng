import { describe, expect, it } from "vitest";
import { rscriptAvailable } from "../src/rscript.js";
import { runCapstone } from "../src/main.js";

const ready = rscriptAvailable() && Boolean(process.env.SIDECAR_URL && process.env.SIDECAR_TOKEN);
if (!ready) {
  console.log(
    "SKIP chain-ladder-crosscheck: needs BOTH a live sidecar (SIDECAR_URL/SIDECAR_TOKEN) and Rscript on PATH.\n" +
      "This capstone deliberately computes all three results live — reading committed fixtures would be" +
      " the self-comparison the 2026-07-18 review had removed.",
  );
}

const out = ready ? await runCapstone() : undefined;

describe.skipIf(!ready)("the cross-engine referee over three live engines", () => {
  it("runs all three pairings", () => {
    expect(out!.pairs.map((p) => p.pair).sort()).toEqual(["python-vs-r", "ts-vs-python", "ts-vs-r"]);
  });

  it("every pairing agrees", () => {
    for (const p of out!.pairs) expect(p.verdict, p.pair).toBe("agree");
  });

  it("every agreement actually compared central cells (0.3.0 coverage block)", () => {
    // Without this, `agree` could mean "nothing the profile asked about was
    // examined" — the exact weakness the review found in the old referee.
    for (const p of out!.pairs) expect(p.centralComparedCells, p.pair).toBeGreaterThan(0);
  });

  it("all three documents claim the same triangle", () => {
    expect(out!.sameAppliesTo).toBe(true);
  });
});
