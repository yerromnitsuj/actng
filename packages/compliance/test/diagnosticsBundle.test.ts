import { describe, expect, it } from "vitest";
import {
  CASUALTY_AMOUNT_LAYERS,
  CASUALTY_DIAGNOSTIC_COMPONENTS as C,
  CASUALTY_QUARTERLY_METRICS,
  runMetricDiagnostics,
  triangleFromGrid,
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
    const result = runMetricDiagnostics({
      losses: [{
        id: "snapshot", group: "fleet", origin: "2025Q1", valuation: "2025Q1", ageMonths: 3,
        measures: { [C.reported]: 4 },
      }],
      exposures: [{ key: "fleet-exp", group: "fleet", origin: "2025Q1", measures: { [C.exposure]: 20 } }],
      metrics: [CASUALTY_QUARTERLY_METRICS[0]!],
    });
    const provenance = createDiagnosticsProvenance({
      packageVersions: { "@actuarial-ts/core": "0.4.0", "@actuarial-ts/compliance": "0.4.0" },
      formulaPack: { id: "fleet-quarterly", version: "2" },
      metrics: [CASUALTY_QUARTERLY_METRICS[0]!],
      layers: CASUALTY_AMOUNT_LAYERS,
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
      sdkVersions: { "@actuarial-ts/core": "0.4.0", "@actuarial-ts/compliance": "0.4.0" },
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
