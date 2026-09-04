import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CORE_PACKAGE_VERSION,
  MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES,
  MAX_DIAGNOSTIC_EXPRESSION_DEPTH,
  MAX_DIAGNOSTIC_EXPRESSION_NODES,
  assertCompiledDiagnosticDefinition,
  compileDiagnosticDefinition,
  type AmountBasisDefinition,
  type CompiledDiagnosticDefinition,
  type DiagnosticComparisonRule,
  type DiagnosticCountPopulationDefinition,
  type DiagnosticDefinition,
  type DiagnosticDerivedMeasureDefinition,
  type DiagnosticExposureBasisDefinition,
  type DiagnosticFormulaTemplate,
  type DiagnosticMeasureDefinition,
  type DiagnosticMeasureStats,
  type DiagnosticMetricInstance,
  type DiagnosticPeriodAxis,
  type DiagnosticReviewRule,
  type DiagnosticReviewRuleEvaluationBase,
  type DiagnosticLossInputAuditSnapshot,
  type DiagnosticExposureInputAuditSnapshot,
  type DiagnosticExpectedCellAuditSnapshot,
  type DiagnosticValidationError,
  type DiagnosticValidationIssue,
  type NormalizedDiagnosticCalculationScope,
  type NormalizedDiagnosticDefinitionIdentity,
  type NormalizedDiagnosticFormulaIdentity,
} from "../src/index.js";

describe("generalized diagnostics public API", () => {
  it("exports the Task 2 runtime contract and pinned resource limits", () => {
    expect(typeof compileDiagnosticDefinition).toBe("function");
    expect(typeof assertCompiledDiagnosticDefinition).toBe("function");
    expect(MAX_DIAGNOSTIC_EXPRESSION_DEPTH).toBe(64);
    expect(MAX_DIAGNOSTIC_EXPRESSION_NODES).toBe(10_000);
    expect(MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES).toBe(100_000);
  });

  it("keeps CORE_PACKAGE_VERSION synchronized with the package manifest", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      readFileSync(join(here, "../package.json"), "utf8"),
    ) as {
      version: string;
    };
    expect(CORE_PACKAGE_VERSION).toBe(manifest.version);
  });

  it("exposes authored, compiled, normalized, validation, and result-stat types", () => {
    expectTypeOf<DiagnosticMeasureDefinition>().toHaveProperty(
      "developmentSemantics",
    );
    expectTypeOf<DiagnosticCountPopulationDefinition>().toHaveProperty(
      "subject",
    );
    expectTypeOf<DiagnosticExposureBasisDefinition>().toHaveProperty("basis");
    expectTypeOf<AmountBasisDefinition>().toHaveProperty("components");
    expectTypeOf<DiagnosticDerivedMeasureDefinition>().toHaveProperty(
      "expression",
    );
    expectTypeOf<DiagnosticFormulaTemplate>().toHaveProperty("roles");
    expectTypeOf<DiagnosticMetricInstance>().toHaveProperty("bindings");
    expectTypeOf<DiagnosticDefinition>().toHaveProperty("lossRowGrain");
    expectTypeOf<CompiledDiagnosticDefinition>().toHaveProperty(
      "definitionIntegrity",
    );
    expectTypeOf<DiagnosticPeriodAxis>().toHaveProperty("kind");
    expectTypeOf<DiagnosticComparisonRule>().toHaveProperty("when");
    expectTypeOf<DiagnosticReviewRule>().toHaveProperty("kind");
    expectTypeOf<DiagnosticReviewRuleEvaluationBase>().toHaveProperty("scope");
    expectTypeOf<DiagnosticLossInputAuditSnapshot>().toHaveProperty("measures");
    expectTypeOf<DiagnosticExposureInputAuditSnapshot>().toHaveProperty(
      "value",
    );
    expectTypeOf<DiagnosticExpectedCellAuditSnapshot>().toHaveProperty(
      "valuation",
    );
    expectTypeOf<NormalizedDiagnosticFormulaIdentity>().toHaveProperty("roles");
    expectTypeOf<NormalizedDiagnosticCalculationScope>().toHaveProperty(
      "formulaFingerprint",
    );
    expectTypeOf<NormalizedDiagnosticDefinitionIdentity>().toHaveProperty(
      "diagnosticDefinitionVersion",
    );
    expectTypeOf<DiagnosticValidationError>().toHaveProperty("issues");
    expectTypeOf<DiagnosticValidationIssue>().toHaveProperty("path");
    expectTypeOf<DiagnosticMeasureStats>().toEqualTypeOf<{
      readonly value: number | null;
      readonly sum: number | null;
      readonly observed: number;
      readonly missing: number;
      readonly nonFinite: number;
      readonly imputedZero: number;
      readonly deduplicated: number;
      readonly structural: number;
    }>();
  });
});
