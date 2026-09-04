import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  evaluateDiagnosticReviewRules,
  prepareDiagnosticData,
  type DiagnosticDefinition,
} from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "review",
  version: "1",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported",
      description: "Reported",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "open",
      displayName: "Open",
      description: "Open",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "Claims",
    },
  ],
  exposureBases: [],
  amountBases: [],
  derivedMeasures: [],
  formulas: [CASUALTY_FORMULA_TEMPLATES[1]],
  instances: [],
  reviewRules: [
    {
      kind: "compare",
      id: "open-le-reported",
      code: "open-exceeds-reported",
      description: "Open does not exceed reported",
      severity: "fail",
      missingInput: "not-evaluated",
      when: {
        left: { op: "measure", measureId: "open" },
        operator: "gt",
        right: { op: "measure", measureId: "reported" },
      },
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

describe("declarative diagnostic review", () => {
  it("evaluates generic rules from the compiled definition", () => {
    const compiled = compileDiagnosticDefinition(definition);
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [
        {
          rowType: "aggregate",
          recordId: "r",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: 5, open: 6 },
        },
      ],
      exposures: [],
    });
    expect(evaluateDiagnosticReviewRules(prepared)[0]).toMatchObject({
      ruleId: "open-le-reported",
      status: "triggered",
      triggerReason: "predicate",
      left: 6,
      right: 5,
    });
  });

  it("evaluates every rule family over canonical cells with complete sources", () => {
    const allRules: DiagnosticDefinition = {
      ...definition,
      measures: [
        ...definition.measures,
        {
          id: "paid",
          displayName: "Paid",
          description: "Paid loss",
          source: "loss",
          kind: "amount",
          unit: "USD",
          developmentSemantics: "cumulative",
          aggregation: "sum",
          missing: "unknown",
          basisId: "gross-loss",
        },
        {
          id: "incurred",
          displayName: "Incurred",
          description: "Incurred loss",
          source: "loss",
          kind: "amount",
          unit: "USD",
          developmentSemantics: "cumulative",
          aggregation: "sum",
          missing: "unknown",
          basisId: "gross-loss",
        },
      ],
      amountBases: [
        {
          id: "gross-loss",
          displayName: "Gross loss",
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
      reviewRules: [
        ...definition.reviewRules,
        {
          kind: "reconcile",
          id: "reconcile",
          code: "not-reconciled",
          description: "Counts reconcile",
          severity: "warning",
          missingInput: "not-evaluated",
          actual: { op: "measure", measureId: "reported" },
          expected: { op: "measure", measureId: "open" },
        },
        {
          kind: "monotonic",
          id: "monotonic",
          code: "reported-decreased",
          description: "Reported is cumulative",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          direction: "nondecreasing",
        },
        {
          kind: "layer-order",
          id: "layer",
          code: "layer-order",
          description: "Paid does not exceed incurred",
          severity: "fail",
          missingInput: "not-evaluated",
          narrower: { op: "measure", measureId: "paid" },
          broader: { op: "measure", measureId: "incurred" },
          comparability: {
            kind: "caller-asserted",
            rationaleArtifactId: "review-note",
          },
        },
        {
          kind: "control-total",
          id: "control",
          code: "control-total",
          description: "Latest reported control",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          expected: 4,
          filter: { sourceGroups: ["all"] },
          projection: { kind: "latest-valuation-per-origin" },
        },
      ],
    };
    const compiled = compileDiagnosticDefinition(allRules);
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [
        {
          rowType: "aggregate",
          recordId: "r1",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2023",
          complete: true,
          measures: { reported: 5, open: 6, paid: 6, incurred: 5 },
          source: { artifactId: "losses", sourceRow: 1 },
        },
        {
          rowType: "aggregate",
          recordId: "r2",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2024",
          complete: true,
          measures: { reported: 4, open: 3, paid: 3, incurred: 4 },
          source: { artifactId: "losses", sourceRow: 2 },
        },
      ],
      exposures: [],
    });
    const evaluations = evaluateDiagnosticReviewRules(prepared);
    expect(
      evaluations
        .filter((item) => item.ruleId === "open-le-reported")
        .map((item) => item.status),
    ).toEqual(["triggered", "pass"]);
    expect(
      evaluations
        .filter((item) => item.ruleId === "reconcile")
        .map((item) => item.status),
    ).toEqual(["triggered", "triggered"]);
    expect(
      evaluations.find((item) => item.ruleId === "monotonic"),
    ).toMatchObject({ status: "triggered", left: 5, right: 4 });
    expect(
      evaluations
        .filter((item) => item.ruleId === "layer")
        .map((item) => item.status),
    ).toEqual(["triggered", "pass"]);
    expect(evaluations.find((item) => item.ruleId === "control")).toMatchObject(
      {
        ruleKind: "control-total",
        status: "pass",
        left: 4,
        right: 4,
        scope: {
          kind: "control-total",
          selectedCellCount: 1,
          selectedContributionCount: 1,
        },
      },
    );
    expect(evaluations.find((item) => item.ruleId === "layer")).toMatchObject({
      ruleKind: "layer-order",
      comparability: {
        kind: "caller-asserted",
        rationaleArtifactId: "review-note",
      },
    });
    expect(evaluations.every((item) => item.scope.sources.length > 0)).toBe(
      true,
    );
    expect(Object.isFrozen(evaluations)).toBe(true);
  });

  it("preserves readiness reasons and missing-input policy", () => {
    const rules: DiagnosticDefinition = {
      ...definition,
      reviewRules: [
        {
          kind: "compare",
          id: "missing-not-evaluated",
          code: "missing",
          description: "Missing is explicit",
          severity: "warning",
          missingInput: "not-evaluated",
          when: {
            left: { op: "measure", measureId: "open" },
            operator: "gt",
            right: { op: "constant", value: 0 },
          },
        },
        {
          kind: "compare",
          id: "missing-finding",
          code: "missing",
          description: "Missing is a finding",
          severity: "fail",
          missingInput: "finding",
          when: {
            left: { op: "measure", measureId: "open" },
            operator: "gt",
            right: { op: "constant", value: 0 },
          },
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(rules),
      losses: [
        {
          rowType: "aggregate",
          recordId: "r",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: 1 },
        },
      ],
      exposures: [],
    });
    const evaluations = evaluateDiagnosticReviewRules(prepared);
    expect(evaluations[0]).toMatchObject({
      status: "not-evaluated",
      notEvaluatedReasons: ["missing"],
    });
    expect(evaluations[1]).toMatchObject({
      status: "triggered",
      triggerReason: "missing-input",
      notEvaluatedReasons: ["missing"],
    });
  });

  it("uses the expected-cell grid to preserve missing monotonic adjacencies", () => {
    const monotonic: DiagnosticDefinition = {
      ...definition,
      reviewRules: [
        {
          kind: "monotonic",
          id: "monotonic",
          code: "decrease",
          description: "Reported is cumulative",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          direction: "nondecreasing",
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(monotonic),
      losses: [
        {
          rowType: "aggregate",
          recordId: "r1",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2023",
          complete: true,
          measures: { reported: 1, open: 1 },
        },
        {
          rowType: "aggregate",
          recordId: "r2",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2025",
          complete: true,
          measures: { reported: 3, open: 1 },
        },
      ],
      exposures: [],
      expectedCells: [
        { sourceGroup: "all", origin: "2023", valuation: "2023" },
        {
          sourceGroup: "all",
          origin: "2023",
          valuation: "2024",
          source: { artifactId: "expected-grid", sourceRow: 2 },
        },
        { sourceGroup: "all", origin: "2023", valuation: "2025" },
      ],
    });
    const evaluations = evaluateDiagnosticReviewRules(prepared);
    expect(evaluations).toHaveLength(2);
    expect(
      evaluations.map((item) => [
        item.scope.kind === "valuation-pair"
          ? `${item.scope.previous.valuation}-${item.scope.current.valuation}`
          : "",
        item.status,
      ]),
    ).toEqual([
      ["2023-2024", "not-evaluated"],
      ["2024-2025", "not-evaluated"],
    ]);
  });

  it("finalizes control-total leaves from retained contributions rather than rounded cell totals", () => {
    const control: DiagnosticDefinition = {
      ...definition,
      reviewRules: [
        {
          kind: "control-total",
          id: "control",
          code: "control",
          description: "Reported matches the control",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          expected: 1,
          projection: { kind: "valuation", valuation: "2024" },
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(control),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "a",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: 1e16, open: 0 },
        },
        {
          rowType: "aggregate",
          recordId: "b",
          sourceGroup: "b",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: 1, open: 0 },
        },
        {
          rowType: "aggregate",
          recordId: "c",
          sourceGroup: "c",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: -1e16, open: 0 },
        },
      ],
      exposures: [],
    });
    expect(evaluateDiagnosticReviewRules(prepared)[0]).toMatchObject({
      status: "pass",
      left: 1,
      scope: { selectedCellCount: 3, selectedContributionCount: 3 },
    });
  });

  it("treats an empty control-total projection as missing input", () => {
    const control: DiagnosticDefinition = {
      ...definition,
      reviewRules: [
        {
          kind: "control-total",
          id: "control",
          code: "control",
          description: "Reported matches the control",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          expected: 0,
          filter: { sourceGroups: ["not-present"] },
          projection: { kind: "valuation", valuation: "2024" },
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(control),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { reported: 0, open: 0 },
        },
      ],
      exposures: [],
    });
    expect(evaluateDiagnosticReviewRules(prepared)[0]).toMatchObject({
      status: "not-evaluated",
      left: null,
      relation: null,
      notEvaluatedReasons: ["missing"],
      scope: { selectedCellCount: 0, selectedContributionCount: 0 },
    });
  });
});
