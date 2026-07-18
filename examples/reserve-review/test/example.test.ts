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
    // full 2,447,095, which is the figure all three shores agree on.
    expect(Math.round(out.standardError)).toBe(2_447_095);
  });

  it("produces an ultimate consistent with the unpaid and the latest diagonal", () => {
    expect(Math.round(out.ultimate)).toBe(53_038_946);
  });

  it("stamps an integrity tag on the interchange documents", () => {
    expect(out.triangleIntegrity).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gets an `agree` verdict from the referee on an independent recomputation", () => {
    expect(out.refereeVerdict).toBe("agree");
  });

  it("seals a reproducibility bundle that verifies", () => {
    expect(out.bundleVerified).toBe(true);
  });
});
