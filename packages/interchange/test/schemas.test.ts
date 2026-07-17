import { describe, expect, it } from "vitest";
import { runChainLadder } from "@actuarial-ts/core";
import {
  CREATED_AT,
  allWtdSelections,
  annualPaidDoc,
  annualPaidTriangle,
} from "./helpers.js";
import {
  type BundleDoc,
  type CrosscheckReportDoc,
  type StochasticResultDoc,
  type StudyDoc,
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  developmentIntentSchema,
  measureSchema,
  originLengthMonthsSchema,
  parseDocument,
  resultToDoc,
  selectionsToDoc,
  stampIntegrity,
  triangleDocSchema,
} from "../src/index.js";

function envelope(kind: string) {
  return {
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind,
    generator: DEFAULT_GENERATOR,
    createdAt: CREATED_AT,
    extensions: {},
  };
}

function roundTrip(doc: unknown): unknown {
  return parseDocument(JSON.parse(JSON.stringify(doc))).doc;
}

describe("schema round-trips for every kind", () => {
  const tri = annualPaidTriangle();
  const triangleDoc = annualPaidDoc();
  const { doc: selectionDoc } = selectionsToDoc(allWtdSelections(tri), {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
  });
  const clResult = runChainLadder(tri, allWtdSelections(tri));
  const resultDoc = resultToDoc(clResult, {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
  });

  it("triangle", () => {
    expect(roundTrip(triangleDoc)).toEqual(triangleDoc);
  });

  it("selection", () => {
    expect(roundTrip(selectionDoc)).toEqual(selectionDoc);
  });

  it("method-result", () => {
    expect(roundTrip(resultDoc)).toEqual(resultDoc);
  });

  it("stochastic-result", () => {
    const doc = stampIntegrity<StochasticResultDoc>({
      ...envelope("stochastic-result"),
      kind: "stochastic-result",
      result: {
        appliesTo: { triangleIntegrity: triangleDoc.integrity, selectionIntegrity: null },
        engine: { name: "actuarial-ts", version: "0.1.0" },
        method: "odpBootstrap",
        parameters: { nSims: 1000 },
        warnings: [],
        seed: 42,
        nSims: 1000,
        summary: { mean: 2500.5, sd: 310.25, cv: 0.1241, percentiles: { "75": 2700, "95": 3050 } },
        byOrigin: [{ origin: "2021", mean: 120.5 }, { origin: "2022", mean: 340.25 }],
      },
    });
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("study (governance round-trips opaquely beside the body)", () => {
    const doc = stampIntegrity<StudyDoc>({
      ...envelope("study"),
      kind: "study",
      study: {
        title: "GL occurrence Q3 factor study",
        narrative: {
          analyst: "Sam Doe",
          sourceRef: "nb/q3-study.ipynb",
          summary: "VW all-year anchors; no tail.",
        },
        triangles: [triangleDoc],
        selections: [selectionDoc],
        supportingResults: [resultDoc],
        expectations: { replayTolerance: 0.0005 },
      },
      governance: { ledger: [{ entry: 1, opaque: true }] },
    });
    const back = roundTrip(doc) as StudyDoc;
    expect(back).toEqual(doc);
    expect(back.governance).toEqual({ ledger: [{ entry: 1, opaque: true }] });
  });

  it("bundle", () => {
    const doc = stampIntegrity<BundleDoc>({
      ...envelope("bundle"),
      kind: "bundle",
      bundle: { payload: "canonical-host-blob", hash: "abc" },
      interchange: { triangles: [triangleDoc], selections: [selectionDoc], results: [resultDoc] },
    });
    expect(roundTrip(doc)).toEqual(doc);
  });

  it("crosscheck-report", () => {
    const doc = stampIntegrity<CrosscheckReportDoc>({
      ...envelope("crosscheck-report"),
      kind: "crosscheck-report",
      report: {
        engines: {
          a: { name: "actuarial-ts", version: "0.1.0", conventionProfile: "deterministic-cl" },
          b: { name: "chainladder-python", version: "0.9.2", conventionProfile: "deterministic-cl" },
        },
        appliesTo: { triangleIntegrity: triangleDoc.integrity, selectionIntegrity: selectionDoc.integrity },
        parameters: {
          a: { requested: {}, effective: null },
          b: { requested: { average: "volume" }, effective: null },
        },
        tolerance: { central: 1e-6, standardError: null },
        deviations: {
          perOrigin: [{ origin: "2021", ultimate: 0, unpaid: 0, standardError: null }],
          totals: { ultimate: 0, unpaid: 0, standardError: null },
        },
        verdict: "agree",
        warnings: [],
      },
    });
    expect(roundTrip(doc)).toEqual(doc);
  });
});

describe("schema rejections", () => {
  it("judgmental intent without rationale is rejected", () => {
    const parsed = developmentIntentSchema.safeParse({ kind: "judgmental" });
    expect(parsed.success).toBe(false);
    const external = developmentIntentSchema.safeParse({ kind: "external", rationale: "  " });
    expect(external.success).toBe(false);
    const ok = developmentIntentSchema.safeParse({
      kind: "judgmental",
      rationale: "smoothed for the 2021 large loss",
    });
    expect(ok.success).toBe(true);
  });

  it("medial trims are valid only with kind medial", () => {
    expect(
      developmentIntentSchema.safeParse({ kind: "volume-weighted", excludeHigh: 0 }).success,
    ).toBe(false);
    expect(
      developmentIntentSchema.safeParse({
        kind: "medial",
        windowOriginPeriods: 5,
        excludeHigh: 1,
        excludeLow: 1,
      }).success,
    ).toBe(true);
  });

  it("measure vocabulary is closed plus the custom escape hatch", () => {
    for (const m of [
      "paid",
      "incurred",
      "caseReserve",
      "reportedCount",
      "openCount",
      "closedCount",
      "closedWithPayCount",
      "earnedPremium",
      "custom:aleAllocated",
    ]) {
      expect(measureSchema.safeParse(m).success).toBe(true);
    }
    expect(measureSchema.safeParse("premium").success).toBe(false);
    expect(measureSchema.safeParse("custom:").success).toBe(false);
  });

  it("originLengthMonths is exactly 12 | 6 | 3 | 1", () => {
    for (const v of [12, 6, 3, 1]) expect(originLengthMonthsSchema.safeParse(v).success).toBe(true);
    for (const v of [24, 4, 0, "12"]) {
      expect(originLengthMonthsSchema.safeParse(v).success).toBe(false);
    }
  });

  it("a triangle with a values/origins shape mismatch is rejected", () => {
    const doc = annualPaidDoc();
    const broken = {
      ...doc,
      triangle: { ...doc.triangle, values: doc.triangle.values!.slice(0, 2) },
    };
    expect(triangleDocSchema.safeParse(broken).success).toBe(false);
  });
});
