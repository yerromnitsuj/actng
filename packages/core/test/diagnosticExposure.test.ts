import { describe, expect, it } from "vitest";
import { reconcileDiagnosticExposures } from "../src/index.js";

describe("diagnostic exposure reconciliation", () => {
  it("deduplicates equal origin-static copies without multiplying exposure", () => {
    const result = reconcileDiagnosticExposures([
      { key: "fleet", sourceGroup: "book", origin: "2024", valuation: "2024", measureId: "earned", value: 100, complete: true },
      { key: "fleet", sourceGroup: "book", origin: "2024", valuation: "2025", measureId: "earned", value: 100, complete: true },
    ], { earned: "origin-static" });
    expect(result).toEqual([{ measureId: "earned", key: "fleet", status: "valid", sourceGroup: "book", origin: "2024", value: 100, deduplicated: 1, sources: [] }]);
  });

  it("retains all applicable invalid reasons in fixed order", () => {
    const result = reconcileDiagnosticExposures([
      { key: "fleet", sourceGroup: "book", origin: "2024", valuation: "2025", measureId: "inforce", value: null, complete: false },
      { key: "fleet", sourceGroup: "other", origin: "2024", valuation: "2025", measureId: "inforce", value: Infinity, complete: true },
    ], { inforce: "valuation-specific" });
    expect(result[0]).toMatchObject({ status: "invalid", issues: ["missing", "incomplete", "non-finite", "duplicate", "conflict"] });
  });

  it("allows a valuation-specific key to change between valuations", () => {
    expect(reconcileDiagnosticExposures([
      { key: "fleet", sourceGroup: "book", origin: "2024", valuation: "2024", measureId: "inforce", value: 100, complete: true },
      { key: "fleet", sourceGroup: "book", origin: "2024", valuation: "2025", measureId: "inforce", value: 80, complete: true },
    ], { inforce: "valuation-specific" }).map((item) => item.status)).toEqual(["valid", "valid"]);
  });
});
