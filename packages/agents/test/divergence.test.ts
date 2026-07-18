import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import {
  MACK_1993_VW_PROFILE,
  crosscheck,
  parseDocument,
  type CrosscheckReportDoc,
  type MethodResultDoc,
} from "@actuarial-ts/interchange";
import { AgentsError } from "../src/errors.js";
import {
  DIVERGENCE_EVIDENCE_CONTEXT_KEY,
  DIVERGENCE_EXPLAINER_INSTRUCTIONS,
  assembleDivergenceEvidence,
  assembleDivergencePrompt,
  createDivergenceEvidenceTool,
  createDivergenceExplainer,
  divergenceHypothesisSchema,
  explainDivergence,
  type DivergenceHypothesis,
  type StructuredGeneratingAgent,
} from "../src/divergence.js";
import type { ToolEnvelopeFailure } from "../src/tools.js";

/**
 * Deterministic fixture tests for the divergence explainer (spec 9 item 3;
 * plan task C2): the evidence-assembly and prompt-construction functions are
 * pure, so they are tested with NO LLM against the COMMITTED misaligned
 * conformance pair (chainladder-python Mack with the default log-linear
 * sigma, deliberately claiming the mack1993-vw profile). The assembled
 * evidence must surface the sigma_interpolation requested-vs-profile
 * violation FIRST and the SE-concentrated deviation signature - clearly
 * enough that ANY competent model would name the flag.
 *
 * The one live-model test at the bottom is env-gated (ACTNG_RUN_EVALS=1,
 * live API cost) and NOT wired into CI.
 */

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "interop",
  "conformance",
  "fixtures",
  "taylor-ashe",
);

const CREATED_AT = "2026-07-18T00:00:00Z";

function readDoc(file: string): MethodResultDoc {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
  return parseDocument(raw).doc as MethodResultDoc;
}

/** TS-authored Mack (mack1993-vw, aligned). */
const tsMack = readDoc("mack1993-vw.json");
/** Python Mack with the DEFAULT log-linear sigma, claiming mack1993-vw. */
const misaligned = readDoc("misaligned-mack-loglinear.json");
/** Python Mack with sigma_interpolation="mack" (aligned). */
const clpyMack = readDoc("clpy-mack1993-vw.json");

const disagreeReport = crosscheck({ a: tsMack, b: misaligned, createdAt: CREATED_AT });
const agreeReport = crosscheck({ a: tsMack, b: clpyMack, createdAt: CREATED_AT });

function expectAgentsError(fn: () => unknown, code: string): AgentsError {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(AgentsError);
  const agentsError = thrown as AgentsError;
  expect(agentsError.code).toBe(code);
  return agentsError;
}

describe("assembleDivergenceEvidence on the committed misaligned pair", () => {
  const evidence = assembleDivergenceEvidence({ report: disagreeReport, a: tsMack, b: misaligned });

  it("surfaces the sigma_interpolation requested-vs-profile violation as the FIRST finding", () => {
    const first = evidence.alignmentFindings[0]!;
    expect(first.status).toBe("violated");
    expect(first.engine).toBe("b");
    expect(first.engineName).toBe("chainladder-python");
    expect(first.parameter).toBe("sigma_interpolation");
    expect(first.required).toBe("mack");
    expect(first.requested).toBe("log-linear");
    expect(first.effective).toBeUndefined();
    expect(first.detail).toContain("VIOLATED");
    expect(first.detail).toContain("sigma_interpolation");
    // It is the ONLY violation: every other checkable requirement is met.
    expect(evidence.alignmentFindings.filter((f) => f.status === "violated")).toHaveLength(1);
    // Ordering is structural: no satisfied/unverifiable finding precedes a violation.
    const statuses = evidence.alignmentFindings.map((f) => f.status);
    expect(statuses.indexOf("violated")).toBe(0);
  });

  it("checks the other pinned chainladder-python requirements as satisfied", () => {
    const bFindings = evidence.alignmentFindings.filter((f) => f.engine === "b");
    const byParam = new Map(bFindings.map((f) => [f.parameter, f]));
    expect(byParam.get("average")!.status).toBe("satisfied");
    expect(byParam.get("n_periods")!.status).toBe("satisfied");
    expect(byParam.get("sigma_interpolation")!.status).toBe("violated");
  });

  it("carries the correct profile alignment requirements as data (the convention map, not a file read)", () => {
    expect(evidence.profile).toEqual({
      id: "mack1993-vw",
      known: true,
      description: MACK_1993_VW_PROFILE.description,
      tolerance: { central: 1e-6, standardError: 0.005 },
    });
    expect(evidence.engines.a.profileAlignment).toEqual(MACK_1993_VW_PROFILE.alignment["actuarial-ts"]);
    expect(evidence.engines.b.profileAlignment).toEqual(
      MACK_1993_VW_PROFILE.alignment["chainladder-python"],
    );
    // The trap note travels with the evidence.
    expect(evidence.engines.b.profileAlignment!.notes!.join(" ")).toContain("log-linear");
  });

  it("records each engine's requested vs effective parameters", () => {
    expect(evidence.engines.a.name).toBe("actuarial-ts");
    expect(evidence.engines.b.name).toBe("chainladder-python");
    expect(evidence.engines.b.requested["sigma_interpolation"]).toBe("log-linear");
    // Neither fixture deviated from its requested parameters.
    expect(evidence.engines.a.effective).toBeNull();
    expect(evidence.engines.b.effective).toBeNull();
  });

  it("shows the SE-concentrated deviation signature: central tiny, SEs up to 4.90%", () => {
    const sig = evidence.deviationSignature;
    expect(sig.concentration).toBe("standard-error");
    expect(sig.centralExceedsTolerance).toBe(false);
    expect(sig.standardErrorExceedsTolerance).toBe(true);
    expect(sig.maxCentral).toBeLessThanOrEqual(1e-6); // float dust, orders below tolerance
    expect(sig.maxStandardError!).toBeGreaterThan(0.04); // the 4.90% at origin 2002
    expect(sig.maxStandardError!).toBeLessThan(0.05);
    expect(sig.tolerance).toEqual({ central: 1e-6, standardError: 0.005 });
    // The worst deviations are ALL standard-error cells, worst origin first.
    expect(sig.worstOrigins[0]).toEqual({
      origin: "2002",
      metric: "standardError",
      deviation: sig.maxStandardError!,
    });
    expect(sig.worstOrigins.every((w) => w.metric === "standardError")).toBe(true);
  });

  it("propagates the report's warnings and each engine's own warnings", () => {
    expect(evidence.warnings.report).toEqual(disagreeReport.report.warnings);
    expect(evidence.warnings.engineA).toEqual([]);
    expect(evidence.warnings.engineB.join(" ")).toContain("DELIBERATELY MISALIGNED");
  });

  it("is pure and deterministic: identical inputs yield identical evidence", () => {
    const again = assembleDivergenceEvidence({ report: disagreeReport, a: tsMack, b: misaligned });
    expect(JSON.stringify(again)).toBe(JSON.stringify(evidence));
  });
});

