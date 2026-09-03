import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  assertPreparedDiagnosticData,
  commonMaturity,
  compileDiagnosticDefinition,
  getPreparedDiagnosticDataIdentity,
  prepareDiagnosticData,
  runMetricDiagnostics,
  sameMaturity,
  verifyPreparedDiagnosticDataIntegrity,
  type DiagnosticDefinition,
} from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0", id: "runner", version: "1.0.0", lossRowGrain: "aggregate",
  measures: [
    { id: "claims", displayName: "Claims", description: "Reported claims", source: "loss", kind: "count", unit: "claim", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", countPopulationId: "claims" },
    { id: "exposure", displayName: "Exposure", description: "Earned exposure", source: "exposure", kind: "exposure", unit: "vehicle-year", developmentSemantics: "unknown", aggregation: "sum", missing: "unknown", exposureBasisId: "earned", exposureTiming: "origin-static" },
  ],
  countPopulations: [{ id: "claims", displayName: "Claims", subject: "claim", unit: "claim", description: "Reported claims" }],
  exposureBases: [{ id: "earned", displayName: "Earned", basis: "earned", unit: "vehicle-year", description: "Earned vehicle-years" }],
  amountBases: [], derivedMeasures: [], formulas: [CASUALTY_FORMULA_TEMPLATES[0]],
  instances: [{ id: "reported-frequency", version: "1.0.0", formulaId: "frequency", bindings: { claims: { op: "measure", measureId: "claims" }, exposure: { op: "measure", measureId: "exposure" } }, presentation: { displayName: "Reported frequency", description: "Reported claims per thousand vehicle-years", displayUnit: "claims per thousand vehicle-years", scale: 1_000, numeratorLabel: "reported claims", denominatorLabel: "earned vehicle-years" }, rules: [] }],
  reviewRules: [],
  periodAxis: { kind: "calendar", originCadence: "year", valuationCadence: "year", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 },
};

function prepared() {
  return prepareDiagnosticData({
    definition: compileDiagnosticDefinition(definition),
    losses: [
      { rowType: "aggregate", recordId: "a", sourceGroup: "book-a", origin: "2024", valuation: "2024", complete: true, measures: { claims: 10 } },
      { rowType: "aggregate", recordId: "b", sourceGroup: "book-b", origin: "2024", valuation: "2024", complete: true, measures: { claims: 20 } },
    ],
    exposures: [
      { key: "ea", sourceGroup: "book-a", origin: "2024", measureId: "exposure", value: 100, complete: true },
      { key: "eb", sourceGroup: "book-b", origin: "2024", measureId: "exposure", value: 300, complete: true },
    ],
  });
}

describe("compiled metric diagnostics", () => {
  it("prepares once, authenticates, verifies, groups, and evaluates a ratio of sums", () => {
    const input = prepared();
    assertPreparedDiagnosticData(input);
    verifyPreparedDiagnosticDataIntegrity(input);
    expect(getPreparedDiagnosticDataIdentity(input).cells).toHaveLength(2);
    const result = runMetricDiagnostics({ prepared: input, groupMap: { "book-a": "all", "book-b": "all" }, groupDimensions: { all: { segment: "combined" } } });
    const evaluation = result.emergence[0]!.metrics["reported-frequency"]!;
    expect(evaluation.calculation).toMatchObject({ numerator: { value: 30 }, denominator: { value: 400 }, value: 0.075 });
    expect(evaluation.presentation.value).toBe(75);
    expect(result.emergence[0]!.dimensions).toEqual({ segment: "combined" });
    expect(Object.isFrozen(result.emergence)).toBe(true);
  });

  it("builds all views from the canonical emergence evaluation objects", () => {
    const result = runMetricDiagnostics({ prepared: prepared() });
    expect(result.triangles[0]!.cells[0]![0]!.evaluation).toBe(result.emergence[0]!.metrics["reported-frequency"]);
    expect(sameMaturity(result, 12)[0]).toBe(result.emergence[0]);
    expect(commonMaturity(result, ["book-a", "book-b"]).developmentAge).toBe(12);
    expect(result.latestDiagonal).toHaveLength(2);
  });

  it("rejects forged prepared data and unused grouping keys", () => {
    expect(() => assertPreparedDiagnosticData(JSON.parse(JSON.stringify(prepared())))).toThrow();
    expect(() => runMetricDiagnostics({ prepared: prepared(), groupMap: { missing: "all" } })).toThrow();
  });
});
