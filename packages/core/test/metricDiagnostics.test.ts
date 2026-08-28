import { describe, expect, it } from "vitest";
import {
  CASUALTY_AMOUNT_LAYERS,
  CASUALTY_DIAGNOSTIC_COMPONENTS as C,
  CASUALTY_QUARTERLY_METRICS,
  commonMaturity,
  createCasualtyAmountLayers,
  createCasualtyQuarterlyMetrics,
  deriveAmountLayers,
  diagnosticWarningToFinding,
  evaluateMetric,
  finalizeMeasureAggregate,
  aggregateMeasures,
  mergeMeasureAggregates,
  metricTriangleFromEmergence,
  reconcileDiagnosticExposureKeys,
  runMetricDiagnostics,
  sameMaturity,
  type DiagnosticLossRow,
  type MetricDefinition,
  type RunMetricDiagnosticsInput,
} from "../src/index.js";
import {
  quarterlyCasualtyExpectedFleetA2024Q4Age3,
  quarterlyCasualtyExposures,
  quarterlyCasualtyLosses,
} from "./fixtures/quarterlyCasualty.js";

function loss<TDimensions = unknown>(
  overrides: Partial<DiagnosticLossRow<TDimensions>> = {},
): DiagnosticLossRow<TDimensions> {
  return {
    id: "row-1",
    group: "all",
    origin: "2024Q1",
    valuation: "2024Q1",
    ageMonths: 3,
    measures: {
      [C.reported]: 100,
      [C.open]: 20,
      [C.closedNoPay]: 30,
      [C.closedWithPay]: 50,
      [C.paid250]: 600_000,
      [C.incurred250]: 800_000,
      [C.paidPrimary]: 900_000,
      [C.incurredPrimary]: 1_200_000,
    },
    ...overrides,
  };
}

function run(overrides: Partial<RunMetricDiagnosticsInput> = {}) {
  return runMetricDiagnostics({
    losses: [loss()],
    exposures: [{ key: "exp-1", group: "all", origin: "2024Q1", measures: { [C.exposure]: 2_000_000 } }],
    metrics: CASUALTY_QUARTERLY_METRICS,
    ...overrides,
  });
}

