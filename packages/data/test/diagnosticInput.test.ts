import { describe, expect, it } from "vitest";
import { CASUALTY_QUARTERLY_METRICS } from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateAndReconcileDiagnosticExposures,
  validateDiagnosticDataset,
} from "../src/index.js";

const dataset = {
  losses: [{
    id: "loss-1", group: "segment", origin: "2024Q1", valuation: "2024Q1", ageMonths: 3,
    measures: { reportedCount: 2 },
  }],
  exposures: [{ key: "exp-1", group: "segment", origin: "2024Q1", measures: { exposure: 10 } }],
};

describe("diagnostic data boundary", () => {
  it("Zod-validates diagnostic loss and exposure rows", () => {
    expect(validateDiagnosticDataset(dataset)).toEqual(dataset);
  });

  it("rejects malformed unknown data with paths and no partial interpretation", () => {
    expect(() => validateDiagnosticDataset({ losses: [{ ...dataset.losses[0], ageMonths: "three" }] }))
      .toThrow(/losses\.0\.ageMonths/);
    expect(() => validateDiagnosticDataset({ losses: [{ ...dataset.losses[0], measures: { x: "1" } }] }))
      .toThrow(/measures\.x/);
  });

  it("runs the public validated boundary through the generic engine", () => {
    const result = runValidatedMetricDiagnostics(dataset, {
      metrics: [CASUALTY_QUARTERLY_METRICS[0]!],
    });
    expect(result.emergence[0]!.metrics["reported-frequency"]!.value).toBe(200_000);
  });

  it("validates and reconciles repeated exposure keys without value-based deduplication", () => {
    const reconciled = validateAndReconcileDiagnosticExposures([
      dataset.exposures[0],
      { ...dataset.exposures[0], valuation: "2024Q2" },
      { ...dataset.exposures[0], key: "exp-2" },
    ]);
    expect(reconciled.exposures).toHaveLength(2);
    expect(reconciled.exposures.map((row) => row.key)).toEqual(["exp-1", "exp-2"]);
    expect(reconciled.findings).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_EXPOSURE_KEY",
      exposureKey: "exp-1",
    }));
  });
});
