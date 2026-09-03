import { describe, expect, it } from "vitest";
import { compileDiagnosticDefinition, diagnosticDevelopmentAge, normalizeDiagnosticPeriod, type DiagnosticDefinition } from "../src/index.js";

function compiled(axis: DiagnosticDefinition["periodAxis"]) {
  return compileDiagnosticDefinition({
    diagnosticDefinitionVersion: "1.0.0",
    id: "period-test",
    version: "1.0.0",
    lossRowGrain: "aggregate",
    measures: [], countPopulations: [], exposureBases: [], amountBases: [], derivedMeasures: [], formulas: [], instances: [], reviewRules: [], periodAxis: axis,
  });
}

describe("diagnostic period axes", () => {
  it("normalizes strict quarterly spellings and derives month age", () => {
    const definition = compiled({ kind: "calendar", originCadence: "quarter", valuationCadence: "quarter", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 });
    expect(normalizeDiagnosticPeriod(definition, "origin", "Q4 2024")).toEqual({ label: "2024Q4", coordinate: 24_297 });
    expect(diagnosticDevelopmentAge(definition, "2024-Q4", "2025Q1").developmentAge).toBe(6);
    expect(() => normalizeDiagnosticPeriod(definition, "origin", " 2024Q4")).toThrow();
    expect(() => normalizeDiagnosticPeriod(definition, "origin", "2024q4")).toThrow();
  });

  it("supports independent annual/monthly cadences and anchors", () => {
    const definition = compiled({ kind: "calendar", originCadence: "year", valuationCadence: "month", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 });
    expect(diagnosticDevelopmentAge(definition, "2024", "2024-01").developmentAge).toBe(1);
    expect(diagnosticDevelopmentAge(definition, "2024", "2024-12").developmentAge).toBe(12);
  });

  it("uses ordered aliases and numeric coordinates without lexical fallback", () => {
    const definition = compiled({
      kind: "ordered", id: "fiscal", version: "1", ageUnit: "fiscal-quarter", ageOffset: 1,
      origins: [{ label: "Q3 FY25", aliases: ["origin-a"], coordinate: 8 }],
      valuations: [{ label: "Q2 FY25", coordinate: 10 }, { label: "Q3 FY25", aliases: ["valuation-a"], coordinate: 11 }],
    });
    expect(diagnosticDevelopmentAge(definition, "origin-a", "valuation-a")).toMatchObject({ developmentAge: 4, ageUnit: "fiscal-quarter" });
    expect(() => normalizeDiagnosticPeriod(definition, "origin", "Q2 FY25")).toThrow();
  });
});
