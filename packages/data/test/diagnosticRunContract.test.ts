import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  prepareDiagnosticData,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  reviewPreparedDiagnosticData,
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "../src/index.js";

function definition(
  grain: "aggregate" | "claim" = "aggregate",
  exposure = false,
): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: `run-${grain}-${exposure}`,
    version: "1",
    lossRowGrain: grain,
    measures: [
      {
        id: "claims",
        displayName: "Claims",
        description: "Claims",
        source: "loss",
        kind: "count",
        unit: "claim",
        developmentSemantics: "cumulative",
        aggregation: "sum",
        missing: "unknown",
        countPopulationId: "claims",
      },
      ...(exposure
        ? [
            {
              id: "exposure",
              displayName: "Exposure",
              description: "Exposure",
              source: "exposure" as const,
              kind: "exposure" as const,
              unit: "vehicle-year",
              developmentSemantics: "cumulative" as const,
              aggregation: "sum" as const,
              missing: "unknown" as const,
              exposureBasisId: "vehicles",
              exposureTiming: "origin-static" as const,
            },
          ]
        : []),
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
    exposureBases: exposure
      ? [
          {
            id: "vehicles",
            displayName: "Vehicles",
            basis: "earned",
            unit: "vehicle-year",
            description: "Vehicles",
          },
        ]
      : [],
    amountBases: [],
    derivedMeasures: [],
    formulas: [
      exposure ? CASUALTY_FORMULA_TEMPLATES[0] : CASUALTY_FORMULA_TEMPLATES[1],
    ],
    instances: [
      {
        id: "metric",
        version: "1",
        formulaId: exposure ? "frequency" : "share",
        bindings: exposure
          ? {
              claims: { op: "measure", measureId: "claims" },
              exposure: { op: "measure", measureId: "exposure" },
            }
          : {
              part: { op: "measure", measureId: "claims" },
              whole: { op: "measure", measureId: "claims" },
            },
        presentation: {
          displayName: "Metric",
          description: "Metric",
          displayUnit: "ratio",
          scale: 1,
          numeratorLabel: "numerator",
          denominatorLabel: "denominator",
        },
        rules: [],
      },
    ],
    reviewRules: [],
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

const row = (overrides: Record<string, unknown> = {}) => ({
  rowType: "aggregate",
  recordId: "r1",
  sourceGroup: "all",
  origin: "2024",
  valuation: "2024",
  complete: true,
  measures: { claims: 2 },
  ...overrides,
});

describe("validated diagnostic run structural and execution gates", () => {
  it.each([
    [
      "invalid period",
      { losses: [row({ origin: "bad" })] },
      "diagnostic/structural/period-validity",
    ],
    [
      "duplicate record",
      { losses: [row(), row()] },
      "diagnostic/structural/loss-identity",
    ],
    [
      "incomplete loss",
      { losses: [row({ complete: false })] },
      "diagnostic/structural/loss-completeness",
    ],
    [
      "undeclared measure",
      { losses: [row({ measures: { claims: 2, typo: 4 } })] },
      "diagnostic/structural/measure-contract",
    ],
    [
      "missing expected cell",
      {
        losses: [],
        expectedCells: [
          { sourceGroup: "all", origin: "2024", valuation: "2024" },
        ],
      },
      "diagnostic/structural/expected-cell-coverage",
    ],
  ])("blocks %s at structural review", (_name, input, checkId) => {
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({ definition: definition(), ...input }),
    );
    expect(outcome).toMatchObject({
      status: "blocked",
      stage: "review",
      gate: { reviewGate: "blocked", metricGate: "not-run" },
    });
    expect(
      outcome.review.report.checks.find((check) => check.id === checkId)
        ?.status,
    ).toBe("fail");
  });

  it("executes cutoffs and preserves excluded rows in the audit", () => {
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        definition: definition(),
        losses: [row()],
        completePeriodCutoffs: [
          {
            sourceGroup: "all",
            originThrough: "2023",
            valuationThrough: "2023",
          },
        ],
      }),
    );
    expect(outcome.status).toBe("completed");
    expect(outcome.prepared.inputAudit[0]!.disposition).toBe(
      "complete-period-cutoff",
    );
    expect(outcome.prepared.cells).toEqual([]);
    if (outcome.status === "completed")
      expect(outcome.result.emergence).toEqual([]);
  });

  it("never converts a fail-allowed structural ambiguity into a number", () => {
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        definition: definition("claim"),
        losses: [
          {
            rowType: "claim",
            claimId: "c1",
            recordId: "r1",
            sourceGroup: "all",
            origin: "2024",
            valuation: "2024",
            complete: false,
            measures: { claims: 10 },
          },
          {
            rowType: "claim",
            claimId: "c2",
            recordId: "r2",
            sourceGroup: "all",
            origin: "2024",
            valuation: "2024",
            complete: true,
            measures: { claims: 2 },
          },
        ],
        policy: {
          allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
          rationaleRef: "actuary-reviewed-exception",
        },
      }),
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed")
      throw new Error("expected explicitly allowed run");
    expect(outcome.result.emergence[0]!.components.claims).toMatchObject({
      value: null,
      structural: 1,
    });
    expect(
      outcome.result.emergence[0]!.metrics.metric!.calculation.value,
    ).toBeNull();
  });

  it("accepts raw non-finite numbers only long enough to audit and fail closed", () => {
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        definition: definition(),
        losses: [row({ measures: { claims: Number.POSITIVE_INFINITY } })],
      }),
    );
    expect(outcome).toMatchObject({ status: "blocked", stage: "metric" });
    expect(outcome.prepared.inputAudit[0]!.record).toMatchObject({
      measures: {
        claims: {
          status: "non-finite",
          value: null,
          nonFiniteKind: "positive-infinity",
        },
      },
    });
    if (outcome.status === "blocked" && outcome.stage === "metric")
      expect(outcome.result.findings.map((finding) => finding.code)).toContain(
        "diagnostic-measure-non-finite",
      );
  });

  it("reports structural-check applicability honestly", () => {
    const noExposure = reviewPreparedDiagnosticData({
      prepared: prepareDiagnosticData({
        definition: compileDiagnosticDefinition(definition()),
        losses: [],
        exposures: [],
      }),
      evidence: null,
    });
    for (const id of [
      "diagnostic/structural/exposure-identity",
      "diagnostic/structural/exposure-completeness",
      "diagnostic/structural/loss-without-exposure",
      "diagnostic/structural/exposure-without-loss",
    ])
      expect(
        noExposure.report.checks.find((check) => check.id === id)?.status,
      ).toBe("not-evaluated");
    expect(
      noExposure.report.checks.find(
        (check) => check.id === "diagnostic/structural/expected-cell-coverage",
      )?.status,
    ).toBe("not-evaluated");

    const explicitEmpty = reviewPreparedDiagnosticData({
      prepared: prepareDiagnosticData({
        definition: compileDiagnosticDefinition(definition()),
        losses: [],
        exposures: [],
        expectedCells: [],
      }),
      evidence: { groupingAssignments: [], cachedFormulas: [] },
    });
    expect(
      explicitEmpty.report.checks.find(
        (check) => check.id === "diagnostic/structural/expected-cell-coverage",
      )?.status,
    ).toBe("pass");
    expect(
      explicitEmpty.report.checks
        .slice(-2)
        .every((check) => check.status === "pass"),
    ).toBe(true);
  });

  it("strictly validates and snapshots direct review evidence", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition()),
      losses: [],
      exposures: [],
    });
    expect(() =>
      reviewPreparedDiagnosticData({
        prepared: {} as typeof prepared,
        evidence: { groupingAssignments: [], cachedFormulas: [] },
      }),
    ).toThrow(/not authentic/i);
    expect(() =>
      reviewPreparedDiagnosticData({
        prepared,
        evidence: {
          groupingAssignments: [{ key: "", group: "g" }],
          cachedFormulas: [],
        },
      }),
    ).toThrow(/at least 1 character/i);
    expect(() =>
      reviewPreparedDiagnosticData({
        prepared,
        evidence: {
          groupingAssignments: [],
          cachedFormulas: [
            { id: "x", declaredFormulaSource: false, extra: true } as never,
          ],
        },
      }),
    ).toThrow(/Unrecognized key/i);
    expect(() =>
      reviewPreparedDiagnosticData({
        prepared,
        evidence: {
          groupingAssignments: [{ key: "k", group: "g", source: undefined }],
          cachedFormulas: [],
        },
      }),
    ).toThrow(/Explicit undefined/);
    const evidence = {
      groupingAssignments: [{ key: "k", group: "g" }],
      cachedFormulas: [],
    };
    const receipt = reviewPreparedDiagnosticData({ prepared, evidence });
    expect(receipt.definitionIntegrity).toBe(
      prepared.definition.definitionIntegrity,
    );
    expect(receipt.preparationFingerprint).toBe(
      prepared.preparationFingerprint,
    );
    evidence.groupingAssignments[0]!.group = "changed";
    expect(receipt.evidence?.groupingAssignments[0]!.group).toBe("g");
    expect(Object.isFrozen(receipt.evidence?.groupingAssignments)).toBe(true);

    const ordered = reviewPreparedDiagnosticData({
      prepared,
      evidence: {
        groupingAssignments: [
          {
            key: "same",
            group: "a",
            source: { artifactId: "mapping", sourceRow: 10 },
          },
          {
            key: "same",
            group: "b",
            source: { artifactId: "mapping", sourceRow: 2 },
          },
        ],
        cachedFormulas: [],
      },
    });
    expect(
      ordered.report.checks
        .find(
          (check) => check.id === "diagnostic/structural/grouping-consistency",
        )!
        .findings[0]!.context!.sources!.map((source) => source.sourceRow),
    ).toEqual([2, 10]);
  });

  it("rejects explicit undefined instead of treating it as omission", () => {
    expect(() =>
      validateDiagnosticRunInput({
        definition: definition(),
        losses: [row({ source: undefined })],
      }),
    ).toThrow(/Explicit undefined/);
    expect(() =>
      validateDiagnosticRunInput({
        definition: definition(),
        losses: [row()],
        filter: { originFrom: undefined },
      }),
    ).toThrow(/Explicit undefined/);
  });

  it("projects required not-evaluated review findings into the review receipt", () => {
    const withRule: DiagnosticDefinition = {
      ...definition(),
      reviewRules: [
        {
          kind: "compare",
          id: "claims-positive",
          code: "claims-not-positive",
          description: "Claims are positive",
          severity: "warning",
          missingInput: "not-evaluated",
          when: {
            left: { op: "measure", measureId: "claims" },
            operator: "lte",
            right: { op: "constant", value: 0 },
          },
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(withRule),
      losses: [{ ...row({ measures: {} }), rowType: "aggregate" as const }],
      exposures: [],
    });
    const receipt = reviewPreparedDiagnosticData({ prepared, evidence: null });
    const check = receipt.report.checks.find(
      (item) => item.id === "claims-positive",
    )!;
    expect(check.status).toBe("not-evaluated");
    expect(check.findings).toContainEqual(
      expect.objectContaining({
        code: "diagnostic-review-rule-not-evaluated",
        context: expect.objectContaining({ ruleId: "claims-positive" }),
      }),
    );
  });

  it("gates every declarative evaluation instead of its aggregate presentation status", () => {
    const withRule: DiagnosticDefinition = {
      ...definition(),
      reviewRules: [
        {
          kind: "compare",
          id: "claims-positive",
          code: "claims-not-positive",
          description: "Claims are positive",
          severity: "warning",
          missingInput: "not-evaluated",
          when: {
            left: { op: "measure", measureId: "claims" },
            operator: "lte",
            right: { op: "constant", value: 0 },
          },
        },
      ],
    };
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        definition: withRule,
        losses: [
          row({
            recordId: "r1",
            origin: "2023",
            valuation: "2023",
            measures: { claims: 0 },
          }),
          row({
            recordId: "r2",
            origin: "2024",
            valuation: "2024",
            measures: {},
          }),
        ],
        policy: { allowedReviewStatuses: ["pass", "warning"] },
      }),
    );
    expect(outcome).toMatchObject({ status: "blocked", stage: "review" });
    expect(
      outcome.review.report.checks.find(
        (check) => check.id === "claims-positive",
      )?.status,
    ).toBe("warning");
    expect(outcome.review.evaluations.map((item) => item.status)).toEqual([
      "triggered",
      "not-evaluated",
    ]);
  });

  it("validates grouping configuration before returning an actuarial outcome", () => {
    expect(() =>
      validateDiagnosticRunInput({
        definition: definition(),
        losses: [row()],
        groupMap: { missing: "all" },
      }),
    ).toThrow(/unused source group/i);
  });
});
