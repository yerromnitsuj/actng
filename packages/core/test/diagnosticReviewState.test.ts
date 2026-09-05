import { afterEach, describe, expect, it, vi } from "vitest";
import * as formulas from "../src/diagnosticFormulas.js";
import {
  compileDiagnosticDefinition,
  evaluateDiagnosticReviewRules,
  prepareDiagnosticData,
  type DiagnosticDefinition,
  type DiagnosticMeasureExpression,
} from "../src/index.js";

const expression: DiagnosticMeasureExpression = {
  op: "subtract",
  left: {
    op: "add",
    terms: [
      { op: "measure", measureId: "a" },
      { op: "measure", measureId: "a" },
    ],
  },
  right: { op: "measure", measureId: "b" },
};
const source = (sourceRow: number) => ({
  artifactId: "exposure",
  sourceFile: "exposure.csv",
  sourceRow,
});

function fixture(a: number | null = 4, unit = "night") {
  const common = {
    code: "review-state",
    description: "Review expression",
    severity: "fail" as const,
    missingInput: "not-evaluated" as const,
  };
  const definition: DiagnosticDefinition = {
    diagnosticDefinitionVersion: "1.0.0",
    id: `review-state-${unit}`,
    version: "1",
    lossRowGrain: "aggregate",
    measures: ["a", "b", "unused"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "exposure",
      kind: "exposure",
      unit,
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "exposure",
      exposureTiming: "origin-static",
    })),
    countPopulations: [],
    exposureBases: [
      {
        id: "exposure",
        displayName: "Exposure",
        unit,
        description: "Exposure",
        basis: "earned",
      },
    ],
    amountBases: [],
    derivedMeasures: [],
    formulas: [],
    instances: [],
    reviewRules: [
      {
        ...common,
        kind: "compare",
        id: "compare",
        when: {
          left: expression,
          operator: "lt",
          right: { op: "constant", value: 0 },
        },
      },
      {
        ...common,
        kind: "reconcile",
        id: "reconcile",
        actual: expression,
        expected: { op: "constant", value: 5 },
      },
      {
        ...common,
        kind: "monotonic",
        id: "monotonic",
        expression,
        direction: "nondecreasing",
      },
      {
        ...common,
        kind: "control-total",
        id: "control",
        expression,
        expected: 5,
        projection: { kind: "latest-valuation-per-origin" },
      },
    ],
    periodAxis: {
      kind: "calendar",
      originCadence: "year",
      valuationCadence: "year",
      originAnchor: "start",
      valuationAnchor: "end",
      ageUnit: "month",
      ageOffset: 0,
    },
  };
  return prepareDiagnosticData({
    definition: compileDiagnosticDefinition(definition),
    losses: ["2024", "2025"].map((valuation) => ({
      rowType: "aggregate" as const,
      recordId: valuation,
      sourceGroup: "all",
      origin: "2024",
      valuation,
      complete: true,
      measures: {},
    })),
    exposures: [a, 3, 7].map((value, index) => ({
      key: `exposure-${index}`,
      sourceGroup: "all",
      origin: "2024",
      measureId: ["a", "b", "unused"][index]!,
      value,
      complete: true,
      source: source(index + 2),
    })),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("invocation-local review expression state", () => {
  it("reuses each cell's projection only within its review and omits discarded source lists", () => {
    const prepared = fixture();
    const spy = vi.spyOn(formulas, "evaluateDiagnosticMeasureExpression");
    const first = evaluateDiagnosticReviewRules(prepared);
    const cellStates = spy.mock.calls.slice(0, 6).map(([, states]) => states);
    expect(cellStates).toHaveLength(6);
    expect(new Set(cellStates).size).toBe(2);
    expect(cellStates[0]).toBe(cellStates[2]);
    expect(cellStates[0]).toBe(cellStates[4]);
    for (const states of cellStates) {
      for (const measure of Object.values(states))
        expect(Object.hasOwn(measure, "sources")).toBe(false);
    }
    // Control-total expressions still need their own per-measure sources.
    expect(spy.mock.calls[6]![1].a!.sources).toEqual([source(2)]);
    spy.mockClear();
    expect(evaluateDiagnosticReviewRules(prepared)).toEqual(first);
    const secondStates = spy.mock.calls.slice(0, 6).map(([, states]) => states);
    for (const states of secondStates) expect(cellStates).not.toContain(states);
    expect(first.map((item) => item.left)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(first.every((item) => item.status === "pass")).toBe(true);
    expect(first.every((item) => Object.isFrozen(item))).toBe(true);
    expect(
      first.every(
        (item) =>
          JSON.stringify(item.scope.sources) ===
          JSON.stringify([source(2), source(3)]),
      ),
    ).toBe(true);
  });

  it("does not share definition-sensitive projections across preparations", () => {
    const nights = fixture(4, "night");
    const vehicles = fixture(4, "vehicle-year");
    const spy = vi.spyOn(formulas, "evaluateDiagnosticMeasureExpression");
    evaluateDiagnosticReviewRules(nights);
    const nightState = spy.mock.calls[0]![1];
    spy.mockClear();
    evaluateDiagnosticReviewRules(vehicles);
    const vehicleState = spy.mock.calls[0]![1];
    expect(nightState).not.toBe(vehicleState);
    expect(nightState.a!.quantity.unit).toBe("night");
    expect(vehicleState.a!.quantity.unit).toBe("vehicle-year");
  });

  it("keeps nested overflow paths and complete cell sources without broadening control-total sources", () => {
    const evaluations = evaluateDiagnosticReviewRules(
      fixture(Number.MAX_VALUE),
    );
    expect(evaluations).toHaveLength(6);
    expect(evaluations.every((item) => item.status === "not-evaluated")).toBe(
      true,
    );
    expect(
      evaluations.every((item) =>
        item.notEvaluatedReasons.includes("expression-overflow"),
      ),
    ).toBe(true);
    expect(evaluations[0]!.expressionOverflows).toEqual([
      {
        expressionPath: "/reviewRules/0/when/left/left",
        coordinate: {
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          developmentAge: 12,
          ageUnit: "month",
        },
        sources: [source(2), source(3)],
      },
    ]);
    expect(
      evaluations[4]!.expressionOverflows.map(
        (item) => item.coordinate?.valuation,
      ),
    ).toEqual(["2024", "2025"]);
    expect(evaluations[5]!.expressionOverflows).toEqual([
      {
        expressionPath: "/reviewRules/3/expression/left",
        coordinate: null,
        sources: [source(2)],
      },
    ]);
  });

  it.each([null, Number.NaN])(
    "preserves structurally blocked exposure evidence for %s",
    (value) => {
      const evaluations = evaluateDiagnosticReviewRules(fixture(value));
      expect(evaluations).toHaveLength(6);
      for (const evaluation of evaluations) {
        expect(evaluation.status).toBe("not-evaluated");
        expect(evaluation.left).toBe(null);
        expect(evaluation.notEvaluatedReasons).toEqual(["structural-ambiguity"]);
        expect(evaluation.expressionOverflows).toEqual([]);
        expect(evaluation.scope.sources).toEqual([source(2), source(3)]);
      }
    },
  );
});
