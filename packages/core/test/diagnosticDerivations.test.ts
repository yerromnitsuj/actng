import { describe, expect, it } from "vitest";
import {
  compileDiagnosticDefinition,
  deriveDiagnosticClaimMeasures,
  DiagnosticValidationError,
  type DiagnosticDefinition,
} from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "claim-layers",
  version: "1.0.0",
  lossRowGrain: "claim",
  measures: [
    { id: "gross", displayName: "Gross", description: "Ground-up loss", source: "loss", kind: "amount", unit: "USD", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", basisId: "gross" },
    { id: "primary", displayName: "Primary", description: "Primary layer loss", source: "derived", kind: "amount", unit: "USD", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", basisId: "primary" },
  ],
  countPopulations: [],
  exposureBases: [],
  amountBases: [
    { id: "gross", displayName: "Gross", currency: "USD", perspective: "gross", components: [{ id: "loss", treatment: "included", limitation: { kind: "unlimited" } }] },
    { id: "primary", displayName: "Primary", currency: "USD", perspective: "gross", components: [{ id: "loss", treatment: "included", limitation: { kind: "layer", attachment: 0, limit: 250_000, application: "claim", derivation: { kind: "sdk" } } }] },
  ],
  derivedMeasures: [{ id: "derive-primary", outputMeasureId: "primary", expression: { op: "claim-layer", measureId: "gross", attachment: 0, limit: 250_000 } }],
  formulas: [],
  instances: [],
  reviewRules: [],
  periodAxis: { kind: "calendar", originCadence: "year", valuationCadence: "year", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 },
};

describe("deriveDiagnosticClaimMeasures", () => {
  it("applies a layer claim by claim and preserves caller rows", () => {
    const compiled = compileDiagnosticDefinition(definition);
    const input = [
      { recordId: "a", measures: { gross: 400_000 } },
      { recordId: "b", measures: { gross: 400_000 } },
    ];
    const result = deriveDiagnosticClaimMeasures(input, compiled);
    expect(result.map((row) => row.measures.primary)).toEqual([250_000, 250_000]);
    expect(result.reduce((sum, row) => sum + row.measures.primary!, 0)).toBe(500_000);
    expect(Math.min(input.reduce((sum, row) => sum + row.measures.gross, 0), 250_000)).toBe(250_000);
    expect(input[0]!.measures).toEqual({ gross: 400_000 });
  });

  it("propagates missing and non-finite inputs to null", () => {
    const compiled = compileDiagnosticDefinition(definition);
    expect(deriveDiagnosticClaimMeasures([
      { measures: { gross: null } },
      { measures: { gross: Number.NaN } },
    ], compiled).map((row) => row.measures.primary)).toEqual([null, null]);
  });

  it("rejects the whole batch before producing output", () => {
    const compiled = compileDiagnosticDefinition(definition);
    expect(() => deriveDiagnosticClaimMeasures([
      { measures: { gross: 1 } },
      { measures: { primary: 1 } },
    ], compiled)).toThrow(DiagnosticValidationError);
  });
});