describe("generic metric evaluation and casualty preset", () => {
  it("matches hand calculations for all twenty reference metrics on both amount bases", () => {
    const values = Object.fromEntries(
      Object.entries(run().emergence[0]!.metrics).map(([id, result]) => [id, result.value]),
    );
    expect(values).toEqual({
      "reported-frequency": 50,
      "open-frequency": 10,
      "closed-no-pay-frequency": 15,
      "closed-with-pay-frequency": 25,
      "non-closed-no-pay-frequency": 35,
      "closed-no-pay-share": 0.3,
      "closed-with-pay-share": 0.5,
      "open-share": 0.2,
      "paid-to-incurred-250": 0.75,
      "paid-to-incurred-primary": 0.75,
      "incurred-250-per-exposure": 0.4,
      "incurred-primary-per-exposure": 0.6,
      "incurred-250-per-non-cnp": 800_000 / 70,
      "incurred-primary-per-non-cnp": 1_200_000 / 70,
      "paid-250-per-exposure": 0.3,
      "paid-primary-per-exposure": 0.45,
      "paid-250-per-closed-with-pay": 12_000,
      "paid-primary-per-closed-with-pay": 18_000,
      "case-250-per-open": 10_000,
      "case-primary-per-open": 15_000,
    });
  });

  it("aggregates components first and divides once, never averaging row ratios", () => {
    const metric: MetricDefinition = {
      id: "custom", version: "1", displayName: "Custom", description: "ratio", unit: "ratio", scale: 1,
      numerator: { op: "measure", measure: "n" }, denominator: { op: "measure", measure: "d" },
      numeratorLabel: "n", denominatorLabel: "d", basis: "custom", requiredComponents: ["n", "d"],
    };
    const result = runMetricDiagnostics({
      losses: [
        loss({ id: "a", measures: { n: 1, d: 1 } }),
        loss({ id: "b", measures: { n: 9, d: 99 } }),
      ],
      metrics: [metric],
    });
    expect(result.emergence[0]!.metrics.custom!.value).toBe(0.1);
    expect((1 / 1 + 9 / 99) / 2).not.toBe(0.1);
  });

  it("returns null with structured warnings for missing, non-finite, zero, and negative denominators", () => {
    const definition = CASUALTY_QUARTERLY_METRICS.find((m) => m.id === "reported-frequency")!;
    for (const denominator of [null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const result = evaluateMetric(definition, { [C.reported]: 2, [C.exposure]: denominator });
      expect(result.value).toBeNull();
      expect(result.warnings.some((warning) => warning.code === "INVALID_DENOMINATOR")).toBe(true);
      expect(Number.isNaN(result.value)).toBe(false);
    }
  });

  it("converts arithmetic overflow to null instead of exposing Infinity", () => {
    const definition: MetricDefinition = {
      id: "overflow", version: "1", displayName: "Overflow", description: "overflow guard", unit: "ratio",
      scale: Number.MAX_VALUE, numerator: { op: "measure", measure: "n" }, denominator: { op: "measure", measure: "d" },
      numeratorLabel: "n", denominatorLabel: "d", basis: "test", requiredComponents: ["n", "d"],
    };
    const result = evaluateMetric(definition, { n: Number.MAX_VALUE, d: 1 });
    expect(result.value).toBeNull();
    expect(result.rawNumerator).toBe(Number.MAX_VALUE);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "NON_FINITE_RESULT" }));
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });

  it("allows a negative numerator and distinguishes explicit zero from missing", () => {
    const definition = CASUALTY_QUARTERLY_METRICS.find((m) => m.id === "case-250-per-open")!;
    const components = {
      [C.incurred250]: 5,
      [C.paid250]: 8,
      [C.open]: 1,
    };
    expect(evaluateMetric(definition, components).value).toBe(-3);
    const flagged = evaluateMetric({
      ...definition,
      evaluateWarnings: ({ rawNumerator }) => rawNumerator !== null && rawNumerator < 0
        ? [{ code: "NEGATIVE_CASE_REVIEW", message: "Review recovery-driven negative case" }]
        : [],
    }, components);
    expect(flagged.value).toBe(-3);
    expect(flagged.warnings).toContainEqual(expect.objectContaining({ code: "NEGATIVE_CASE_REVIEW" }));
    expect(finalizeMeasureAggregate(aggregateMeasures([{ x: 0 }])).measures.x).toBe(0);
    expect(finalizeMeasureAggregate(aggregateMeasures([{ x: null }])).measures.x).toBeNull();
  });

  it("uses sparse zero only under the explicit policy", () => {
    const aggregate = aggregateMeasures([{ x: 1 }, { x: null }]);
    expect(finalizeMeasureAggregate(aggregate).measures.x).toBeNull();
    expect(finalizeMeasureAggregate(aggregate, "zero-fill").measures.x).toBe(1);
  });

  it("emits a paid-over-incurred warning without suppressing the audited result", () => {
    const definition = CASUALTY_QUARTERLY_METRICS.find((m) => m.id === "paid-to-incurred-250")!;
    const result = evaluateMetric(definition, { [C.paid250]: 110, [C.incurred250]: 100 });
    expect(result.value).toBe(1.1);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "PAID_EXCEEDS_INCURRED" }));
    expect(diagnosticWarningToFinding(result.warnings[0]!)).toMatchObject({
      severity: "warning",
      code: "PAID_EXCEEDS_INCURRED",
    });
  });

  it("supports custom components, expressions, scale, labels, basis, and version", () => {
    const custom: MetricDefinition = {
      id: "net-rate", version: "2026.1", displayName: "Net rate", description: "(a-b)/e", unit: "widgets",
      scale: 100, numerator: { op: "subtract", left: { op: "measure", measure: "a" }, right: { op: "measure", measure: "b" } },
      denominator: { op: "measure", measure: "e" }, numeratorLabel: "net", denominatorLabel: "exposure",
      basis: "caller basis", requiredComponents: ["a", "b", "e"],
    };
    expect(evaluateMetric(custom, { a: 9, b: 3, e: 12 })).toMatchObject({
      metricId: "net-rate", metricVersion: "2026.1", value: 50, rawNumerator: 6, rawDenominator: 12,
      numeratorLabel: "net", denominatorLabel: "exposure", basis: "caller basis",
    });
  });

  it("supports pure caller-defined warning evaluation", () => {
    const custom: MetricDefinition = {
      id: "threshold", version: "1", displayName: "Threshold", description: "custom warning", unit: "ratio",
      scale: 1, numerator: { op: "measure", measure: "a" }, denominator: { op: "measure", measure: "b" },
      numeratorLabel: "a", denominatorLabel: "b", basis: "custom", requiredComponents: ["a", "b"],
      evaluateWarnings: ({ value }) => value !== null && value > 0.5
        ? [{ code: "CALLER_THRESHOLD", message: "Caller threshold exceeded" }]
        : [],
    };
    expect(evaluateMetric(custom, { a: 8, b: 10 }).warnings)
      .toContainEqual({ code: "CALLER_THRESHOLD", message: "Caller threshold exceeded" });
  });

  it("configures preset source keys, exposure key, scale, labels, basis, and version", () => {
    const configured = createCasualtyQuarterlyMetrics({
      components: {
        reported: "claimsReported",
        open: "claimsOpen",
        closedNoPay: "claimsClosedNoPay",
        closedWithPay: "claimsClosedWithPay",
        exposure: "nightsStayed",
      },
      frequencyScale: 1_000,
      frequencyUnit: "count-per-thousand-nights",
      definitionVersion: "hotel-casualty-v3",
      basisLabels: { counts: "claim status", primary: "caller primary" },
      displayOverrides: {
        "reported-frequency": {
          displayName: "Reported claims per thousand nights",
          denominatorLabel: "nights stayed",
        },
      },
    });
    const reportedFrequency = configured.find((metric) => metric.id === "reported-frequency")!;
    expect(evaluateMetric(reportedFrequency, { claimsReported: 12, nightsStayed: 4_000 })).toMatchObject({
      value: 3,
      metricVersion: "hotel-casualty-v3",
      unit: "count-per-thousand-nights",
      denominatorLabel: "nights stayed",
    });
    expect(reportedFrequency.displayName).toBe("Reported claims per thousand nights");
    expect(reportedFrequency.requiredComponents).toEqual(["claimsReported", "nightsStayed"]);
  });

  it("represents caller-defined reported-above-threshold counts without SDK vocabulary changes", () => {
    const thresholdMetric: MetricDefinition = {
      id: "reported-above-500k-frequency",
      version: "1",
      displayName: "Reported claims above $500K",
      description: "Caller-supplied threshold count per exposure",
      unit: "count-per-million",
      scale: 1_000_000,
      numerator: { op: "measure", measure: "reportedAbove500k" },
      denominator: { op: "measure", measure: "roomNights" },
      numeratorLabel: "reported claims above $500K",
      denominatorLabel: "room nights",
      basis: "unlimited",
      requiredComponents: ["reportedAbove500k", "roomNights"],
    };
    expect(evaluateMetric(thresholdMetric, { reportedAbove500k: 3, roomNights: 1_500_000 }).value).toBe(2);
  });
});

