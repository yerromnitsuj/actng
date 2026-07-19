import { describe, expect, it } from "vitest";
import { rscriptAvailable } from "../src/rscript.js";
import { runChainLadderR } from "../src/main.js";

const haveR = rscriptAvailable();
if (!haveR) {
  console.log(
    "SKIP chain-ladder-r: Rscript not on PATH. Install with:\n" +
      "  brew install r   # then see tools/interop/README.md for ChainLadder + jsonlite",
  );
}

const out = haveR ? await runChainLadderR() : undefined;

describe.skipIf(!haveR)("chain ladder computed by R ChainLadder", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out!.unpaid)).toBe(18_680_856);
  });
  it("produces the published ultimate", () => {
    expect(Math.round(out!.ultimate)).toBe(53_038_946);
  });
  it("integrity-verifies the document R wrote", () => {
    expect(out!.resultIntegrityVerified).toBe(true);
  });
  it("records exactly three human judgments in the assumption ledger", () => {
    expect(out!.ledgerJudgments).toBe(3);
  });
  it("carries the authenticated actor identity on the judgment trail", () => {
    expect(out!.trailActorIdentity).toBe("jane.actuary@example.com (SSO)");
  });
  it("renders the judgments into ASOP 41 Section 5 of the disclosure", () => {
    expect(out!.disclosureHasJudgmentSection).toBe(true);
  });
  it("fails closed when a tool is called without a tenant", () => {
    expect(out!.tenantFailClosedCode).toBe("NO_TENANT_CONTEXT");
  });
});
