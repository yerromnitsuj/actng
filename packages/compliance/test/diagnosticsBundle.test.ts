import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  prepareDiagnosticData,
  runMetricDiagnostics,
  triangleFromGrid,
  type DiagnosticDefinition,
  type MetricDefinition,
} from "@actuarial-ts/core";
import { parseDocument, triangleToDoc } from "@actuarial-ts/interchange";
import {
  createBundle,
  createDiagnosticsProvenance,
  createLedger,
  recordAssumption,
  verifyBundle,
} from "../src/index.js";

describe("diagnostics provenance composition", () => {
  it("embeds the complete run inventory in an existing compliance bundle and records judgment in the ledger", () => {
    const definition: DiagnosticDefinition = {
      diagnosticDefinitionVersion: "1.0.0", id: "fleet", version: "2", lossRowGrain: "aggregate",
      measures: [
        { id: "reported", displayName: "Reported", description: "Reported claims", source: "loss", kind: "count", unit: "claim", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", countPopulationId: "claims" },
        { id: "exposure", displayName: "Exposure", description: "Vehicle years", source: "exposure", kind: "exposure", unit: "vehicle-year", developmentSemantics: "unknown", aggregation: "sum", missing: "unknown", exposureBasisId: "vehicle-years", exposureTiming: "origin-static" },
      ],
      countPopulations: [{ id: "claims", displayName: "Claims", subject: "claim", unit: "claim", description: "Claims" }],
      exposureBases: [{ id: "vehicle-years", displayName: "Vehicle years", basis: "earned", unit: "vehicle-year", description: "Earned vehicle years" }], amountBases: [], derivedMeasures: [], formulas: [CASUALTY_FORMULA_TEMPLATES[0]],
      instances: [{ id: "reported-frequency", version: "1", formulaId: "frequency", bindings: { claims: { op: "measure", measureId: "reported" }, exposure: { op: "measure", measureId: "exposure" } }, presentation: { displayName: "Reported frequency", description: "Reported frequency", displayUnit: "count per million", scale: 1_000_000, numeratorLabel: "reported", denominatorLabel: "exposure" }, rules: [] }], reviewRules: [],
      periodAxis: { kind: "calendar", originCadence: "quarter", valuationCadence: "quarter", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 },
    };
    const compiled = compileDiagnosticDefinition(definition);
    const prepared = prepareDiagnosticData({ definition: compiled, losses: [{ rowType: "aggregate", recordId: "snapshot", sourceGroup: "fleet", origin: "2025Q1", valuation: "2025Q1", complete: true, measures: { reported: 4 } }], exposures: [{ key: "fleet-exp", sourceGroup: "fleet", origin: "2025Q1", measureId: "exposure", value: 20, complete: true }] });
    const result = runMetricDiagnostics({ prepared });
    const legacyMetric: MetricDefinition = { id: "reported-frequency", version: "casualty-quarterly-v1", displayName: "Reported frequency", description: "Reported frequency", unit: "count-per-million", scale: 1_000_000, numerator: { op: "measure", measure: "reported" }, denominator: { op: "measure", measure: "exposure" }, numeratorLabel: "reported", denominatorLabel: "exposure", basis: "count", requiredComponents: ["reported", "exposure"] };
    const provenance = createDiagnosticsProvenance({
      packageVersions: { "@actuarial-ts/core": "0.5.0", "@actuarial-ts/compliance": "0.5.0" },
      formulaPack: { id: "fleet-quarterly", version: "2" },
      metrics: [legacyMetric],
      layers: [],
      exposure: { basis: "vehicle-years", frequencyScale: 1_000_000 },
      sparsePolicy: "preserve-null",
      ageConvention: "quarter-end-first-observation",
      completePeriodCutoffs: { originThrough: "2025Q1", valuationThrough: "2025Q1" },
      appliedFilters: { policyPeriod: "PY2024" },
      groupingSelections: { dimensions: ["fleet"] },
      inputReferences: [{ id: "loss-run", hash: "abc123" }, { id: "exposure", hash: "def456" }],
    });
    const bundle = createBundle({
      inputs: { ids: provenance.inputReferences },
      parameters: { diagnostics: provenance },
      results: result.emergence,
      sdkVersions: { "@actuarial-ts/core": "0.5.0", "@actuarial-ts/compliance": "0.5.0" },
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    expect(verifyBundle(bundle, result.emergence)).toEqual({ reproduced: true });
    expect(JSON.parse(bundle.payload).parameters.diagnostics).toEqual(provenance);
    expect(provenance.metrics[0]).toMatchObject({
      id: "reported-frequency",
      definitionVersion: "casualty-quarterly-v1",
      scale: 1_000_000,
    });

    const triangleDoc = triangleToDoc(
      triangleFromGrid("paid", ["2025Q1"], [3], [[10]]),
      { createdAt: "2026-08-27T00:00:00.000Z", valuationDate: "2025-03-31" },
    );
    const withExtension = {
      ...triangleDoc,
      extensions: { "actuarial-ts:diagnostics": provenance },
    };
    const parsed = parseDocument(withExtension);
    expect(parsed.doc.extensions?.["actuarial-ts:diagnostics"]).toEqual(provenance);
    expect(parsed.doc.integrity).toBe(triangleDoc.integrity);

    const ledger = recordAssumption(createLedger(), {
      timestamp: "2026-08-27T00:00:00.000Z",
      actor: "actuary",
      field: "diagnostics.amountBasis",
      value: "primary-1m-indemnity-plus-expense",
      source: "quarterly diagnostics configuration",
      rationale: "Selected to retain unlimited expense while stabilizing large indemnity claims.",
    });
    expect(ledger.entries[0]).toMatchObject({ field: "diagnostics.amountBasis", actor: "actuary" });
  });
});
