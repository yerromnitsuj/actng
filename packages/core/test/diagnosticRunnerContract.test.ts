import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  commonMaturity,
  prepareDiagnosticData,
  runMetricDiagnostics,
  sameMaturity,
  type DiagnosticDefinition,
} from "../src/index.js";

function definition(
  missing: "unknown" | "zero" = "unknown",
): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: "runner-contract",
    version: "1",
    lossRowGrain: "aggregate",
    measures: [
      {
        id: "claims",
        displayName: "Claims",
        description: "Claims",
        source: "loss",
        kind: "count",
        unit: "claim",
        developmentSemantics: "cumulative",
        aggregation: "sum",
        missing,
        countPopulationId: "claims",
      },
    ],
    countPopulations: [
      {
        id: "claims",
        displayName: "Claims",
        subject: "claim",
        unit: "claim",
        description: "Claims",
      },
    ],
    exposureBases: [],
    amountBases: [],
    derivedMeasures: [],
    formulas: [
      CASUALTY_FORMULA_TEMPLATES.find((formula) => formula.id === "share")!,
    ],
    instances: [
      {
        id: "share",
        version: "1",
        formulaId: "share",
        bindings: {
          part: { op: "measure", measureId: "claims" },
          whole: { op: "measure", measureId: "claims" },
        },
        presentation: {
          displayName: "Share",
          description: "Share",
          displayUnit: "ratio",
          scale: 1,
          numeratorLabel: "claims",
          denominatorLabel: "claims",
        },
        rules: [
          {
            id: "positive",
            code: "not-positive",
            message: "Claims should be positive",
            severity: "warning",
            when: {
              left: {
                source: "measure",
                expression: { op: "measure", measureId: "claims" },
              },
              operator: "lte",
              right: { source: "constant", value: 0 },
            },
          },
        ],
      },
    ],
    reviewRules: [],
    periodAxis: {
      kind: "calendar",
      originCadence: "year",
      valuationCadence: "year",
      originAnchor: "start",
      valuationAnchor: "end",
      ageUnit: "month",
      ageOffset: 0,
    },
  };
}

describe("diagnostic runner contract", () => {
  it("recomputes mapped groups from leaf contributions and fails closed on mapped overflow", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition()),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "a",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1e308 },
          source: { artifactId: "loss", sourceRow: 1 },
        },
        {
          rowType: "aggregate",
          recordId: "b",
          sourceGroup: "b",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1e308 },
          source: { artifactId: "loss", sourceRow: 2 },
        },
      ],
      exposures: [],
    });
    const result = runMetricDiagnostics({
      prepared,
      groupMap: { a: "total", b: "total" },
    });
    expect(result.emergence[0]!.components.claims).toMatchObject({
      value: null,
      sum: null,
      observed: 2,
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "diagnostic-measure-overflow",
        group: "total",
        measureId: "claims",
      }),
    );
  });

  it("keeps zero-imputed metric rules not evaluated while allowing the calculation policy", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition("zero")),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: {},
        },
      ],
      exposures: [],
    });
    const result = runMetricDiagnostics({ prepared });
    const metric = result.emergence[0]!.metrics.share!;
    expect(metric.calculation.numerator.value).toBe(0);
    expect(metric.rules[0]).toMatchObject({
      status: "not-evaluated",
      notEvaluatedReasons: ["imputed"],
    });
    expect(metric.findings).toContainEqual(
      expect.objectContaining({
        code: "diagnostic-rule-not-evaluated",
        ruleId: "positive",
      }),
    );
  });

  it("validates maturity view groups and treats them as a sorted set", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition()),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "a",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1 },
        },
        {
          rowType: "aggregate",
          recordId: "b",
          sourceGroup: "b",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1 },
        },
      ],
      exposures: [],
    });
    const result = runMetricDiagnostics({ prepared });
    expect(
      sameMaturity(result, 12, ["b", "a", "b"]).map((point) => point.group),
    ).toEqual(["a", "b"]);
    expect(commonMaturity(result, [])).toEqual({
      developmentAge: null,
      ageUnit: "month",
      points: [],
    });
    expect(() => sameMaturity(result, 12, ["missing"])).toThrow(
      /Unknown output group/,
    );
    expect(() => commonMaturity(result, [" "])).toThrow(/nonempty token/);
  });

  it("reports expression overflow at normalized RFC 6901 definition paths", () => {
    const base = definition();
    const compiled = compileDiagnosticDefinition({
      ...base,
      instances: [
        {
          ...base.instances[0]!,
          bindings: {
            part: {
              op: "add",
              terms: [
                { op: "measure", measureId: "claims" },
                { op: "measure", measureId: "claims" },
              ],
            },
            whole: { op: "measure", measureId: "claims" },
          },
          rules: [
            {
              ...base.instances[0]!.rules[0]!,
              when: {
                ...base.instances[0]!.rules[0]!.when,
                left: {
                  source: "measure",
                  expression: {
                    op: "add",
                    terms: [
                      { op: "measure", measureId: "claims" },
                      { op: "measure", measureId: "claims" },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    });
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1e308 },
        },
      ],
      exposures: [],
    });
    const paths = runMetricDiagnostics({ prepared })
      .findings.filter(
        (finding) => finding.code === "diagnostic-expression-overflow",
      )
      .map((finding) => finding.expressionPath);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/instances/0/bindings/part",
        "/instances/0/rules/0/when/left/expression",
      ]),
    );
  });

  it("treats prototype-named grouping keys as data and rejects malformed tokens", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition()),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "__proto__",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1 },
        },
      ],
      exposures: [],
    });
    const groupMap = Object.fromEntries([["__proto__", "constructor"]]);
    expect(
      runMetricDiagnostics({ prepared, groupMap }).emergence[0]!.group,
    ).toBe("constructor");
    expect(() =>
      runMetricDiagnostics({
        prepared,
        groupMap: Object.fromEntries([["__proto__", "bad\0group"]]),
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "invalid-json-value",
            path: "$.groupMap.__proto__",
          }),
        ],
      }),
    );
  });

  it("keeps attached structural findings out of the unattached result projection", () => {
    const withExposure: DiagnosticDefinition = {
      ...definition(),
      measures: [
        ...definition().measures,
        {
          id: "exposure",
          displayName: "Exposure",
          description: "Exposure",
          source: "exposure",
          kind: "exposure",
          unit: "vehicle-year",
          developmentSemantics: "cumulative",
          aggregation: "sum",
          missing: "unknown",
          exposureBasisId: "vehicles",
          exposureTiming: "origin-static",
        },
      ],
      exposureBases: [
        {
          id: "vehicles",
          displayName: "Vehicles",
          basis: "earned",
          unit: "vehicle-year",
          description: "Vehicles",
        },
      ],
    };
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(withExposure),
      losses: [
        {
          rowType: "aggregate",
          recordId: "a",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1 },
        },
      ],
      exposures: [],
    });
    const result = runMetricDiagnostics({ prepared });
    expect(
      result.findings.filter(
        (finding) => finding.code === "loss-without-exposure",
      ),
    ).toHaveLength(1);
    expect(
      result.emergence[0]!.metrics.share!.findings.map(
        (finding) => finding.code,
      ),
    ).not.toContain("loss-without-exposure");
  });
});
