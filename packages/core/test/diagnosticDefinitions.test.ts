import { describe, expect, it } from "vitest";
import {
  assertCompiledDiagnosticDefinition,
  compileDiagnosticDefinition,
  type DiagnosticDefinition,
  type DiagnosticFormulaTemplate,
  type DiagnosticPeriodAxis,
} from "../src/index.js";

const calendarAxis: DiagnosticPeriodAxis = {
  kind: "calendar",
  originCadence: "quarter",
  valuationCadence: "quarter",
  originAnchor: "start",
  valuationAnchor: "end",
  ageUnit: "month",
  ageOffset: 0,
};

const shareFormula: DiagnosticFormulaTemplate = {
  id: "share",
  version: "1.0.0",
  roles: {
    part: { kind: "count", compatibilityGroup: "claim-population" },
    whole: { kind: "count", compatibilityGroup: "claim-population" },
  },
  numerator: { op: "role", role: "part" },
  denominator: { op: "role", role: "whole" },
  denominatorPolicy: "positive-or-null",
};

const paidToIncurredFormula: DiagnosticFormulaTemplate = {
  id: "paid-to-incurred",
  version: "1.0.0",
  roles: {
    paid: {
      kind: "amount",
      compatibilityGroup: "amount-basis",
      developmentSemantics: "cumulative",
    },
    incurred: {
      kind: "amount",
      compatibilityGroup: "amount-basis",
      developmentSemantics: "cumulative",
    },
  },
  numerator: { op: "role", role: "paid" },
  denominator: { op: "role", role: "incurred" },
  denominatorPolicy: "positive-or-null",
};

const frequencyFormula: DiagnosticFormulaTemplate = {
  id: "frequency",
  version: "1.0.0",
  roles: {
    claims: { kind: "count" },
    exposure: { kind: "exposure" },
  },
  numerator: { op: "role", role: "claims" },
  denominator: { op: "role", role: "exposure" },
  denominatorPolicy: "positive-or-null",
};

