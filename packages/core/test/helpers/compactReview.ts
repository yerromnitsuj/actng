import {
  compileDiagnosticDefinition,
  type DiagnosticDefinition,
  type PrepareDiagnosticDataInput,
} from "../../src/index.js";

/** Synthetic review inputs, not a registered external-source fixture. */
export function compactReviewFixture(
  options: {
    nullable?: boolean;
    overflow?: boolean;
    gap?: boolean;
    quarter?: boolean;
    groups?: number;
    mixedSources?: boolean;
  } = {},
): PrepareDiagnosticDataInput {
  const measure = (measureId: string) => ({
    op: "measure" as const,
    measureId,
  });
  const base = {
    code: "review",
    description: "Review",
    severity: "warning" as const,
    missingInput: "not-evaluated" as const,
  };
  const definition: DiagnosticDefinition = {
    diagnosticDefinitionVersion: "1.0.0",
    id: "compact-review",
    version: "1",
    lossRowGrain: "aggregate",
    measures: ["a", "b"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss",
      kind: "amount",
      unit: "USD",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      basisId: "gross",
    })),
    countPopulations: [],
    exposureBases: [],
    amountBases: [
      {
        id: "gross",
        displayName: "Gross",
        currency: "USD",
        perspective: "gross",
        components: [
          {
            id: "indemnity",
            treatment: "included",
            limitation: { kind: "unlimited" },
          },
        ],
      },
    ],
    derivedMeasures: [],
    formulas: [],
    instances: [],
    reviewRules: [
      {
        ...base,
        id: "compare",
        kind: "compare",
        when: { left: measure("a"), operator: "gt", right: measure("b") },
      },
      {
        ...base,
        id: "reconcile",
        kind: "reconcile",
        severity: "fail",
        actual: measure("a"),
        expected: measure("b"),
      },
      {
        ...base,
        id: "monotonic",
        kind: "monotonic",
        expression: measure("a"),
        direction: "nondecreasing",
      },
      {
        ...base,
        id: "layer",
        kind: "layer-order",
        narrower: measure("a"),
        broader: measure("b"),
        comparability: {
          kind: "caller-asserted",
          rationaleArtifactId: "comparison-note",
        },
      },
      {
        ...base,
        id: "control",
        kind: "control-total",
        expression: { op: "add", terms: [measure("a"), measure("a")] },
        expected: 24,
        projection: { kind: "all-cells" },
      },
    ],
    periodAxis: {
      kind: "calendar",
      originCadence: options.quarter ? "quarter" : "year",
      valuationCadence: options.quarter ? "quarter" : "year",
      originAnchor: "start",
      valuationAnchor: "end",
      ageUnit: "month",
      ageOffset: 0,
    },
  };
  if (options.mixedSources) {
    definition.exposureBases = [
      {
        id: "nights",
        displayName: "Nights",
        description: "Nights",
        unit: "night",
        basis: "earned",
      },
    ];
    definition.measures = [
      ...definition.measures,
      ...["x", "y", "unused"].map((id) => ({
        id,
        displayName: id,
        description: id,
        source: "exposure" as const,
        kind: "exposure" as const,
        unit: "night",
        developmentSemantics: "cumulative" as const,
        aggregation: "sum" as const,
        missing: "unknown" as const,
        exposureBasisId: "nights",
        exposureTiming: "origin-static" as const,
      })),
    ];
    const sum = {
      op: "add" as const,
      terms: [measure("x"), measure("x"), measure("y")],
    };
    definition.reviewRules = [
      ...definition.reviewRules,
      ...["exposure-first", "exposure-repeat"].map((id) => ({
        ...base,
        id,
        kind: "compare" as const,
        when: {
          left: sum,
          operator: "lt" as const,
          right: { op: "constant" as const, value: 0 },
        },
      })),
      {
        ...base,
        id: "exposure-subset",
        kind: "compare",
        when: {
          left: measure("x"),
          operator: "lt",
          right: { op: "constant", value: 0 },
        },
      },
    ];
  }
  const origin = options.quarter ? "2024-Q1" : "2024";
  const valuations = options.quarter
    ? ["2024-Q1", "2024-Q3"]
    : ["2024", "2026"];
  const groups = options.groups ?? 1;
  return {
    definition: compileDiagnosticDefinition(definition),
    losses: Array.from({ length: groups }, (_, group) =>
      valuations.map((valuation, index) => ({
        rowType: "aggregate" as const,
        recordId: `${group}/${index}`,
        sourceGroup: `group-${group}`,
        origin,
        valuation,
        complete: true,
        measures: {
          a:
            options.nullable && index === 0
              ? null
              : options.overflow
                ? Number.MAX_VALUE
                : index === 0
                  ? 5
                  : 7,
          b: index === 0 ? 6 : 4,
        },
        source: {
          artifactId: "loss",
          sourceFile: "loss.csv",
          sourceRow: index === 0 ? 10 : 2,
        },
      })),
    ).flat(),
    exposures: options.mixedSources
      ? ["x", "y", "unused"].map((measureId, index) => ({
          key: measureId,
          sourceGroup: "group-0",
          origin,
          measureId,
          value:
            options.nullable && index === 0
              ? null
              : options.overflow && index === 0
                ? Number.MAX_VALUE
                : 1,
          complete: true,
          source: {
            artifactId: "exposure",
            sourceFile: "exposure.csv",
            sourceRow: [10, 2, 99][index]!,
          },
        }))
      : [],
    ...(options.gap
      ? {
          expectedCells: [
            {
              sourceGroup: "group-0",
              origin,
              valuation: options.quarter ? "2024-Q2" : "2025",
              source: { artifactId: "expected", sourceRow: 9 },
            },
          ],
        }
      : {}),
  };
}
