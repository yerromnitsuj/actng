import { describe, expect, it } from "vitest";
import { runReserveReview } from "../src/main.js";

/**
 * The example is TESTED so it cannot rot. An example that stops compiling — or
 * silently stops reproducing the published numbers — is worse than no example,
 * because it teaches the wrong API and nobody notices.
 */
describe("the reserve-review example", () => {
  const out = runReserveReview();

  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    // Published: 18,680,856. The SDK's own tests pin this to the decimal; here
    // we assert to the dollar, which is what an example should promise.
    expect(Math.round(out.unpaid)).toBe(18_680_856);
  });

  it("reproduces R ChainLadder's published Mack standard error", () => {
    // Mack (1993) Table 3 prints 2,447 thousands; R ChainLadder reports the
    // full 2,447,095, which is the figure all three shores agree on. The SDK's
    // own validation.test.ts anchors this as a PERCENTAGE of reserve within
    // +/-1 percentage point, so it is this example — not that test — which
    // pins the figure to the dollar.
    expect(Math.round(out.standardError)).toBe(2_447_095);
  });

  it("produces an ultimate consistent with the unpaid and the latest diagonal", () => {
    expect(Math.round(out.ultimate)).toBe(53_038_946);
  });

  it("stamps an integrity tag on the interchange documents", () => {
    expect(out.triangleIntegrity).toMatch(/^[0-9a-f]{16}$/);
  });

  it("re-derives the selection from recorded INTENT, not from stored values", () => {
    // Without this, the referee step is theatre: runChainLadder is pure, so
    // calling it twice with the same arguments makes `agree` a restatement of
    // referential transparency. The verdict is only worth asserting because
    // the factors were rebuilt from the document's "all-wtd" intent.
    expect(out.selectionReplayed).toBe(true);
  });

  it("gets an `agree` verdict from the referee on the replayed recomputation", () => {
    expect(out.refereeVerdict).toBe("agree");
  });

  it("renders the actuary's judgment into the disclosure", () => {
    // Computed from the rendered markdown, not asserted: the tail-factor
    // judgment must survive ledger -> disclosure and reach ASOP 41 Section 5.
    expect(out.disclosureIncludesLedger).toBe(true);
  });

  it("runs an ASOP 23 data review rather than claiming one", () => {
    expect(out.dataChecksRun).toBeGreaterThan(0);
  });

  it("seals a reproducibility bundle that verifies", () => {
    expect(out.bundleVerified).toBe(true);
  });
});