describe("amount layers", () => {
  it("keeps pre-capped measures additive and caps indemnity per claim before adding unlimited expense", () => {
    const rows = deriveAmountLayers([
      { dimensions: "a", measures: { preCapped250Paid: 200, preCapped250Incurred: 250, indemnityPaid: 1_200_000, indemnityIncurred: 1_500_000, expensePaid: 50_000, expenseIncurred: 100_000 } },
      { dimensions: "b", measures: { preCapped250Paid: 100, preCapped250Incurred: 150, indemnityPaid: 600_000, indemnityIncurred: 800_000, expensePaid: 30_000, expenseIncurred: 50_000 } },
    ], CASUALTY_AMOUNT_LAYERS);
    const total = finalizeMeasureAggregate(aggregateMeasures(rows.map((row) => row.measures))).measures;
    expect(total[C.paid250]).toBe(300);
    expect(total[C.incurred250]).toBe(400);
    expect(total[C.paidPrimary]).toBe(1_680_000);
    expect(total[C.incurredPrimary]).toBe(1_950_000);
    expect(total[C.incurredPrimary]).not.toBe(Math.min(2_450_000, 1_000_000) + 150_000);
  });

  it("configures layer identifiers, source/output keys, labels, and the indemnity limit", () => {
    const layers = createCasualtyAmountLayers({
      components: {
        paid250: "limitedPaid",
        incurred250: "limitedIncurred",
        paidPrimary: "retainedPaid",
        incurredPrimary: "retainedIncurred",
      },
      limited250: {
        id: "source-limited",
        displayName: "Source limited total",
        paidSourceMeasure: "sourcePaid",
        incurredSourceMeasure: "sourceIncurred",
      },
      primary: {
        id: "retained-layer",
        displayName: "$750K indemnity plus expense",
        indemnityPaidMeasure: "indPaid",
        indemnityIncurredMeasure: "indIncurred",
        expensePaidMeasure: "alaePaid",
        expenseIncurredMeasure: "alaeIncurred",
        indemnityLimit: 750_000,
      },
    });
    const [row] = deriveAmountLayers([{
      dimensions: "claim-1",
      measures: {
        sourcePaid: 200_000,
        sourceIncurred: 250_000,
        indPaid: 800_000,
        indIncurred: 900_000,
        alaePaid: 40_000,
        alaeIncurred: 60_000,
      },
    }], layers);
    expect(layers.map((layer) => [layer.id, layer.displayName])).toEqual([
      ["source-limited", "Source limited total"],
      ["retained-layer", "$750K indemnity plus expense"],
    ]);
    expect(row!.measures).toMatchObject({
      limitedPaid: 200_000,
      limitedIncurred: 250_000,
      retainedPaid: 790_000,
      retainedIncurred: 810_000,
    });
  });
});

