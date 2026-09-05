import { describe, expect, it } from "vitest";
import {
  compileDiagnosticDefinition,
  evaluateDiagnosticReviewRules,
  getPreparedDiagnosticDataIdentity,
  prepareDiagnosticData,
  type DiagnosticDefinition,
  type DiagnosticReviewRule,
  type DiagnosticReviewRuleEvaluation,
} from "../src/index.js";

const compare = (id: string): DiagnosticReviewRule => ({
  kind: "compare",
  id,
  code: "open-exceeds-reported",
  description: "Open does not exceed reported",
  severity: "fail",
  missingInput: "not-evaluated",
  when: {
    left: { op: "measure", measureId: "open" },
    operator: "gt",
    right: { op: "measure", measureId: "reported" },
  },
});

function definition(unit = "claim"): DiagnosticDefinition {
  const reviewBase = {
    severity: "fail" as const,
    missingInput: "not-evaluated" as const,
    code: "review",
    description: "Review",
  };
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: `review-sharing-${unit}`,
    version: "1",
    lossRowGrain: "aggregate",
    measures: [
      ...["reported", "open"].map((id) => ({
        id,
        displayName: id,
        description: id,
        source: "loss" as const,
        kind: "count" as const,
        unit,
        developmentSemantics: "point-in-time" as const,
        aggregation: "sum" as const,
        missing: "unknown" as const,
        countPopulationId: "claims",
      })),
      ...["paid", "incurred"].map((id) => ({
        id,
        displayName: id,
        description: id,
        source: "loss" as const,
        kind: "amount" as const,
        unit: "USD",
        developmentSemantics: "cumulative" as const,
        aggregation: "sum" as const,
        missing: "unknown" as const,
        basisId: "gross",
      })),
    ],
    countPopulations: [
      {
        id: "claims",
        displayName: "Claims",
        subject: "other",
        unit,
        description: "Claims",
      },
    ],
    exposureBases: [],
    amountBases: [
      {
        id: "gross",
        displayName: "Gross",
        currency: "USD",
        perspective: "gross",
        components: [
          {
            id: "indemnity",
            treatment: "included",
            limitation: { kind: "unlimited" },
          },
        ],
      },
    ],
    derivedMeasures: [],
    formulas: [],
    instances: [],
    reviewRules: [
      compare("first"),
      compare("second"),
      {
        ...reviewBase,
        kind: "reconcile",
        id: "reconcile",
        actual: { op: "measure", measureId: "reported" },
        expected: { op: "measure", measureId: "open" },
      },
      {
        ...reviewBase,
        kind: "monotonic",
        id: "monotonic",
        expression: { op: "measure", measureId: "reported" },
        direction: "nondecreasing",
      },
      {
        ...reviewBase,
        kind: "layer-order",
        id: "layer",
        narrower: { op: "measure", measureId: "paid" },
        broader: { op: "measure", measureId: "incurred" },
        comparability: {
          kind: "caller-asserted",
          rationaleArtifactId: "layer-note",
        },
      },
      {
        ...reviewBase,
        kind: "control-total",
        id: "control",
        expression: { op: "measure", measureId: "reported" },
        expected: 12,
        projection: { kind: "all-cells" },
        filter: { origins: ["2024"] },
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
}

function prepared(unit = "claim", nullable = false) {
  return prepareDiagnosticData({
    definition: compileDiagnosticDefinition(definition(unit)),
    losses: [
      {
        rowType: "aggregate",
        recordId: "first",
        sourceGroup: "all",
        origin: "2024",
        valuation: "2024",
        complete: true,
        measures: {
          reported: nullable ? null : 5,
          open: 6,
          paid: 7,
          incurred: 10,
        },
        source: { artifactId: "loss", sourceRow: 10 },
      },
      {
        rowType: "aggregate",
        recordId: "second",
        sourceGroup: "all",
        origin: "2024",
        valuation: "2025",
        complete: true,
        measures: { reported: 7, open: 4, paid: 8, incurred: 12 },
        source: { artifactId: "loss", sourceRow: 2 },
      },
    ],
    exposures: [],
  });
}

function graph(value: unknown, result = new Set<object>()): Set<object> {
  if (value === null || typeof value !== "object" || result.has(value))
    return result;
  result.add(value);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    if ("value" in descriptor) graph(descriptor.value, result);
  return result;
}

function expectFrozenDataGraph(value: unknown): void {
  for (const node of graph(value)) {
    expect(Object.isFrozen(node)).toBe(true);
    if (Array.isArray(node))
      expect(Object.getPrototypeOf(node)).toBe(Array.prototype);
    else
      expect([Object.prototype, null]).toContain(Object.getPrototypeOf(node));
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(node),
    )) {
      expect("value" in descriptor).toBe(true);
      expect(descriptor.configurable).toBe(false);
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(
        key !== "length" || !Array.isArray(node),
      );
    }
  }
}

