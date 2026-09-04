import { describe, expect, it } from "vitest";

describe("legacy diagnostic matcher contract", () => {
  it("uses identifier boundaries", () => {
    const pattern = /(^|[^A-Za-z0-9_$])MetricEvaluation(?=$|[^A-Za-z0-9_$])/g;
    expect(pattern.test("MetricEvaluation")).toBe(true);
    pattern.lastIndex = 0;
    expect(pattern.test("DiagnosticMetricEvaluation")).toBe(false);
  });

  it("requires exact quoted tokens", () => {
    const pattern = /(^|[\s`"'])reported-frequency(?=$|[\s`"'.,:;!?()[\]{}])/g;
    expect(pattern.test('"reported-frequency"')).toBe(true);
    pattern.lastIndex = 0;
    expect(pattern.test('"casualty/count/reported-frequency"')).toBe(false);
  });
});