describe("exposure identity, aggregation, filtering, and views", () => {
  it("rejects duplicate loss row ids before they can be double-counted", () => {
    expect(() => run({
      losses: [
        loss({ id: "duplicate-row" }),
        loss({ id: "duplicate-row", group: "another-group" }),
      ],
    })).toThrow(/Duplicate loss row id duplicate-row/);
  });

  it("orders fallback period labels and groups naturally without locale rules", () => {
    const result = run({
      losses: [
        loss({ id: "ten-ten", group: "segment-10", origin: "AY10", valuation: "V10" }),
        loss({ id: "two-ten", group: "segment-2", origin: "AY10", valuation: "V10" }),
        loss({ id: "two-two", group: "segment-2", origin: "AY2", valuation: "V2" }),
      ],
      exposures: undefined,
    });
    expect(result.emergence.map((point) => `${point.group}/${point.origin}`)).toEqual([
      "segment-2/AY2",
      "segment-2/AY10",
      "segment-10/AY10",
    ]);
    expect(result.triangles
      .filter((triangle) => triangle.metricId === "reported-frequency")
      .map((triangle) => triangle.group)).toEqual(["segment-2", "segment-10"]);
  });

  it("supports prototype-named metric, component, and mapped group keys", () => {
    const measures = Object.assign(Object.create(null), {
      ["__proto__"]: 2,
      ["constructor"]: 4,
    }) as Record<string, number>;
    const metric: MetricDefinition = {
      id: "__proto__",
      version: "1",
      displayName: "Prototype-safe ratio",
      description: "Arbitrary caller keys remain data",
      unit: "ratio",
      scale: 1,
      numerator: { op: "measure", measure: "__proto__" },
      denominator: { op: "measure", measure: "constructor" },
      numeratorLabel: "__proto__",
      denominatorLabel: "constructor",
      basis: "caller",
      requiredComponents: ["__proto__", "constructor"],
    };
    const result = runMetricDiagnostics<{ label: string }>({
      losses: [loss({ id: "prototype-row", group: "source", measures })],
      metrics: [metric],
      groupMap: { source: "__proto__" },
      groupDimensions: { ["__proto__"]: { label: "prototype-safe group" } },
    });
    const point = result.emergence[0]!;
    expect(point.group).toBe("__proto__");
    expect(point.dimensions).toEqual({ label: "prototype-safe group" });
    expect(Object.getPrototypeOf(point.components)).toBeNull();
    expect(Object.getPrototypeOf(point.metrics)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(point.metrics, "__proto__")).toBe(true);
    expect(point.metrics["__proto__"]!.value).toBe(0.5);
    expect(Object.getPrototypeOf(point.metrics["__proto__"]!.rawComponents)).toBeNull();
    expect(point.components["__proto__"]).toBe(2);
  });

  it("uses only own groupMap properties", () => {
    const metric: MetricDefinition = {
      id: "identity", version: "1", displayName: "Identity", description: "identity", unit: "ratio", scale: 1,
      numerator: { op: "measure", measure: "x" }, denominator: { op: "measure", measure: "x" },
      numeratorLabel: "x", denominatorLabel: "x", basis: "caller", requiredComponents: ["x"],
    };
    const result = runMetricDiagnostics({
      losses: [loss({ id: "own-map", group: "toString", measures: { x: 1 } })],
      metrics: [metric],
      groupMap: {},
    });
    expect(result.emergence[0]!.group).toBe("toString");
  });

  it("counts one exposure key once across valuation snapshots", () => {
    const exposures = [
      { key: "vehicle-1", group: "all", origin: "2024Q1", valuation: "2024Q1", measures: { [C.exposure]: 10 } },
      { key: "vehicle-1", group: "all", origin: "2024Q1", valuation: "2024Q2", measures: { [C.exposure]: 10 } },
    ];
    expect(run({ exposures }).emergence[0]!.components[C.exposure]).toBe(10);
    expect(reconcileDiagnosticExposureKeys(exposures)).toMatchObject({
      exposures: [expect.objectContaining({ key: "vehicle-1" })],
      findings: [expect.objectContaining({ code: "DUPLICATE_EXPOSURE_KEY", exposureKey: "vehicle-1" })],
    });
  });

  it("applies valuation filters to dated exposure copies without excluding timeless exposure", () => {
    const dated = run({
      exposures: [
        { key: "vehicle-1", group: "all", origin: "2024Q1", valuation: "2024Q1", measures: { [C.exposure]: 10 } },
        { key: "vehicle-1", group: "all", origin: "2024Q1", valuation: "2024Q3", measures: { [C.exposure]: 11 } },
      ],
      filter: { valuationThrough: "2024Q1" },
    });
    expect(dated.emergence[0]!.components[C.exposure]).toBe(10);
    expect(dated.emergence[0]!.componentWarnings).not.toContainEqual(
      expect.objectContaining({ code: "CONFLICTING_EXPOSURE" }),
    );

    const timeless = run({
      exposures: [{ key: "vehicle-1", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } }],
      filter: { valuationThrough: "2024Q1" },
    });
    expect(timeless.emergence[0]!.components[C.exposure]).toBe(10);
  });

  it("counts equal exposure amounts on distinct keys separately", () => {
    const exposures = [
      { key: "vehicle-1", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
      { key: "vehicle-2", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
    ];
    expect(run({ exposures }).emergence[0]!.components[C.exposure]).toBe(20);
  });

  it("turns conflicting or incomplete exposure into null with structured warnings", () => {
    const conflicting = run({ exposures: [
      { key: "x", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
      { key: "x", group: "all", origin: "2024Q1", measures: { [C.exposure]: 11 } },
    ] });
    expect(conflicting.emergence[0]!.metrics["reported-frequency"]!.value).toBeNull();
    expect(conflicting.emergence[0]!.componentWarnings).toContainEqual(expect.objectContaining({ code: "CONFLICTING_EXPOSURE" }));
    const incomplete = run({ exposures: [
      { key: "complete", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
      { key: "incomplete", group: "all", origin: "2024Q1", measures: { [C.exposure]: 20 }, complete: false },
    ] });
    expect(incomplete.emergence[0]!.metrics["reported-frequency"]!.value).toBeNull();
    expect(incomplete.emergence[0]!.componentWarnings).toContainEqual(expect.objectContaining({ code: "INCOMPLETE_EXPOSURE" }));
  });

  it("keeps conflicting, incomplete, and partially missing exposure components null under zero-fill", () => {
    const conflicting = run({
      sparsePolicy: "zero-fill",
      exposures: [
        { key: "x", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
        { key: "x", group: "all", origin: "2024Q1", measures: { [C.exposure]: 11 } },
      ],
    });
    expect(conflicting.emergence[0]!.components[C.exposure]).toBeNull();
    expect(conflicting.emergence[0]!.metrics["reported-frequency"]!.value).toBeNull();

    const incomplete = run({
      sparsePolicy: "zero-fill",
      exposures: [
        { key: "complete", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
        { key: "incomplete", group: "all", origin: "2024Q1", measures: { [C.exposure]: 20 }, complete: false },
      ],
    });
    expect(incomplete.emergence[0]!.components[C.exposure]).toBeNull();
    expect(incomplete.emergence[0]!.metrics["reported-frequency"]!.value).toBeNull();

    const partiallyMissing = run({
      sparsePolicy: "zero-fill",
      exposures: [
        { key: "observed", group: "all", origin: "2024Q1", measures: { [C.exposure]: 10 } },
        { key: "missing", group: "all", origin: "2024Q1", measures: { [C.exposure]: null } },
      ],
    });
    expect(partiallyMissing.emergence[0]!.components[C.exposure]).toBeNull();
    expect(partiallyMissing.emergence[0]!.componentWarnings).toContainEqual(expect.objectContaining({
      code: "MISSING_COMPONENT",
      component: C.exposure,
    }));
  });

  it("fails closed when a combined source group has no exposure row", () => {
    const losses = [
      loss({ id: "a", group: "a", measures: { ...loss().measures, [C.reported]: 10 } }),
      loss({ id: "b", group: "b", measures: { ...loss().measures, [C.reported]: 20 } }),
    ];
    const result = run({
      losses,
      exposures: [{ key: "a-exp", group: "a", origin: "2024Q1", measures: { [C.exposure]: 100 } }],
      groupMap: { a: "combined", b: "combined" },
      sparsePolicy: "zero-fill",
    });
    const point = result.emergence[0]!;
    expect(point.components[C.exposure]).toBeNull();
    expect(point.metrics["reported-frequency"]!.value).toBeNull();
    expect(point.componentWarnings).toContainEqual(expect.objectContaining({
      code: "INCOMPLETE_EXPOSURE",
      message: expect.stringContaining("source group b"),
    }));
  });

  it("filters by arbitrary group, origin, valuation, and maturity without geography assumptions", () => {
    const losses = [
      loss({ id: "a", group: "segment-a", policyPeriod: "PY2023" }),
      loss({ id: "b", group: "segment-b", policyPeriod: "PY2024" }),
      loss({ id: "c", group: "segment-a", origin: "2024Q2", valuation: "2024Q3", ageMonths: 6, policyPeriod: "PY2024" }),
    ];
    const result = runMetricDiagnostics({
      losses, metrics: [CASUALTY_QUARTERLY_METRICS[0]!],
      filter: {
        groups: ["segment-a"], originFrom: "2024Q2", originThrough: "2024Q3", valuations: ["2024Q3"],
        valuationFrom: "2024Q2", valuationThrough: "2024Q3", policyPeriods: ["PY2024"], maxAgeMonths: 6,
      },
    });
    expect(result.emergence).toHaveLength(1);
    expect(result.emergence[0]).toMatchObject({ group: "segment-a", origin: "2024Q2", valuation: "2024Q3", ageMonths: 6 });
  });

  it("combines multiple source groups by summing components before division", () => {
    const metric: MetricDefinition = {
      id: "combined", version: "1", displayName: "Combined", description: "ratio of totals", unit: "ratio", scale: 1,
      numerator: { op: "measure", measure: "n" }, denominator: { op: "measure", measure: "d" },
      numeratorLabel: "n", denominatorLabel: "d", basis: "caller", requiredComponents: ["n", "d"],
    };
    const result = runMetricDiagnostics<{ portfolio: string }>({
      losses: [
        loss({ id: "alpha", group: "alpha", measures: { n: 1, d: 1 }, dimensions: { portfolio: "A" } }),
        loss({ id: "beta", group: "beta", measures: { n: 9, d: 99 }, dimensions: { portfolio: "B" } }),
      ],
      metrics: [metric],
      groupMap: { alpha: "selected", beta: "selected" },
      groupDimensions: { selected: { portfolio: "A+B" } },
    });
    const evaluated = result.emergence[0]!.metrics.combined!;
    expect(result.emergence).toHaveLength(1);
    expect(result.emergence[0]!.dimensions).toEqual({ portfolio: "A+B" });
    expect(evaluated.rawNumerator).toBe(10);
    expect(evaluated.rawDenominator).toBe(100);
    expect(evaluated.value).toBe(0.1);
    expect((1 / 1 + 9 / 99) / 2).not.toBe(evaluated.value);
  });

  it("is invariant to row order and associative under staged aggregation", () => {
    const rows = [{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }];
    const direct = finalizeMeasureAggregate(aggregateMeasures(rows));
    const staged = finalizeMeasureAggregate(mergeMeasureAggregates([
      aggregateMeasures(rows.slice(0, 1)), aggregateMeasures(rows.slice(1)),
    ]));
    expect(staged).toEqual(direct);
    const losses = [loss({ id: "a", measures: { x: 1 } }), loss({ id: "b", measures: { x: 2 } })];
    const metric: MetricDefinition = { id: "x", version: "1", displayName: "x", description: "x", unit: "ratio", scale: 1, numerator: { op: "measure", measure: "x" }, denominator: { op: "measure", measure: "x" }, numeratorLabel: "x", denominatorLabel: "x", basis: "x", requiredComponents: ["x"] };
    expect(runMetricDiagnostics({ losses, metrics: [metric] }).emergence)
      .toEqual(runMetricDiagnostics({ losses: [...losses].reverse(), metrics: [metric] }).emergence);
  });

  it("derives triangle, emergence, same-maturity, and ragged latest diagonal from identical audit cells", () => {
    const losses = [
      loss({ id: "a", origin: "2024Q1", valuation: "2024Q1", ageMonths: 3 }),
      loss({ id: "b", origin: "2024Q1", valuation: "2024Q2", ageMonths: 6 }),
      loss({ id: "c", origin: "2024Q2", valuation: "2024Q2", ageMonths: 3 }),
    ];
    const result = run({ losses });
    const triangle = result.triangles.find((item) => item.metricId === "reported-frequency")!;
    for (const point of result.emergence) {
      const i = triangle.origins.indexOf(point.origin);
      const j = triangle.ages.indexOf(point.ageMonths);
      expect(triangle.cells[i]![j]).toEqual(point.metrics["reported-frequency"]);
    }
    expect(triangle.values[1]![1]).toBeNull();
    expect(result.latestDiagonal.map((point) => [point.origin, point.ageMonths])).toEqual([
      ["2024Q1", 6], ["2024Q2", 3],
    ]);
    const maturityPoints = sameMaturity(result, 3);
    expect(maturityPoints).toHaveLength(2);
    for (const point of maturityPoints) {
      const i = triangle.origins.indexOf(point.origin);
      const j = triangle.ages.indexOf(3);
      expect(point.metrics["reported-frequency"]).toEqual(triangle.cells[i]![j]);
    }
    expect(triangle.ages).toEqual([3, 6]);
  });

  it("finds common maturity across caller-selected groups", () => {
    const losses = [
      loss({ id: "a1", group: "alpha", ageMonths: 3 }),
      loss({ id: "a2", group: "alpha", valuation: "2024Q2", ageMonths: 6 }),
      loss({ id: "b1", group: "beta", ageMonths: 3 }),
      loss({ id: "b2", group: "beta", valuation: "2024Q2", ageMonths: 6 }),
      loss({ id: "b3", group: "beta", valuation: "2024Q3", ageMonths: 9 }),
    ];
    const common = commonMaturity(run({ losses }), ["alpha", "beta"]);
    expect(common.ageMonths).toBe(6);
    expect(new Set(common.points.map((point) => point.group))).toEqual(new Set(["alpha", "beta"]));
  });

  it("rejects duplicate origin/age cells after aggregation and never invents age zero", () => {
    const result = run({ losses: [loss()] });
    expect(result.triangles[0]!.ages).toEqual([3]);
    expect(() => run({ losses: [
      loss({ id: "a", valuation: "2024Q1", ageMonths: 3 }),
      loss({ id: "b", valuation: "2024-Q1", ageMonths: 3 }),
    ] })).toThrow(/Duplicate diagnostic cell/);
    expect(() => metricTriangleFromEmergence([
      result.emergence[0]!, { ...result.emergence[0]!, valuation: "another" },
    ], "reported-frequency")).toThrow(/Duplicate diagnostic cell/);
  });

  it("returns stable empty numeric views without requiring compliance metadata", () => {
    const result = run({ losses: [], exposures: [] });
    expect(result.emergence).toEqual([]);
    expect(result.triangles).toEqual([]);
    expect(result.latestDiagonal).toEqual([]);
    expect(result).not.toHaveProperty("provenance");
  });

  it("handles a deterministic 10,000-row aggregation without changing the formula", () => {
    const metric = CASUALTY_QUARTERLY_METRICS.find((item) => item.id === "open-share")!;
    const losses = Array.from({ length: 10_000 }, (_, index) => loss({
      id: `row-${index}`, measures: { [C.open]: 1, [C.reported]: 4 },
    }));
    const started = performance.now();
    const result = runMetricDiagnostics({ losses, metrics: [metric] });
    const elapsedMs = performance.now() - started;
    expect(result.emergence[0]!.metrics[metric.id]!.value).toBe(0.25);
    expect(result.emergence[0]!.metrics[metric.id]!.rawNumerator).toBe(10_000);
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it("satisfies generated ratio-of-sums invariants over deterministic component sets", () => {
    let state = 0x5eed1234;
    const random = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const definition: MetricDefinition = {
      id: "generated", version: "1", displayName: "Generated", description: "ratio", unit: "ratio", scale: 1,
      numerator: { op: "measure", measure: "n" }, denominator: { op: "measure", measure: "d" },
      numeratorLabel: "n", denominatorLabel: "d", basis: "generated", requiredComponents: ["n", "d"],
    };
    for (let trial = 0; trial < 50; trial++) {
      const components = Array.from({ length: 2 + Math.floor(random() * 18) }, () => ({
        n: Math.floor(random() * 1_000) - 200,
        d: 1 + Math.floor(random() * 1_000),
      }));
      const losses = components.map((measures, index) => loss({ id: `${trial}-${index}`, measures }));
      const evaluated = runMetricDiagnostics({ losses, metrics: [definition] }).emergence[0]!.metrics.generated!;
      const numerator = components.reduce((sum, row) => sum + row.n, 0);
      const denominator = components.reduce((sum, row) => sum + row.d, 0);
      expect(evaluated.rawNumerator).toBe(numerator);
      expect(evaluated.rawDenominator).toBe(denominator);
      expect(evaluated.value).toBe(numerator / denominator);
      expect(evaluated.value === null || Number.isFinite(evaluated.value)).toBe(true);
    }
  });

  it("runs the realistic quarterly fixture across groups, valuations, and repeated exposure snapshots", () => {
    const result = runMetricDiagnostics({
      losses: quarterlyCasualtyLosses,
      exposures: quarterlyCasualtyExposures,
      metrics: CASUALTY_QUARTERLY_METRICS,
    });
    expect(result.emergence).toHaveLength(5);
    expect(result.triangles).toHaveLength(40);
    const golden = result.emergence.find(
      (point) => point.group === "fleet-a" && point.origin === "2024Q4" && point.ageMonths === 3,
    )!;
    expect(golden.components.exposure).toBe(820_000);
    expect(Object.fromEntries(
      Object.entries(golden.metrics).map(([id, evaluation]) => [id, evaluation.value]),
    )).toEqual(quarterlyCasualtyExpectedFleetA2024Q4Age3);
    expect(result.latestDiagonal).toHaveLength(3);
  });
});
