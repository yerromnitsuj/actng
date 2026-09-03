import { describe, expectTypeOf, it } from "vitest";
import type { DiagnosticFinding, DiagnosticMetricFinding, DiagnosticsResult, MetricDiagnosticsResult } from "../src/index.js";

describe("public diagnostics result types", () => {
  it("keeps reserving and generalized findings deliberately distinct", () => {
    expectTypeOf<DiagnosticFinding>().toEqualTypeOf<{ severity: "info" | "warning" | "critical"; code: string; message: string }>();
    expectTypeOf<DiagnosticsResult["findings"]>().toEqualTypeOf<DiagnosticFinding[]>();
    expectTypeOf<DiagnosticMetricFinding["severity"]>().toEqualTypeOf<"info" | "warning" | "fail">();
    expectTypeOf<MetricDiagnosticsResult>().toHaveProperty("emergence");
  });
});
