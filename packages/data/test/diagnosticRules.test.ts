import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  type DiagnosticDefinition,
  type DiagnosticLossInput,
} from "@actuarial-ts/core";
import {
  createCasualtyDiagnosticReviewRules,
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "../src/index.js";

const measure = (measureId: string) => ({ op: "measure" as const, measureId });
const counts = {
  reported: "reported",
  open: "open",
  closedNoPay: "cnp",
  closedWithPay: "cwp",
};
const rules = createCasualtyDiagnosticReviewRules({
  counts,
  exposure: "exposure",
  monotonicMeasures: ["paid", "incurred"].map((id) => ({
    id: `${id}-monotonic`,
    expression: measure(id),
    direction: "nondecreasing",
  })),
  layerOrders: ["paid", "incurred"].map((id) => ({
    id: `${id}-layer`,
    narrower: measure(`net-${id}`),
    broader: measure(id),
    comparability: {
      kind: "caller-asserted",
      rationaleArtifactId: "layer-rationale",
    },
  })),
  controlTotals: ["paid", "incurred"].map((id) => ({
    id: `${id}-control`,
    expression: measure(id),
    expected: id === "paid" ? 120 : 220,
    projection: { kind: "latest-valuation-per-origin" },
  })),
});
const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "factory-reconciliation",
  version: "1",
  lossRowGrain: "aggregate",
  measures: [
    ...Object.values(counts).map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss" as const,
      kind: "count" as const,
      unit: "claim",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      countPopulationId: "claims",
    })),
    ...["paid", "incurred", "net-paid", "net-incurred"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss" as const,
      kind: "amount" as const,
      unit: "USD",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      basisId: "loss",
    })),
    {
      id: "exposure",
      displayName: "Exposure",
      description: "Exposure",
      source: "exposure",
      kind: "exposure",
      unit: "vehicle-year",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "vehicles",
      exposureTiming: "origin-static",
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
  exposureBases: [
    {
      id: "vehicles",
      displayName: "Vehicles",
      basis: "earned",
      unit: "vehicle-year",
      description: "Vehicles",
    },
  ],
  amountBases: [
    {
      id: "loss",
      displayName: "Loss",
      currency: "USD",
      perspective: "gross",
      components: [
        {
          id: "loss",
          treatment: "included",
          limitation: { kind: "unlimited" },
        },
      ],
    },
  ],
  derivedMeasures: [],
  formulas: CASUALTY_FORMULA_TEMPLATES,
  instances: [],
  reviewRules: rules,
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
function rows() {
  return ["2023", "2024"].map((valuation, index) => ({
    rowType: "aggregate" as const,
    recordId: `row-${index}`,
    sourceGroup: "a",
    origin: "2023",
    valuation,
    complete: true,
    source: { artifactId: "loss", sourceRow: index + 2 },
    measures: {
      reported: 10,
      open: 4,
      cnp: 2,
      cwp: 4,
      paid: 100 + index * 20,
      incurred: 200 + index * 20,
      "net-paid": 80 + index * 20,
      "net-incurred": 180 + index * 20,
    } as Record<string, number>,
  }));
}
const exposure = {
  key: "vehicles-2023",
  sourceGroup: "a",
  origin: "2023",
  measureId: "exposure",
  value: 100,
  complete: true,
};
const faults = [
  ["casualty/review/count-reconciliation", "reported", 11],
  ["casualty/review/closed-no-pay-bound", "cnp", 11],
  ["casualty/review/positive-exposure", "exposure", 0],
  ["casualty/review/closed-reopen-signal", "cwp", 0],
  ["paid-monotonic", "paid", 99],
  ["incurred-monotonic", "incurred", 199],
  ["paid-layer", "net-paid", 121],
  ["incurred-layer", "net-incurred", 221],
  ["paid-control", "paid", 121],
  ["incurred-control", "incurred", 221],
] as const;
function run(
  id: string,
  losses: DiagnosticLossInput[] = rows(),
  exposures = [exposure],
  fail = false,
) {
  return runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
      definition: {
        ...definition,
        lossRowGrain: losses[0]?.rowType ?? "aggregate",
        reviewRules: rules
          .filter((rule) => rule.id === id)
          .map((rule) => (fail ? { ...rule, severity: "fail" } : rule)),
      },
      losses,
      exposures,
    }),
  );
}
describe("casualty diagnostic review rule factory", () => {
  it("emits every fixed and configured rule exactly once with zero tolerances", () => {
    expect(rules.map((rule) => rule.id)).toEqual(faults.map(([id]) => id));
    expect(
      rules.every(
        (rule) =>
          rule.tolerance?.absolute === 0 && rule.tolerance.relative === 0,
      ),
    ).toBe(true);
  });
  it.each(faults)(
    "%s passes reconciled data and a controlled error triggers the exact rule",
    (id, field, value) => {
      const clean = run(id);
      expect(clean.status).toBe("completed");
      expect(
        clean.review.evaluations
          .filter((item) => item.ruleId === id)
          .every((item) => item.status === "pass"),
      ).toBe(true);
      const losses = rows();
      const exposures = [{ ...exposure }];
      if (field === "exposure") exposures[0]!.value = value;
      else losses[1]!.measures[field] = value;
      const result = run(id, losses, exposures, true);
      expect(result.status).toBe("blocked");
      expect(result.gate.reviewGate).toBe("blocked");
      const triggered = result.review.evaluations.filter(
        (item) => item.status === "triggered",
      );
      expect([...new Set(triggered.map((item) => item.ruleId))]).toEqual([id]);
      expect(triggered.every((item) => item.severity === "fail")).toBe(true);
      expect(
        triggered.every(
          (item) =>
            item.scope.kind === "control-total" ||
            (item.scope.kind === "cell" ? item.scope.cell : item.scope.current)
              .sourceGroup === "a",
        ),
      ).toBe(true);
    },
  );
  it.each(faults)("%s leaves missing operands not-evaluated", (id, field) => {
    const losses = rows();
    for (const row of losses) delete row.measures[field];
    const result = run(id, losses, field === "exposure" ? [] : [exposure]);
    const evaluations = result.review.evaluations.filter(
      (item) => item.ruleId === id,
    );
    expect(evaluations.length).toBeGreaterThan(0);
    expect(evaluations.every((item) => item.status === "not-evaluated")).toBe(
      true,
    );
    expect(
      evaluations.every((item) => item.left === null || item.right === null),
    ).toBe(true);
  });
  it.each(faults)(
    "%s cannot turn aggregation overflow into a passing number",
    (id) => {
      const losses = ["a", "b"].flatMap((claimId) =>
        rows().map((row) => ({
          ...row,
          rowType: "claim" as const,
          recordId: `${claimId}-${row.recordId}`,
          claimId,
          measures: Object.fromEntries(
            Object.keys(row.measures).map((key) => [key, Number.MAX_VALUE]),
          ),
        })),
      );
      const result = run(
        id,
        losses,
        ["a", "b"].map((key) => ({
          ...exposure,
          key,
          value: Number.MAX_VALUE,
        })),
      );
      expect(result.status).toBe("blocked");
      const evaluations = result.review.evaluations.filter(
        (item) => item.ruleId === id,
      );
      expect(evaluations.length).toBeGreaterThan(0);
      expect(
        evaluations.every((item) =>
          item.notEvaluatedReasons.includes("aggregation-overflow"),
        ),
      ).toBe(true);
      expect(evaluations.every((item) => item.status === "not-evaluated")).toBe(
        true,
      );
      expect(
        evaluations.every((item) => item.left === null || item.right === null),
      ).toBe(true);
    },
  );
  it("keeps default monotonic warnings reviewable; an explicit fail severity blocks", () => {
    const losses = rows();
    losses[1]!.measures.paid = 99;
    expect(run("paid-monotonic", losses).status).toBe("completed");
    expect(run("paid-monotonic", losses, [exposure], true).status).toBe(
      "blocked",
    );
  });
});