describe("the only-on-disagree rule is structural", () => {
  it('throws VERDICT_NOT_DISAGREE on an "agree" report', () => {
    expect(agreeReport.report.verdict).toBe("agree");
    const error = expectAgentsError(
      () => assembleDivergenceEvidence({ report: agreeReport, a: tsMack, b: clpyMack }),
      "VERDICT_NOT_DISAGREE",
    );
    expect(error.message).toContain('"agree"');
  });

  it('throws VERDICT_NOT_DISAGREE on a "verified-by-value" report', () => {
    const verifiedByValue = structuredClone(agreeReport) as CrosscheckReportDoc;
    verifiedByValue.report.verdict = "verified-by-value";
    expectAgentsError(
      () => assembleDivergenceEvidence({ report: verifiedByValue, a: tsMack, b: clpyMack }),
      "VERDICT_NOT_DISAGREE",
    );
  });

  it("throws DIVERGENCE_INPUT_MISMATCH when the result docs are swapped", () => {
    const error = expectAgentsError(
      () => assembleDivergenceEvidence({ report: disagreeReport, a: misaligned, b: tsMack }),
      "DIVERGENCE_INPUT_MISMATCH",
    );
    expect(error.message).toContain("SWAPPED");
  });
});

describe("prompt assembly is deterministic", () => {
  it("yields a byte-identical prompt for identical evidence, violations before satisfied findings", () => {
    const evidence = assembleDivergenceEvidence({ report: disagreeReport, a: tsMack, b: misaligned });
    const prompt = assembleDivergencePrompt(evidence);
    expect(assembleDivergencePrompt(evidence)).toBe(prompt);
    expect(
      assembleDivergencePrompt(
        assembleDivergenceEvidence({ report: disagreeReport, a: tsMack, b: misaligned }),
      ),
    ).toBe(prompt);
    expect(prompt).toContain("verdict DISAGREE");
    expect(prompt).toContain("sigma_interpolation");
    expect(prompt.indexOf("[VIOLATED]")).toBeGreaterThan(-1);
    expect(prompt.indexOf("[VIOLATED]")).toBeLessThan(prompt.indexOf("[SATISFIED]"));
  });

  it("the instruction template contains no literal backticks (house gotcha)", () => {
    expect(DIVERGENCE_EXPLAINER_INSTRUCTIONS.includes("`")).toBe(false);
    expect(DIVERGENCE_EXPLAINER_INSTRUCTIONS).toContain("disagree");
    expect(DIVERGENCE_EXPLAINER_INSTRUCTIONS).toContain("misalignedFlag");
  });
});