const countOnlyDefinition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "count-only",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "closed-with-pay",
      displayName: "Closed with payment",
      description: "Reported claims closed with positive cumulative payment",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "reported",
      displayName: "Reported claims",
      description: "Claims reported by valuation",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "One count per claim",
    },
  ],
  exposureBases: [],
  amountBases: [],
  derivedMeasures: [],
  formulas: [shareFormula],
  instances: [
    {
      id: "closed-with-pay-share",
      version: "1.0.0",
      formulaId: "share",
      bindings: {
        part: { op: "measure", measureId: "closed-with-pay" },
        whole: { op: "measure", measureId: "reported" },
      },
      presentation: {
        displayName: "Closed-with-payment share",
        description: "Closed-with-payment claims divided by reported claims",
        displayUnit: "ratio",
        scale: 1,
        numeratorLabel: "closed-with-payment claims",
        denominatorLabel: "reported claims",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: calendarAxis,
};

const singleBasisDefinition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "single-basis",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "paid",
      displayName: "Paid loss",
      description: "Cumulative paid loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "gross-loss",
    },
    {
      id: "incurred",
      displayName: "Incurred loss",
      description: "Cumulative incurred loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "gross-loss",
    },
  ],
  countPopulations: [],
  exposureBases: [],
  amountBases: [
    {
      id: "gross-loss",
      displayName: "Gross loss",
      currency: "USD",
      perspective: "gross",
      components: [
        {
          id: "loss",
          treatment: "included",
          limitation: { kind: "unlimited" },
        },
      ],
    },
  ],
  derivedMeasures: [],
  formulas: [paidToIncurredFormula],
  instances: [
    {
      id: "gross-paid-to-incurred",
      version: "1.0.0",
      formulaId: "paid-to-incurred",
      bindings: {
        paid: { op: "measure", measureId: "paid" },
        incurred: { op: "measure", measureId: "incurred" },
      },
      presentation: {
        displayName: "Gross paid to incurred",
        description:
          "Cumulative gross paid divided by cumulative gross incurred",
        displayUnit: "ratio",
        scale: 1,
        numeratorLabel: "gross paid",
        denominatorLabel: "gross incurred",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: calendarAxis,
};

const twoBasisDefinition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "two-basis",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "gross-paid",
      displayName: "Gross paid",
      description: "Cumulative gross paid loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "gross",
    },
    {
      id: "gross-incurred",
      displayName: "Gross incurred",
      description: "Cumulative gross incurred loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "gross",
    },
    {
      id: "net-paid",
      displayName: "Net paid",
      description: "Cumulative net paid loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "net",
    },
    {
      id: "net-incurred",
      displayName: "Net incurred",
      description: "Cumulative net incurred loss",
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      basisId: "net",
    },
  ],
  countPopulations: [],
  exposureBases: [],
  amountBases: [
    {
      id: "gross",
      displayName: "Gross loss",
      currency: "USD",
      perspective: "gross",
      components: [
        {
          id: "loss",
          treatment: "included",
          limitation: { kind: "unlimited" },
        },
      ],
    },
    {
      id: "net",
      displayName: "Net loss",
      currency: "USD",
      perspective: "net",
      components: [
        {
          id: "loss",
          treatment: "included",
          limitation: { kind: "unlimited" },
        },
      ],
    },
  ],
  derivedMeasures: [],
  formulas: [paidToIncurredFormula],
  instances: [
    {
      id: "gross-paid-to-incurred",
      version: "1.0.0",
      formulaId: "paid-to-incurred",
      bindings: {
        paid: { op: "measure", measureId: "gross-paid" },
        incurred: { op: "measure", measureId: "gross-incurred" },
      },
      presentation: {
        displayName: "Gross paid to incurred",
        description: "Gross payment emergence",
        displayUnit: "ratio",
        scale: 1,
        numeratorLabel: "gross paid",
        denominatorLabel: "gross incurred",
      },
      rules: [],
    },
    {
      id: "net-paid-to-incurred",
      version: "1.0.0",
      formulaId: "paid-to-incurred",
      bindings: {
        paid: { op: "measure", measureId: "net-paid" },
        incurred: { op: "measure", measureId: "net-incurred" },
      },
      presentation: {
        displayName: "Net paid to incurred",
        description: "Net payment emergence",
        displayUnit: "ratio",
        scale: 1,
        numeratorLabel: "net paid",
        denominatorLabel: "net incurred",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: calendarAxis,
};

const mixedExposureDefinition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "mixed-exposure",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported claims",
      description: "Claims reported by valuation",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "earned-vehicle-years",
      displayName: "Earned vehicle years",
      description: "Origin-static earned exposure",
      source: "exposure",
      kind: "exposure",
      unit: "vehicle-year",
      developmentSemantics: "unknown",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "earned",
      exposureTiming: "origin-static",
    },
    {
      id: "vehicles-in-force",
      displayName: "Vehicles in force",
      description: "Vehicles in force at each valuation",
      source: "exposure",
      kind: "exposure",
      unit: "vehicle",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "in-force",
      exposureTiming: "valuation-specific",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "One count per claim",
    },
  ],
  exposureBases: [
    {
      id: "earned",
      displayName: "Earned vehicle years",
      basis: "earned",
      unit: "vehicle-year",
      description: "Earned exposure for the origin period",
    },
    {
      id: "in-force",
      displayName: "Vehicles in force",
      basis: "in-force",
      unit: "vehicle",
      description: "Point-in-time vehicle count",
    },
  ],
  amountBases: [],
  derivedMeasures: [],
  formulas: [frequencyFormula],
  instances: [
    {
      id: "reported-per-earned-vehicle-year",
      version: "1.0.0",
      formulaId: "frequency",
      bindings: {
        claims: { op: "measure", measureId: "reported" },
        exposure: { op: "measure", measureId: "earned-vehicle-years" },
      },
      presentation: {
        displayName: "Reported frequency on earned exposure",
        description: "Reported claims per million earned vehicle years",
        displayUnit: "claims per million vehicle-years",
        scale: 1_000_000,
        numeratorLabel: "reported claims",
        denominatorLabel: "earned vehicle-years",
      },
      rules: [],
    },
    {
      id: "reported-per-vehicle-in-force",
      version: "1.0.0",
      formulaId: "frequency",
      bindings: {
        claims: { op: "measure", measureId: "reported" },
        exposure: { op: "measure", measureId: "vehicles-in-force" },
      },
      presentation: {
        displayName: "Reported frequency on in-force exposure",
        description: "Reported claims per thousand vehicles in force",
        displayUnit: "claims per thousand vehicles",
        scale: 1_000,
        numeratorLabel: "reported claims",
        denominatorLabel: "vehicles in force",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: calendarAxis,
};

const orderedFiscalDefinition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "ordered-fiscal",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported claims",
      description: "Claims reported by valuation",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "One count per claim",
    },
  ],
  exposureBases: [],
  amountBases: [],
  derivedMeasures: [],
  formulas: [shareFormula],
  instances: [
    {
      id: "reported-share",
      version: "1.0.0",
      formulaId: "share",
      bindings: {
        part: { op: "measure", measureId: "reported" },
        whole: { op: "measure", measureId: "reported" },
      },
      presentation: {
        displayName: "Reported share",
        description: "Identity check for the ordered fiscal definition",
        displayUnit: "ratio",
        scale: 1,
        numeratorLabel: "reported claims",
        denominatorLabel: "reported claims",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: {
    kind: "ordered",
    id: "fiscal-quarters",
    version: "2026.1",
    ageUnit: "fiscal-quarter",
    ageOffset: 1,
    origins: [
      { label: "FY2025-Q1", aliases: ["2025 FQ1", "25Q1"], coordinate: 100 },
      { label: "FY2025-Q2", aliases: ["2025 FQ2", "25Q2"], coordinate: 101 },
    ],
    valuations: [
      { label: "FY2025-Q1", aliases: ["25Q1", "2025 FQ1"], coordinate: 100 },
      { label: "FY2025-Q2", aliases: ["25Q2", "2025 FQ2"], coordinate: 101 },
    ],
  },
};

const authoredDefinitions = [
  countOnlyDefinition,
  singleBasisDefinition,
  twoBasisDefinition,
  mixedExposureDefinition,
  orderedFiscalDefinition,
];

describe("diagnostic definition compilation", () => {
  it("compiles count-only, one-basis, two-basis, mixed-exposure, and ordered-axis definitions", () => {
    for (const definition of authoredDefinitions) {
      const compiled = compileDiagnosticDefinition(definition);
      assertCompiledDiagnosticDefinition(compiled);
      expect(compiled.definition.id).toBe(definition.id);
      expect(compiled.definitionIntegrity).toMatch(
        /^fnv1a64-jcs-v1:[0-9a-f]{16}$/,
      );
      expect(Object.isFrozen(compiled)).toBe(true);
      expect(Object.isFrozen(compiled.definition)).toBe(true);
    }
  });

  it("reuses one formula across two amount bases without cloning formula identity", () => {
    const compiled = compileDiagnosticDefinition(twoBasisDefinition);
    expect(Object.keys(compiled.formulaFingerprints)).toEqual([
      "paid-to-incurred",
    ]);
    expect(Object.keys(compiled.calculationFingerprints)).toEqual([
      "gross-paid-to-incurred",
      "net-paid-to-incurred",
    ]);
    expect(compiled.calculationFingerprints["gross-paid-to-incurred"]).not.toBe(
      compiled.calculationFingerprints["net-paid-to-incurred"],
    );
  });

  it("normalizes ordered aliases and catalog order deterministically", () => {
    const compiled = compileDiagnosticDefinition(orderedFiscalDefinition);
    const axis = compiled.definition.periodAxis;
    expect(axis.kind).toBe("ordered");
    if (axis.kind === "ordered") {
      expect(axis.origins[0]!.aliases).toEqual(["2025 FQ1", "25Q1"]);
      expect(axis.valuations[0]!.aliases).toEqual(["2025 FQ1", "25Q1"]);
    }
  });

  it("canonicalizes review filter and projection period aliases", () => {
    const compiled = compileDiagnosticDefinition({
      ...orderedFiscalDefinition,
      reviewRules: [
        {
          kind: "control-total",
          id: "reported-control",
          code: "reported-control",
          description: "Reported claims match the control",
          severity: "fail",
          missingInput: "not-evaluated",
          expression: { op: "measure", measureId: "reported" },
          expected: 1,
          filter: {
            origins: ["25Q1"],
            valuationFrom: "2025 FQ1",
            valuationThrough: "25Q2",
          },
          projection: { kind: "valuation", valuation: "25Q2" },
        },
      ],
    });
    expect(compiled.definition.reviewRules[0]).toMatchObject({
      filter: {
        origins: ["FY2025-Q1"],
        valuationFrom: "FY2025-Q1",
        valuationThrough: "FY2025-Q2",
      },
      projection: { kind: "valuation", valuation: "FY2025-Q2" },
    });
  });

  it("rejects invalid review periods and unsafe all-cell controls", () => {
    const reviewRule = {
      kind: "control-total" as const,
      id: "reported-control",
      code: "reported-control",
      description: "Reported claims match the control",
      severity: "fail" as const,
      missingInput: "not-evaluated" as const,
      expression: { op: "measure" as const, measureId: "reported" },
      expected: 1,
      projection: { kind: "valuation" as const, valuation: "not-a-period" },
    };
    expect(() =>
      compileDiagnosticDefinition({
        ...orderedFiscalDefinition,
        reviewRules: [reviewRule],
      }),
    ).toThrow(/period/i);
    expect(() =>
      compileDiagnosticDefinition({
        ...orderedFiscalDefinition,
        reviewRules: [
          { ...reviewRule, projection: { kind: "all-cells" as const } },
        ],
      }),
    ).toThrow(/all-cells/i);
  });

  it("requires amount semantics for caller-asserted layer ordering", () => {
    expect(() =>
      compileDiagnosticDefinition({
        ...orderedFiscalDefinition,
        reviewRules: [
          {
            kind: "layer-order",
            id: "invalid-layer-order",
            code: "invalid-layer-order",
            description: "A count is not an amount layer",
            severity: "fail",
            missingInput: "not-evaluated",
            narrower: { op: "measure", measureId: "reported" },
            broader: { op: "measure", measureId: "reported" },
            comparability: {
              kind: "caller-asserted",
              rationaleArtifactId: "review-note",
            },
          },
        ],
      }),
    ).toThrow(/amounts/);
  });

  it("proves SDK-derived layer containment from a shared raw claim measure", () => {
    const layered: DiagnosticDefinition = {
      diagnosticDefinitionVersion: "1.0.0",
      id: "layer-proof",
      version: "1",
      lossRowGrain: "claim",
      measures: [
        {
          id: "raw-incurred",
          displayName: "Raw incurred",
          description: "Unlimited incurred",
          source: "loss",
          kind: "amount",
          unit: "USD",
          developmentSemantics: "cumulative",
          aggregation: "sum",
          missing: "unknown",
          basisId: "unlimited",
        },
        {
          id: "primary-incurred",
          displayName: "Primary incurred",
          description: "Primary incurred",
          source: "derived",
          kind: "amount",
          unit: "USD",
          developmentSemantics: "cumulative",
          aggregation: "sum",
          missing: "unknown",
          basisId: "primary",
        },
      ],
      countPopulations: [],
      exposureBases: [],
      amountBases: [
        {
          id: "unlimited",
          displayName: "Unlimited",
          currency: "USD",
          perspective: "gross",
          components: [
            {
              id: "loss",
              treatment: "included",
              limitation: { kind: "unlimited" },
            },
          ],
        },
        {
          id: "primary",
          displayName: "Primary",
          currency: "USD",
          perspective: "gross",
          components: [
            {
              id: "loss",
              treatment: "included",
              limitation: {
                kind: "layer",
                attachment: 0,
                limit: 250_000,
                application: "claim",
                derivation: { kind: "sdk" },
              },
            },
          ],
        },
      ],
      derivedMeasures: [
        {
          id: "derive-primary",
          outputMeasureId: "primary-incurred",
          expression: {
            op: "claim-layer",
            measureId: "raw-incurred",
            attachment: 0,
            limit: 250_000,
          },
        },
      ],
      formulas: [],
      instances: [],
      reviewRules: [
        {
          kind: "layer-order",
          id: "primary-below-total",
          code: "primary-below-total",
          description: "Primary does not exceed total",
          severity: "fail",
          missingInput: "not-evaluated",
          narrower: { op: "measure", measureId: "primary-incurred" },
          broader: { op: "measure", measureId: "raw-incurred" },
          comparability: { kind: "compiler-proven" },
        },
      ],
      periodAxis: calendarAxis,
    };
    expect(
      compileDiagnosticDefinition(layered).definition.reviewRules[0],
    ).toMatchObject({ comparability: { kind: "compiler-proven" } });
  });

  it("recompiles its normalized wire projection idempotently", () => {
    const first = compileDiagnosticDefinition(orderedFiscalDefinition);
    const second = compileDiagnosticDefinition(first.definition);

    expect(second.definition).toEqual(first.definition);
    expect(second.formulaFingerprints).toEqual(first.formulaFingerprints);
    expect(second.calculationFingerprints).toEqual(
      first.calculationFingerprints,
    );
    expect(second.definitionIntegrity).toBe(first.definitionIntegrity);
  });

  it("defensively snapshots input and rejects structural lookalikes", () => {
    const mutable = structuredClone(countOnlyDefinition);
    const compiled = compileDiagnosticDefinition(mutable);
    mutable.measures[0]!.displayName = "mutated after compilation";
    expect(compiled.definition.measures[0]!.displayName).toBe(
      "Closed with payment",
    );

    const lookalike = JSON.parse(JSON.stringify(compiled));
    expect(() => assertCompiledDiagnosticDefinition(lookalike)).toThrow(
      /compiled diagnostic definition/i,
    );
  });

  it("rejects unknown executable keys and invalid enum branches at exact paths", () => {
    const futureFormula = structuredClone(
      countOnlyDefinition,
    ) as DiagnosticDefinition & {
      formulas: Array<DiagnosticFormulaTemplate & { futureBehavior?: boolean }>;
    };
    futureFormula.formulas[0]!.futureBehavior = true;
    expect(() => compileDiagnosticDefinition(futureFormula)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "$.formulas[0].futureBehavior",
          }),
        ]),
      }),
    );

    expect(() =>
      compileDiagnosticDefinition({
        ...countOnlyDefinition,
        periodAxis: { ...calendarAxis, originAnchor: "middle" as never },
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "$.periodAxis.originAnchor" }),
        ]),
      }),
    );
  });

  it("rejects comparisons between different quantity semantics", () => {
    const instance = mixedExposureDefinition.instances[0]!;
    expect(() =>
      compileDiagnosticDefinition({
        ...mixedExposureDefinition,
        instances: [
          {
            ...instance,
            rules: [
              {
                id: "count-versus-exposure",
                code: "count-versus-exposure",
                message: "Invalid cross-quantity comparison",
                severity: "fail",
                when: {
                  left: { source: "calculation", field: "numerator" },
                  operator: "gt",
                  right: { source: "calculation", field: "denominator" },
                },
              },
            ],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "incompatible-semantics",
            path: "$.instances[0].rules[0].when",
          }),
        ]),
      }),
    );
  });
});

export {
  countOnlyDefinition,
  mixedExposureDefinition,
  orderedFiscalDefinition,
  singleBasisDefinition,
  twoBasisDefinition,
};
