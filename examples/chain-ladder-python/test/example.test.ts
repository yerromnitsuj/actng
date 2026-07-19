import { describe, expect, it } from "vitest";
import { runChainLadderPython } from "../src/main.js";

const haveSidecar = Boolean(process.env.SIDECAR_URL && process.env.SIDECAR_TOKEN);
if (!haveSidecar) {
  // Local machines without the sidecar skip LOUDLY; CI always provides one,
  // so a real regression still goes red there.
  console.log(
    "SKIP chain-ladder-python: no sidecar. Boot one with:\n" +
      "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar\n" +
      "then: SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npm test -w @actuarial-ts/example-chain-ladder-python",
  );
}

const out = haveSidecar ? await runChainLadderPython() : undefined;

describe.skipIf(!haveSidecar)("chain ladder computed by chainladder-python", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out!.unpaid)).toBe(18_680_856);
  });
  it("produces the published ultimate", () => {
    expect(Math.round(out!.ultimate)).toBe(53_038_946);
  });
  it("integrity-verifies the document the sidecar returned", () => {
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
