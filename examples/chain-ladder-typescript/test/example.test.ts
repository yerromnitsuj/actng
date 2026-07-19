import { describe, expect, it } from "vitest";
import { runChainLadderTypescript } from "../src/main.js";

// Called once; each `it` asserts one fact. Top-level await is fine under vitest ESM.
const out = await runChainLadderTypescript();

describe("chain ladder computed in TypeScript", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out.unpaid)).toBe(18_680_856);
  });

  it("produces the published ultimate", () => {
    expect(Math.round(out.ultimate)).toBe(53_038_946);
  });

  it("stamps an integrity tag on the triangle document", () => {
    expect(out.triangleIntegrity).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gets an `agree` verdict from the referee on an intent replay", () => {
    expect(out.refereeVerdict).toBe("agree");
  });

  it("records exactly three human judgments in the assumption ledger", () => {
    expect(out.ledgerJudgments).toBe(3);
  });

  it("carries the authenticated actor identity on the judgment trail (0.3.0, finding 3.6)", () => {
    // Identity comes from the RequestContext, never the resume payload.
    expect(out.trailActorIdentity).toBe("jane.actuary@example.com (SSO)");
  });

  it("renders the judgments into ASOP 41 Section 5 of the disclosure", () => {
    expect(out.disclosureHasJudgmentSection).toBe(true);
  });

  it("fails closed when a tool is called without a tenant — the body never runs", () => {
    expect(out.tenantFailClosedCode).toBe("NO_TENANT_CONTEXT");
  });
});
