import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  canonicalJson,
  materializeMetricDiagnosticsResult,
  materializePreparedDiagnosticData,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  assertCompletedCompactMetricDiagnosticsRun,
  assertCompletedValidatedMetricDiagnosticsRun,
  assertCompactValidatedDiagnosticRunInput,
  assertValidatedDiagnosticRunInput,
  getCompletedCompactDiagnosticRunInput,
  runValidatedMetricDiagnostics,
  runValidatedMetricDiagnosticsCompact,
  validateDiagnosticRunInput,
  validateDiagnosticRunInputCompact,
} from "../src/index.js";

function definition(): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: "compact-gateway",
    version: "1",
    lossRowGrain: "aggregate",
    measures: [
      {
        id: "claims",
        displayName: "Claims",
        description: "Reported claims",
        source: "loss",
        kind: "count",
        unit: "claim",
        developmentSemantics: "cumulative",
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
        description: "Reported claims",
      },
    ],
    exposureBases: [],
    amountBases: [],
    derivedMeasures: [],
    formulas: [CASUALTY_FORMULA_TEMPLATES[1]],
    instances: [
      {
        id: "identity",
        version: "1",
        formulaId: "share",
        bindings: {
          part: { op: "measure", measureId: "claims" },
          whole: { op: "measure", measureId: "claims" },
        },
        presentation: {
          displayName: "Identity",
          description: "Identity ratio",
          displayUnit: "ratio",
          scale: 1,
          numeratorLabel: "claims",
          denominatorLabel: "claims",
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

function row(overrides: Record<string, unknown> = {}) {
  return {
    rowType: "aggregate",
    recordId: "r1",
    sourceGroup: "all",
    origin: "2024",
    valuation: "2024",
    complete: true,
    measures: { claims: 2 },
    source: { artifactId: "loss", sourceRow: 2 },
    ...overrides,
  };
}

function compare(input: unknown) {
  const eager = runValidatedMetricDiagnostics(validateDiagnosticRunInput(input));
  const compact = runValidatedMetricDiagnosticsCompact(validateDiagnosticRunInputCompact(input));
  expect(compact.status).toBe(eager.status);
  expect(compact.gate).toEqual(eager.gate);
  expect(compact.review.report.summary).toEqual(eager.review.report.summary);
  expect(compact.review.report.checks).toEqual(
    eager.review.report.checks.map(({ findings, ...check }) => ({
      ...check,
      findingCount: findings.length,
    })),
  );
  expect(canonicalJson(materializePreparedDiagnosticData(compact.prepared))).toBe(
    canonicalJson(eager.prepared),
  );
  if (compact.result !== null && eager.result !== null)
    expect(canonicalJson(materializeMetricDiagnosticsResult(compact.result))).toBe(
      canonicalJson(eager.result),
    );
  else expect(compact.result).toBe(eager.result);
  return { eager, compact };
}

describe("compact validated gateway", () => {
  it("returns the exact immutable validated input, including raw values filtered out of results", () => {
    const raw = {
      definition: definition(),
      losses: [
        row({ measures: { claims: -0 } }),
        row({ recordId: "excluded", sourceGroup: "elsewhere", measures: { claims: NaN } }),
      ],
      filter: { sourceGroups: ["all"] },
      expectedCells: [],
      policy: {
        allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
        rationaleRef: "explicit-test",
      },
    };
    const validated = validateDiagnosticRunInputCompact(raw);
    const run = runValidatedMetricDiagnosticsCompact(validated);
    assertCompletedCompactMetricDiagnosticsRun(run);
    const restored = getCompletedCompactDiagnosticRunInput(run);
    expect(restored).toBe(validated);
    expect(restored.losses).not.toBe(raw.losses);
    expect(restored.losses).toHaveLength(2);
    expect(Object.is(restored.losses[0]!.measures.claims, -0)).toBe(true);
    expect(Number.isNaN(restored.losses[1]!.measures.claims)).toBe(true);
    expect(restored.expectedCells).toEqual([]);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.losses[0]!.measures)).toBe(true);
    expect(Reflect.set(restored.losses[0]!.measures, "claims", 9)).toBe(false);
    raw.losses[0]!.measures.claims = 9;
    expect(Object.is(restored.losses[0]!.measures.claims, -0)).toBe(true);
    const repeated = runValidatedMetricDiagnosticsCompact(validated);
    assertCompletedCompactMetricDiagnosticsRun(repeated);
    expect(getCompletedCompactDiagnosticRunInput(repeated)).toBe(validated);
    const separate = validateDiagnosticRunInputCompact({
      definition: definition(),
      losses: [row()],
    });
    const separateRun = runValidatedMetricDiagnosticsCompact(separate);
    assertCompletedCompactMetricDiagnosticsRun(separateRun);
    expect(getCompletedCompactDiagnosticRunInput(separateRun)).toBe(separate);
    expect(getCompletedCompactDiagnosticRunInput(separateRun)).not.toBe(validated);
  });

  it("never obtains replay input through a forged, blocked or legacy run", () => {
    const raw = { definition: definition(), losses: [row()] };
    const run = runValidatedMetricDiagnosticsCompact(validateDiagnosticRunInputCompact(raw));
    const blocked = runValidatedMetricDiagnosticsCompact(
      validateDiagnosticRunInputCompact({ ...raw, policy: { allowedReviewStatuses: [] } }),
    );
    const legacy = runValidatedMetricDiagnostics(validateDiagnosticRunInput(raw));
    for (const candidate of [{ ...run }, JSON.parse(JSON.stringify(run)), blocked, legacy, null])
      expect(() => getCompletedCompactDiagnosticRunInput(candidate as never)).toThrow(
        /authentic completed compact/,
      );
  });

  it("matches complete eager content without exposing eager identity fields", () => {
    const { compact } = compare({ definition: definition(), losses: [row()] });
    expect(compact.status).toBe("completed");
    expect(compact.prepared).not.toHaveProperty("preparationFingerprint");
    expect(compact.review).not.toHaveProperty("identityBody");
    expect(compact.review).not.toHaveProperty("reportFingerprint");
    expect(compact.result).not.toHaveProperty("preparationFingerprint");
    expect(() => assertCompletedCompactMetricDiagnosticsRun(compact)).not.toThrow();
  });

  it("requires its own authentic inputs and completed results", () => {
    const input = { definition: definition(), losses: [row()] };
    const compact = validateDiagnosticRunInputCompact(input);
    const eager = validateDiagnosticRunInput(input);
    expect(() => assertCompactValidatedDiagnosticRunInput(compact)).not.toThrow();
    expect(() => assertValidatedDiagnosticRunInput(compact)).toThrow(/authentic/);
    expect(() => assertCompactValidatedDiagnosticRunInput(eager)).toThrow(/authentic/);
    for (const forged of [{ ...compact }, JSON.parse(JSON.stringify(compact)), null]) {
      expect(() => assertCompactValidatedDiagnosticRunInput(forged)).toThrow(/authentic/);
      expect(() => runValidatedMetricDiagnosticsCompact(forged)).toThrow(/authentic/);
    }
    const outcome = runValidatedMetricDiagnosticsCompact(compact);
    expect(() => assertCompletedValidatedMetricDiagnosticsRun(outcome)).toThrow(/authentic/);
    expect(() => assertCompletedCompactMetricDiagnosticsRun({ ...outcome })).toThrow(/authentic/);
    expect(() =>
      assertCompletedCompactMetricDiagnosticsRun(runValidatedMetricDiagnostics(eager)),
    ).toThrow(/authentic/);
    const blocked = runValidatedMetricDiagnosticsCompact(
      validateDiagnosticRunInputCompact({
        ...input,
        policy: { allowedReviewStatuses: [] },
      }),
    );
    expect(blocked.status).toBe("blocked");
    expect(() => assertCompletedCompactMetricDiagnosticsRun(blocked)).toThrow(/authentic/);
  });

  it("owns nested caller values and only reuses authentic frozen preparation", () => {
    const loss = row();
    const input = { definition: definition(), losses: [loss], groupMap: { all: "total" } };
    Object.freeze(loss);
    const validated = validateDiagnosticRunInputCompact(input);
    loss.measures.claims = 99;
    loss.source.sourceRow = 99;
    input.groupMap.all = "changed";
    expect(Reflect.set(input.definition.instances[0]!.presentation, "scale", 999)).toBe(true);
    const first = runValidatedMetricDiagnosticsCompact(validated);
    const second = runValidatedMetricDiagnosticsCompact(validated);
    expect(first.prepared).toBe(second.prepared);
    expect(first.result).toEqual(second.result);
    expect(validated.losses[0]!.measures.claims).toBe(2);
    expect(validated.losses[0]!.source!.sourceRow).toBe(2);
    expect(first.groupMap.all).toBe("total");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(validated.losses[0]!.measures)).toBe(true);
    expect(Object.isFrozen(first.prepared.cells[0])).toBe(true);
    expect(Reflect.set(validated.losses[0]!.measures, "claims", 10)).toBe(false);
  });

  it.each([
    ["invalid period", { losses: [row({ origin: "bad" })] }],
    ["duplicate record", { losses: [row(), row()] }],
    ["incomplete loss", { losses: [row({ complete: false })] }],
    ["undeclared measure", { losses: [row({ measures: { claims: 2, typo: 4 } })] }],
    [
      "missing expected cell",
      { losses: [], expectedCells: [{ sourceGroup: "all", origin: "2024", valuation: "2024" }] },
    ],
  ])("preserves structural blocking: %s", (_name, input) => {
    const { compact } = compare({ definition: definition(), ...input });
    expect(compact).toMatchObject({ status: "blocked", stage: "review", result: null });
  });

  it.each([
    { losses: [row({ source: undefined })] },
    { filter: { originFrom: undefined } },
    { losses: [row({ ageMonths: 12 })] },
    { losses: [row({ rowType: "claim", claimId: "c1" })] },
    { policy: { allowedMetricFindingSeverities: ["fail"] } },
    { groupMap: { "": "all" } },
  ])("retains the exact boundary failure for %#", (change) => {
    const input = { definition: definition(), losses: [row()], ...change };
    function captured(validate: (value: unknown) => unknown) {
      try {
        validate(input);
      } catch (error) {
        return error;
      }
      throw new Error("Invalid fixture accepted");
    }
    expect(captured(validateDiagnosticRunInputCompact)).toEqual(
      captured(validateDiagnosticRunInput),
    );
  });

  it("preserves all sixteen review-policy subsets, including status masking", () => {
    const base = definition();
    const mixed: DiagnosticDefinition = {
      ...base,
      reviewRules: (["pass", "warn", "fail"] as const).map((id) => ({
        kind: "compare",
        id,
        code: id,
        description: id,
        severity: id === "fail" ? "fail" : "warning",
        missingInput: "not-evaluated",
        when: {
          left: { op: "measure", measureId: "claims" },
          operator: id === "pass" ? "lt" : "gt",
          right: { op: "constant", value: 0 },
        },
      })),
    };
    const statuses = ["pass", "warning", "not-evaluated", "fail"] as const;
    for (let mask = 0; mask < 16; mask++) {
      const { compact } = compare({
        definition: mixed,
        losses: [
          row(),
          row({ recordId: "missing", origin: "2023", valuation: "2023", measures: {} }),
        ],
        policy: {
          allowedReviewStatuses: statuses.filter((_, index) => mask & (1 << index)),
          allowedMetricFindingSeverities: ["info", "warning", "fail"],
          rationaleRef: "explicit-matrix-test",
        },
      });
      expect(compact.review.evaluations.summary).toEqual({
        pass: 1,
        warning: 1,
        fail: 1,
        notEvaluated: 3,
      });
      expect(compact.status, `policy subset ${mask}`).toBe(mask === 15 ? "completed" : "blocked");
    }
  });

  it("preserves all eight metric-severity policy subsets", () => {
    const base = definition();
    const withRules: DiagnosticDefinition = {
      ...base,
      instances: base.instances.map((instance) => ({
        ...instance,
        rules: (["warning", "fail"] as const).map((severity) => ({
          id: severity,
          code: `metric-${severity}`,
          message: severity,
          severity,
          when: {
            left: { source: "constant", value: 1 },
            operator: "gt",
            right: { source: "constant", value: 0 },
          },
        })),
      })),
    };
    const severities = ["info", "warning", "fail"] as const;
    for (let mask = 0; mask < 8; mask++) {
      const { compact } = compare({
        definition: withRules,
        losses: [row()],
        policy: {
          allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
          allowedMetricFindingSeverities: severities.filter((_, index) => mask & (1 << index)),
          rationaleRef: "explicit-matrix-test",
        },
      });
      expect(compact.gate.reviewGate).toBe("passed");
      expect(compact.status, `metric subset ${mask}`).toBe(
        (mask & 6) === 6 ? "completed" : "blocked",
      );
    }
  });

  it("keeps zero, missing and cutoff results identical", () => {
    for (const measures of [{ claims: 0 }, {}, { claims: null }])
      compare({ definition: definition(), losses: [row({ measures })] });
    const { compact } = compare({
      definition: definition(),
      losses: [row()],
      completePeriodCutoffs: [
        { sourceGroup: "all", originThrough: "2023", valuationThrough: "2023" },
      ],
    });
    expect(compact.prepared.cells).toHaveLength(0);
    expect(compact.prepared.inputAudit[0]!.disposition).toBe("complete-period-cutoff");
  });
});
