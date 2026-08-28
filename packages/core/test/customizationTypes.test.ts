import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CASUALTY_QUARTERLY_METRICS,
  deriveAmountLayers,
  runMetricDiagnostics,
  type AmountLayerDefinition,
  type DiagnosticLossRow,
  type MetricDefinition,
  type MetricDiagnosticsResult,
} from "../src/index.js";

interface CallerDimensions {
  jurisdiction: string;
  coverage: "liability" | "physical-damage";
  programYear: number;
}

describe("public diagnostics customization types", () => {
  it("preserves arbitrary caller group dimensions with custom components, layers, and metrics", () => {
    const rows: DiagnosticLossRow<CallerDimensions>[] = [{
      id: "row",
      group: "co-liability",
      dimensions: { jurisdiction: "CO", coverage: "liability", programYear: 2025 },
      origin: "2025Q1",
      valuation: "2025Q1",
      ageMonths: 3,
      measures: { customPaid: 60, customIncurred: 100 },
    }];
    const layer: AmountLayerDefinition = {
      id: "custom-layer",
      displayName: "Caller layer",
      paidMeasure: "derivedPaid",
      incurredMeasure: "derivedIncurred",
      paid: { op: "measure", measure: "customPaid" },
      incurred: { op: "measure", measure: "customIncurred" },
      basis: "pre-capped-additive",
    };
    const metric: MetricDefinition = {
      id: "custom-pi",
      version: "caller-v1",
      displayName: "Custom P/I",
      description: "Caller-defined paid-to-incurred",
      unit: "ratio",
      scale: 1,
      numerator: { op: "measure", measure: "derivedPaid" },
      denominator: { op: "measure", measure: "derivedIncurred" },
      numeratorLabel: "paid",
      denominatorLabel: "incurred",
      basis: "custom-layer",
      requiredComponents: ["derivedPaid", "derivedIncurred"],
    };
    const layered = deriveAmountLayers(
      rows.map((row) => ({ dimensions: row, measures: row.measures })),
      [layer],
    ).map((row) => ({ ...row.dimensions, measures: row.measures }));
    const result = runMetricDiagnostics<CallerDimensions>({ losses: layered, metrics: [metric] });

    expectTypeOf(result).toEqualTypeOf<MetricDiagnosticsResult<CallerDimensions>>();
    expectTypeOf(result.emergence[0]!.dimensions).toEqualTypeOf<CallerDimensions | undefined>();
    expect(CASUALTY_QUARTERLY_METRICS).toHaveLength(20);
    expect(result.emergence[0]!.metrics[metric.id]!.value).toBe(0.6);
  });
});
