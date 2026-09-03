import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  applyDiagnosticPresentation,
  diagnosticRawRatio,
} from "../src/index.js";

describe("casualty formula templates", () => {
  it("exports exactly the six basis-neutral serializable templates", () => {
    expect(CASUALTY_FORMULA_TEMPLATES.map((formula) => formula.id)).toEqual([
      "frequency",
      "share",
      "paid-to-incurred",
      "amount-per-exposure",
      "amount-per-claim",
      "case-per-open",
    ]);
    expect(CASUALTY_FORMULA_TEMPLATES.every((formula) => formula.version === "1.0.0")).toBe(true);
    expect(JSON.parse(JSON.stringify(CASUALTY_FORMULA_TEMPLATES))).toEqual(CASUALTY_FORMULA_TEMPLATES);
    expect("developmentSemantics" in CASUALTY_FORMULA_TEMPLATES[0]!.roles.claims).toBe(false);
    expect("compatibilityGroup" in CASUALTY_FORMULA_TEMPLATES[0]!.roles.claims).toBe(false);
  });

  it("applies the one positive-denominator ratio invariant", () => {
    expect(diagnosticRawRatio(10, 4)).toBe(2.5);
    expect(diagnosticRawRatio(-10, 4)).toBe(-2.5);
    expect(diagnosticRawRatio(10, 0)).toBeNull();
    expect(diagnosticRawRatio(10, -1)).toBeNull();
    expect(diagnosticRawRatio(null, 1)).toBeNull();
    expect(diagnosticRawRatio(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
  });

  it("keeps raw values separate from presentation and reports display overflow", () => {
    expect(applyDiagnosticPresentation(0.25, {
      displayName: "Frequency",
      description: "Claims per exposure",
      displayUnit: "per thousand",
      scale: 1_000,
      numeratorLabel: "claims",
      denominatorLabel: "exposure",
    })).toEqual({ value: 250, finding: null });
    expect(applyDiagnosticPresentation(Number.MAX_VALUE, {
      displayName: "Frequency",
      description: "Claims per exposure",
      displayUnit: "per thousand",
      scale: 1_000,
      numeratorLabel: "claims",
      denominatorLabel: "exposure",
    }).finding?.code).toBe("diagnostic-presentation-overflow");
  });
});
