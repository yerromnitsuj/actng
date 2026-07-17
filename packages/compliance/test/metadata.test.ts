import { describe, expect, it } from "vitest";
import type { EstimateMetadata } from "../src/metadata.js";
import { validateMetadata } from "../src/metadata.js";

function meta(overrides: Partial<EstimateMetadata> = {}): EstimateMetadata {
  return {
    intendedPurpose: "Unpaid claim estimate supporting the 2025 annual statement",
    intendedMeasure: { kind: "central-estimate" },
    basis: { grossNet: "net-of-reinsurance", laeTreatment: "including-all-lae" },
    accountingDate: "2025-12-31",
    valuationDate: "2025-12-31",
    ...overrides,
  };
}

describe("validateMetadata", () => {
  it("returns no problems for minimal valid metadata", () => {
    expect(validateMetadata(meta())).toEqual([]);
  });

  it("returns no problems with all optional fields populated", () => {
    const m = meta({
      intendedUsers: ["Chief Actuary", "Board audit committee"],
      reviewDate: "2026-02-15",
      scopeNotes: "Commercial auto liability, all states",
      currency: "USD",
    });
    expect(validateMetadata(m)).toEqual([]);
  });

  describe("required-field detection", () => {
    it("detects every missing required field on an empty object built up from scratch", () => {
      // Metadata is built up field-by-field in practice; an in-progress object
      // is cast to the finished type and validated for what is still missing.
      const problems = validateMetadata({} as EstimateMetadata);
      for (const field of [
        "intendedPurpose",
        "intendedMeasure",
        "basis",
        "accountingDate",
        "valuationDate",
      ]) {
        expect(problems.some((p) => p.includes(field)), `expected a problem naming ${field}`).toBe(true);
      }
    });

    it("rejects a blank intendedPurpose", () => {
      const problems = validateMetadata(meta({ intendedPurpose: "   " }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("intendedPurpose");
    });

    it("does not require the optional fields", () => {
      const m = meta();
      delete (m as Partial<EstimateMetadata>).intendedUsers;
      delete (m as Partial<EstimateMetadata>).reviewDate;
      delete (m as Partial<EstimateMetadata>).scopeNotes;
      delete (m as Partial<EstimateMetadata>).currency;
      expect(validateMetadata(m)).toEqual([]);
    });
  });

  describe("dates", () => {
    it.each(["12/31/2025", "2025-13-01", "2025-02-30", "2025-1-1", "2025-00-10"])(
      "rejects malformed or impossible accountingDate %s",
      (bad) => {
        const problems = validateMetadata(meta({ accountingDate: bad }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("accountingDate");
      },
    );

    it("accepts Feb 29 in a leap year and rejects it otherwise", () => {
      expect(validateMetadata(meta({ valuationDate: "2024-02-29" }))).toEqual([]);
      const problems = validateMetadata(meta({ valuationDate: "2025-02-29" }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("valuationDate");
    });

    it("validates reviewDate only when provided", () => {
      expect(validateMetadata(meta({ reviewDate: "2026-02-15" }))).toEqual([]);
      const problems = validateMetadata(meta({ reviewDate: "soon" }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("reviewDate");
    });
  });

  describe("percentile coherence", () => {
    it("requires percentile for specified-percentile", () => {
      const problems = validateMetadata(meta({ intendedMeasure: { kind: "specified-percentile" } }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("percentile");
    });

    it("accepts a fractional percentile in (0, 1)", () => {
      const m = meta({ intendedMeasure: { kind: "specified-percentile", percentile: 0.75 } });
      expect(validateMetadata(m)).toEqual([]);
    });

    it.each([0, 1, -0.2, 1.5, Number.NaN])("rejects out-of-range percentile %s", (p) => {
      const m = meta({ intendedMeasure: { kind: "specified-percentile", percentile: p } });
      const problems = validateMetadata(m);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("percentile");
    });

    it("rejects a percentile supplied with a non-percentile kind", () => {
      const m = meta({ intendedMeasure: { kind: "central-estimate", percentile: 0.75 } });
      const problems = validateMetadata(m);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("percentile");
    });
  });

  describe("enum membership at runtime", () => {
    it("rejects an unknown intendedMeasure.kind", () => {
      const m = meta({ intendedMeasure: { kind: "best-guess" as never } });
      const problems = validateMetadata(m);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("intendedMeasure.kind");
    });

    it("rejects unknown basis values", () => {
      const m = meta({
        basis: { grossNet: "netted" as never, laeTreatment: "some-lae" as never },
      });
      const problems = validateMetadata(m);
      expect(problems).toHaveLength(2);
      expect(problems.some((p) => p.includes("basis.grossNet"))).toBe(true);
      expect(problems.some((p) => p.includes("basis.laeTreatment"))).toBe(true);
    });
  });

  describe("optional-field shape", () => {
    it("rejects blank intendedUsers entries with their index", () => {
      const problems = validateMetadata(meta({ intendedUsers: ["Chief Actuary", " "] }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("intendedUsers[1]");
    });

    it("rejects a blank currency", () => {
      const problems = validateMetadata(meta({ currency: "" }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("currency");
    });
  });
});