function ownedEvaluationChildren(
  evaluations: readonly DiagnosticReviewRuleEvaluation[],
): Set<object> {
  return graph(
    evaluations.flatMap((item) => [
      item.scope,
      item.notEvaluatedReasons,
      item.expressionOverflows,
    ]),
  );
}

describe("construction-time private review child sharing", () => {
  it("keeps every evaluation and order while sharing repeated immutable children", () => {
    const input = prepared();
    const identityBefore = JSON.stringify(
      getPreparedDiagnosticDataIdentity(input),
    );
    const evaluations = evaluateDiagnosticReviewRules(input);
    expect(
      evaluations.map((item) => [
        item.ruleId,
        item.status,
        item.left,
        item.right,
      ]),
    ).toEqual([
      ["first", "triggered", 6, 5],
      ["first", "pass", 4, 7],
      ["second", "triggered", 6, 5],
      ["second", "pass", 4, 7],
      ["reconcile", "triggered", 5, 6],
      ["reconcile", "triggered", 7, 4],
      ["monotonic", "pass", 5, 7],
      ["layer", "pass", 7, 10],
      ["layer", "pass", 8, 12],
      ["control", "pass", 12, 12],
    ]);
    expect(new Set(evaluations).size).toBe(10);
    expect(evaluations[0]).not.toBe(evaluations[2]);
    expect(evaluations[0]!.scope).toBe(evaluations[2]!.scope);
    expect(evaluations[0]!.notEvaluatedReasons).toBe(
      evaluations[2]!.notEvaluatedReasons,
    );
    expect(evaluations[0]!.scope.sources[0]).toBe(
      evaluations[2]!.scope.sources[0],
    );
    expect(new Set(evaluations.map((item) => item.scope)).size).toBe(4);
    expect(new Set(evaluations.map((item) => item.scope.sources)).size).toBe(3);
    expect(
      new Set(evaluations.flatMap((item) => item.scope.sources)).size,
    ).toBe(2);
    expect(
      new Set(
        evaluations.flatMap((item) => [
          item.notEvaluatedReasons,
          item.expressionOverflows,
        ]),
      ).size,
    ).toBe(1);
    expect(
      evaluations[6]!.scope.sources.map((source) => source.sourceRow),
    ).toEqual([2, 10]);
    expect(JSON.stringify(getPreparedDiagnosticDataIdentity(input))).toBe(
      identityBefore,
    );
    expectFrozenDataGraph(evaluations);
  });

  it("preserves frozen borrowed definition nodes by identity", () => {
    const input = prepared();
    const evaluations = evaluateDiagnosticReviewRules(input);
    const layerRule = input.definition.definition.reviewRules.find(
      (rule) => rule.kind === "layer-order",
    )!;
    const controlRule = input.definition.definition.reviewRules.find(
      (rule) => rule.kind === "control-total",
    )!;
    const layer = evaluations.find((item) => item.ruleKind === "layer-order")!;
    const control = evaluations.find(
      (item) => item.scope.kind === "control-total",
    )!;
    if (
      layerRule.kind !== "layer-order" ||
      layer.ruleKind !== "layer-order" ||
      controlRule.kind !== "control-total" ||
      control.scope.kind !== "control-total"
    )
      throw new Error("Fixture kinds changed");
    expect(layer.comparability).toBe(layerRule.comparability);
    expect(control.scope.projection).toBe(controlRule.projection);
    expect(control.scope.filter).toBe(controlRule.filter);
    expect(Object.isFrozen(controlRule.filter)).toBe(true);
  });

  it("does not carry owned child sharing across calls or definitions", () => {
    const input = prepared();
    const first = evaluateDiagnosticReviewRules(input);
    const second = evaluateDiagnosticReviewRules(input);
    const borrowed = graph(input.definition);
    const previous = ownedEvaluationChildren(first);
    for (const child of ownedEvaluationChildren(second))
      if (!borrowed.has(child)) expect(previous.has(child)).toBe(false);
    expect(second).toEqual(first);
    const other = prepared("occurrence");
    expect(other.cells).toEqual(input.cells);
    expect(other.cells[0]).not.toBe(input.cells[0]);
    expect(evaluateDiagnosticReviewRules(other)).toEqual(first);
    expect(evaluateDiagnosticReviewRules(input)).toEqual(first);
  });

  it("retains all not-evaluated reasons and freezes each completed record", () => {
    const evaluations = evaluateDiagnosticReviewRules(prepared("claim", true));
    expect(evaluations).toHaveLength(10);
    expect(evaluations[0]).toMatchObject({
      status: "not-evaluated",
      triggerReason: null,
      right: null,
      notEvaluatedReasons: ["missing"],
    });
    expect(evaluations[2]).toMatchObject({
      status: "not-evaluated",
      triggerReason: null,
      right: null,
      notEvaluatedReasons: ["missing"],
    });
    expect(evaluations[0]!.notEvaluatedReasons).toBe(
      evaluations[2]!.notEvaluatedReasons,
    );
    expectFrozenDataGraph(evaluations);
    expect(() =>
      Object.defineProperty(evaluations[0]!.scope, "kind", {
        value: "changed",
      }),
    ).toThrow(TypeError);
  });

  it("retains distinct overflow evidence while sharing its owned coordinates and sources", () => {
    const specification = definition();
    specification.reviewRules = ["first", "second"].map((id) => ({
      kind: "compare",
      id,
      code: "overflow-comparison",
      description: "Compare a computed count",
      severity: "fail",
      missingInput: "not-evaluated",
      when: {
        left: {
          op: "add",
          terms: [
            { op: "measure", measureId: "reported" },
            { op: "measure", measureId: "reported" },
          ],
        },
        operator: "gt",
        right: { op: "constant", value: 0 },
      },
    }));
    const input = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(specification),
      losses: [
        {
          rowType: "aggregate",
          recordId: "overflow",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: {
            reported: Number.MAX_VALUE,
            open: 1,
            paid: 0,
            incurred: 1,
          },
          source: { artifactId: "loss", sourceRow: 10 },
        },
      ],
      exposures: [],
    });
    const evaluations = evaluateDiagnosticReviewRules(input);
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map((item) => item.status)).toEqual([
      "not-evaluated",
      "not-evaluated",
    ]);
    expect(evaluations[0]!.notEvaluatedReasons).toEqual([
      "expression-overflow",
    ]);
    expect(
      evaluations.map((item) => item.expressionOverflows[0]!.expressionPath),
    ).toEqual(["/reviewRules/0/when/left", "/reviewRules/1/when/left"]);
    expect(evaluations[0]!.expressionOverflows[0]).not.toBe(
      evaluations[1]!.expressionOverflows[0],
    );
    expect(evaluations[0]!.expressionOverflows[0]!.sources).toBe(
      evaluations[1]!.expressionOverflows[0]!.sources,
    );
    expect(evaluations[0]!.expressionOverflows[0]!.coordinate).toBe(
      evaluations[1]!.expressionOverflows[0]!.coordinate,
    );
    expect(
      evaluations[0]!.expressionOverflows[0]!.sources.map(
        (source) => source.sourceRow,
      ),
    ).toEqual([10]);
    expectFrozenDataGraph(evaluations);
    expect(evaluateDiagnosticReviewRules(input)).toEqual(evaluations);
  });
});