describe("createDivergenceExplainer", () => {
  it("builds a read-only Agent with sensible defaults", () => {
    const agent = createDivergenceExplainer({ model: "anthropic/claude-sonnet-4-5" });
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.id).toBe("divergence-explainer");
    expect(agent.name).toBe("Divergence Explainer");
  });

  it("the evidence tool returns the context-injected evidence and is kind read", async () => {
    const tool = createDivergenceEvidenceTool();
    expect(tool.kind).toBe("read");
    const evidence = assembleDivergenceEvidence({ report: disagreeReport, a: tsMack, b: misaligned });
    const requestContext = new RequestContext();
    requestContext.set(DIVERGENCE_EVIDENCE_CONTEXT_KEY, evidence);
    const result = (await tool.execute!({}, { requestContext } as never)) as {
      success: true;
      evidence: unknown;
    };
    expect(result.success).toBe(true);
    expect(result.evidence).toBe(evidence);
  });

  it("the evidence tool fails with the envelope, never a throw, when no evidence is injected", async () => {
    const tool = createDivergenceEvidenceTool();
    const result = (await tool.execute!(
      {},
      { requestContext: new RequestContext() } as never,
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NO_DIVERGENCE_EVIDENCE");
  });
});

describe("explainDivergence", () => {
  const cannedHypothesis: DivergenceHypothesis = {
    suspectedCause:
      "Engine b ran the chainladder default sigma_interpolation=log-linear instead of the profile-required mack",
    misalignedFlag: "sigma_interpolation",
    expectedSignature: "central estimates agree; standard errors deviate, worst in early origins",
    observedSignature: "max central deviation ~2e-15; max SE deviation 4.90% at origin 2002",
    recommendation: "Re-run engine b with sigma_interpolation=mack and re-referee",
  };

  it("drives ONE generate call with the deterministic prompt, structured output, and injected evidence", async () => {
    const calls: Array<{ messages: unknown; options: Record<string, unknown> }> = [];
    const explainer: StructuredGeneratingAgent = {
      async generate(messages, options) {
        calls.push({ messages, options: options ?? {} });
        return { object: cannedHypothesis };
      },
    };
    const requestContext = new RequestContext();
    const explanation = await explainDivergence({
      explainer,
      report: disagreeReport,
      a: tsMack,
      b: misaligned,
      requestContext,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages).toEqual([
      { role: "user", content: assembleDivergencePrompt(explanation.evidence) },
    ]);
    expect(calls[0]!.options["maxSteps"]).toBe(4);
    expect(calls[0]!.options["requestContext"]).toBe(requestContext);
    const structuredOutput = calls[0]!.options["structuredOutput"] as { schema: unknown };
    expect(structuredOutput.schema).toBe(divergenceHypothesisSchema);
    // The evidence tool's context key was populated on the SAME context.
    expect(requestContext.get(DIVERGENCE_EVIDENCE_CONTEXT_KEY)).toEqual(explanation.evidence);
    expect(explanation.hypothesis).toEqual(cannedHypothesis);
    expect(explanation.prompt).toBe(assembleDivergencePrompt(explanation.evidence));
  });

  it("creates a fresh RequestContext when none is supplied", async () => {
    let seen: unknown;
    const explainer: StructuredGeneratingAgent = {
      async generate(_messages, options) {
        seen = (options as Record<string, unknown>)["requestContext"];
        return { object: cannedHypothesis };
      },
    };
    await explainDivergence({ explainer, report: disagreeReport, a: tsMack, b: misaligned });
    expect(seen).toBeInstanceOf(RequestContext);
    expect((seen as RequestContext).get(DIVERGENCE_EVIDENCE_CONTEXT_KEY)).toBeDefined();
  });

  it("zod-rejects a malformed model hypothesis instead of passing it through", async () => {
    const explainer: StructuredGeneratingAgent = {
      async generate() {
        return { object: { suspectedCause: "", misalignedFlag: null } };
      },
    };
    await expect(
      explainDivergence({ explainer, report: disagreeReport, a: tsMack, b: misaligned }),
    ).rejects.toThrow();
  });

  it("refuses a non-disagree report before ever calling the model", async () => {
    let called = false;
    const explainer: StructuredGeneratingAgent = {
      async generate() {
        called = true;
        return { object: cannedHypothesis };
      },
    };
    await expect(
      explainDivergence({ explainer, report: agreeReport, a: tsMack, b: clpyMack }),
    ).rejects.toMatchObject({ code: "VERDICT_NOT_DISAGREE" });
    expect(called).toBe(false);
  });
});

/**
 * The ONE opt-in live test (plan C2): a real model on the misaligned pair
 * must name sigma_interpolation as the misaligned flag. Costs live API
 * tokens; requires ANTHROPIC_API_KEY; NOT wired into CI. Model via
 * ACTNG_EVAL_MODEL (Mastra model-router id), defaulting to the eval-advisor
 * default model.
 *
 *   ACTNG_RUN_EVALS=1 npx vitest run --root packages/agents test/divergence.test.ts
 */
describe.skipIf(process.env.ACTNG_RUN_EVALS !== "1")("live divergence explainer (opt-in)", () => {
  it(
    "names sigma_interpolation as the misaligned flag on the committed misaligned pair",
    async () => {
      const explainer = createDivergenceExplainer({
        model: process.env.ACTNG_EVAL_MODEL ?? "anthropic/claude-opus-4-8",
      });
      const { hypothesis } = await explainDivergence({
        explainer,
        report: disagreeReport,
        a: tsMack,
        b: misaligned,
      });
      expect(hypothesis.misalignedFlag ?? "").toContain("sigma_interpolation");
    },
    180_000,
  );
});
