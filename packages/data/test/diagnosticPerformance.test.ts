import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  canonicalJson,
  fnv1a64,
  type DiagnosticDefinition,
  type DiagnosticExpectedCell,
  type DiagnosticExposureObservation,
  type DiagnosticLossInput,
} from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "performance-contract",
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
    ...(["static", "valuation"] as const).map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "exposure" as const,
      kind: "exposure" as const,
      unit: "vehicle-year",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      exposureBasisId: "vehicles",
      exposureTiming:
        id === "static"
          ? ("origin-static" as const)
          : ("valuation-specific" as const),
    })),
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
      unit: "vehicle-year",
      description: "Vehicle years",
      basis: "earned",
    },
  ],
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
  reviewRules: [
    {
      kind: "monotonic",
      id: "claims-monotonic",
      code: "claims-decreased",
      description: "Claims do not decrease",
      severity: "warning",
      missingInput: "not-evaluated",
      expression: { op: "measure", measureId: "claims" },
      direction: "nondecreasing",
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

function fixture(originCount = 2) {
  const losses: DiagnosticLossInput[] = [];
  const exposures: DiagnosticExposureObservation[] = [];
  const expectedCells: DiagnosticExpectedCell[] = [];
  for (const sourceGroup of ["A|B", "A", "__proto__", "constructor"]) {
    for (let originIndex = 0; originIndex < originCount; originIndex++) {
      const origin = String(2000 + originIndex);
      exposures.push({
        key: JSON.stringify([sourceGroup, origin, "static"]),
        sourceGroup,
        origin,
        measureId: "static",
        value: 100 + originIndex,
        complete: true,
        source: { artifactId: "exposure", sourceRow: exposures.length + 2 },
      });
      for (let ageIndex = 0; ageIndex < 3; ageIndex++) {
        const valuation = String(2000 + originIndex + ageIndex);
        expectedCells.push({
          sourceGroup,
          origin,
          valuation,
          source: {
            artifactId: "expected",
            sourceRow: expectedCells.length + 2,
          },
        });
        losses.push({
          rowType: "aggregate",
          recordId: JSON.stringify([sourceGroup, origin, valuation]),
          sourceGroup,
          origin,
          valuation,
          complete: true,
          measures: { claims: 10 + ageIndex },
          source: { artifactId: "loss", sourceRow: losses.length + 2 },
        });
        exposures.push({
          key: JSON.stringify([sourceGroup, origin, "valuation"]),
          sourceGroup,
          origin,
          valuation,
          measureId: "valuation",
          value: 80 + ageIndex,
          complete: true,
          source: { artifactId: "exposure", sourceRow: exposures.length + 2 },
        });
      }
    }
  }
  return {
    definition: structuredClone(definition),
    losses,
    exposures,
    expectedCells,
    groupMap: Object.fromEntries(
      ["A|B", "A", "__proto__", "constructor"].map((state) => [state, "all"]),
    ),
    reviewEvidence: { groupingAssignments: [], cachedFormulas: [] },
  };
}

function expectDeeplyFrozen(value: unknown, seen = new WeakSet<object>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("diagnostic performance repairs preserve the public contract", () => {
  it("pins pre-repair identities, ordered reviews, source evidence and numeric results", () => {
    const input = fixture();
    const outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput(input),
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed")
      throw new Error("Expected completed fixture");
    // Captured from unmodified 0.6.1 before replacing the lookup algorithms.
    expect(outcome.prepared.preparationFingerprint).toBe(
      "fnv1a64-jcs-v1:91c9b7819e4cd16a",
    );
    expect(outcome.review.reportFingerprint).toBe(
      "fnv1a64-jcs-v1:42458cd02eefc8d6",
    );
    expect(fnv1a64(canonicalJson(outcome.result))).toBe("2eacb89187cefc45");
    expect(fnv1a64(canonicalJson(outcome.review.evaluations))).toBe(
      "258cd1137df7606c",
    );
    expect(
      outcome.result.emergence.every(
        (point) => point.metrics.identity?.calculation.value === 1,
      ),
    ).toBe(true);
    const reversed = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        ...input,
        losses: [...input.losses].reverse(),
        exposures: [...input.exposures].reverse(),
        expectedCells: [...input.expectedCells].reverse(),
      }),
    );
    expect(reversed.status).toBe("completed");
    expect(reversed.prepared.preparationFingerprint).toBe(
      outcome.prepared.preparationFingerprint,
    );
    expect(reversed.review).toEqual(outcome.review);
  });

  it("reuses only the authentic immutable preparation and repeats every gate", () => {
    const input = fixture();
    // A caller's shallow freeze must not be confused with an SDK-owned graph.
    Object.freeze(input.losses[0]);
    const validated = validateDiagnosticRunInput(input);
    expect(Reflect.set(input.losses[0]!.measures, "claims", 999)).toBe(true);
    expect(Reflect.set(input.exposures[0]!, "value", 999)).toBe(true);
    input.groupMap.A = "changed";
    const first = runValidatedMetricDiagnostics(validated);
    const second = runValidatedMetricDiagnostics(validated);
    expect(first.prepared).toBe(second.prepared);
    expect(first).toEqual(second);
    expectDeeplyFrozen(first);
    expect(Object.isFrozen(first.prepared)).toBe(true);
    expect(Object.isFrozen(first.prepared.cells[0])).toBe(true);
    expect(() => runValidatedMetricDiagnostics({ ...validated })).toThrow(
      /authentic/,
    );
    expect(() =>
      runValidatedMetricDiagnostics(JSON.parse(JSON.stringify(validated))),
    ).toThrow(/authentic/);
    const different = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput(fixture()),
    );
    expect(different.prepared).not.toBe(first.prepared);
    expect(different.prepared.preparationFingerprint).toBe(
      first.prepared.preparationFingerprint,
    );
  });

  it("keeps missing expected adjacencies blocked and strict policy scoped to its input", () => {
    const input = fixture();
    input.losses.splice(1, 1);
    const missing = validateDiagnosticRunInput(input);
    const first = runValidatedMetricDiagnostics(missing);
    const second = runValidatedMetricDiagnostics(missing);
    expect(first.status).toBe("blocked");
    expectDeeplyFrozen(first);
    expect(
      first.review.evaluations.filter(
        (evaluation) => evaluation.status === "not-evaluated",
      ),
    ).toHaveLength(2);
    expect(first).toEqual(second);
    const strict = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        ...fixture(),
        reviewEvidence: null,
        policy: { allowedReviewStatuses: ["pass"] },
      }),
    );
    expect(strict.status).toBe("blocked");
    expect(
      runValidatedMetricDiagnostics(validateDiagnosticRunInput(fixture()))
        .status,
    ).toBe("completed");
  });

  it("retains all joins and review evaluations for a larger monotonic dataset", () => {
    const input = fixture(200);
    const result = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput(input),
    );
    expect(result.status).toBe("completed");
    expect(result.prepared.cells).toHaveLength(2_400);
    expect(result.review.evaluations).toHaveLength(1_600);
    expect(result.prepared.findings).toEqual([]);
    expect(
      result.review.evaluations.every((item) => item.status === "pass"),
    ).toBe(true);
    if (result.status !== "completed")
      throw new Error("Expected completed run");
    expect(result.result.emergence).toHaveLength(600);
    for (const cell of result.prepared.cells) {
      expect(cell.components.static?.value).toBe(
        100 + Number(cell.origin) - 2000,
      );
      expect(cell.components.valuation?.value).toBe(
        80 + Number(cell.valuation) - Number(cell.origin),
      );
    }
  });
});
