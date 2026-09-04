import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  DiagnosticValidationError,
  compileDiagnosticDefinition,
  prepareDiagnosticData,
  type DiagnosticDefinition,
  type DiagnosticLossInput,
} from "../src/index.js";

function definition(
  grain: "aggregate" | "claim" = "aggregate",
): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: `preparation-${grain}`,
    version: "1",
    lossRowGrain: grain,
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
        missing: "unknown",
        countPopulationId: "claims",
      },
      ...(grain === "claim"
        ? [
            {
              id: "doubled-claims",
              displayName: "Doubled claims",
              description: "Twice claims",
              source: "derived" as const,
              kind: "count" as const,
              unit: "claim",
              developmentSemantics: "cumulative" as const,
              aggregation: "sum" as const,
              missing: "unknown" as const,
              countPopulationId: "claims",
            },
          ]
        : []),
      {
        id: "static-exposure",
        displayName: "Static exposure",
        description: "Static",
        source: "exposure",
        kind: "exposure",
        unit: "vehicle-year",
        developmentSemantics: "cumulative",
        aggregation: "sum",
        missing: "unknown",
        exposureBasisId: "vehicles",
        exposureTiming: "origin-static",
      },
      {
        id: "valuation-exposure",
        displayName: "Valuation exposure",
        description: "Valuation",
        source: "exposure",
        kind: "exposure",
        unit: "vehicle-year",
        developmentSemantics: "cumulative",
        aggregation: "sum",
        missing: "unknown",
        exposureBasisId: "vehicles",
        exposureTiming: "valuation-specific",
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
    exposureBases: [
      {
        id: "vehicles",
        displayName: "Vehicles",
        basis: "earned",
        unit: "vehicle-year",
        description: "Vehicles",
      },
    ],
    amountBases: [],
    derivedMeasures:
      grain === "claim"
        ? [
            {
              id: "derive-doubled",
              outputMeasureId: "doubled-claims",
              expression: {
                op: "add",
                terms: [
                  { op: "measure", measureId: "claims" },
                  { op: "measure", measureId: "claims" },
                ],
              },
            },
          ]
        : [],
    formulas: [...CASUALTY_FORMULA_TEMPLATES],
    instances: [],
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

function aggregate(
  recordId: string,
  origin = "2024",
  valuation = origin,
  complete = true,
  measures: Record<string, number | null> = { claims: 2 },
): DiagnosticLossInput {
  return {
    rowType: "aggregate",
    recordId,
    sourceGroup: "all",
    origin,
    valuation,
    complete,
    measures,
    source: {
      artifactId: "losses",
      sourceRow: Number(recordId.replace(/\D/g, "")) || 1,
    },
  };
}

function claim(
  recordId: string,
  claimId: string,
  origin = "2024",
  valuation = origin,
  complete = true,
): DiagnosticLossInput {
  return {
    rowType: "claim",
    claimId,
    recordId,
    sourceGroup: "all",
    origin,
    valuation,
    complete,
    measures: { claims: 1 },
    source: {
      artifactId: "losses",
      sourceRow: Number(recordId.replace(/\D/g, "")) || 1,
    },
  };
}

describe("documented diagnostic preparation contract", () => {
  it("rejects malformed direct-core input atomically", () => {
    const compiled = compileDiagnosticDefinition(definition());
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: null,
        exposures: [],
      } as never),
    ).toThrow(DiagnosticValidationError);
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: [aggregate("r1")],
        exposures: [
          {
            key: "x",
            sourceGroup: "all",
            origin: "2024",
            measureId: "static-exposure",
            value: "10",
            complete: true,
          },
        ],
      } as never),
    ).toThrow(DiagnosticValidationError);
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: [{ ...aggregate("r1"), source: undefined }],
        exposures: [],
      } as never),
    ).toThrow(/Explicit undefined/);
  });

  it("turns invalid periods into reviewable findings and respects source-filter precedence", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [
        aggregate("r1", "invalid"),
        { ...aggregate("r2", "invalid"), sourceGroup: "excluded" },
      ],
      exposures: [],
      filter: { sourceGroups: ["all"] },
    });
    expect(
      prepared.inputAudit.map((item) => [item.kind, item.disposition]),
    ).toEqual([
      ["loss", "invalid"],
      ["loss", "filter"],
    ]);
    expect(prepared.findings.map((finding) => finding.code)).toEqual([
      "unknown-origin-period",
      "unknown-valuation-period",
    ]);
    expect(prepared.cells).toEqual([]);
  });

  it("normalizes and executes cutoffs before ordinary filters", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r1", "2023"), aggregate("r2", "2024")],
      exposures: [
        {
          key: "static-kept",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2025",
          measureId: "static-exposure",
          value: 10,
          complete: true,
        },
        {
          key: "static-cut",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2025",
          measureId: "static-exposure",
          value: 20,
          complete: true,
        },
        {
          key: "valuation-cut",
          sourceGroup: "all",
          origin: "2023",
          valuation: "2024",
          measureId: "valuation-exposure",
          value: 30,
          complete: true,
        },
      ],
      expectedCells: [
        { sourceGroup: "all", origin: "2023", valuation: "2023" },
        { sourceGroup: "all", origin: "2024", valuation: "2024" },
      ],
      completePeriodCutoffs: [
        { sourceGroup: "all", originThrough: "2023", valuationThrough: "2023" },
      ],
      filter: { valuations: ["2023"] },
    });
    const dispositions = Object.fromEntries(
      prepared.inputAudit.map((item) => {
        const id =
          item.kind === "loss"
            ? item.record.recordId
            : item.kind === "exposure"
              ? item.record.key
              : `${item.record.origin}/${item.record.valuation}`;
        return [id, item.disposition];
      }),
    );
    expect(dispositions).toMatchObject({
      r1: "retained",
      r2: "complete-period-cutoff",
      "static-kept": "retained",
      "static-cut": "complete-period-cutoff",
      "valuation-cut": "complete-period-cutoff",
      "2023/2023": "retained",
      "2024/2024": "complete-period-cutoff",
    });
    expect(prepared.completePeriodCutoffs).toEqual([
      { sourceGroup: "all", originThrough: "2023", valuationThrough: "2023" },
    ]);
    expect(prepared.cells.map((cell) => cell.origin)).toEqual(["2023"]);
  });

  it("invalidates duplicate loss identities instead of double counting", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const duplicatedId = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r1", "2023"), aggregate("r1", "2024")],
      exposures: [],
    });
    expect(
      duplicatedId.inputAudit.every((item) => item.disposition === "invalid"),
    ).toBe(true);
    expect(duplicatedId.cells).toEqual([]);
    expect(duplicatedId.findings.map((finding) => finding.code)).toContain(
      "duplicate-loss-record-id",
    );

    const duplicatedCell = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r1"), aggregate("r2")],
      exposures: [],
    });
    expect(duplicatedCell.cells).toEqual([]);
    expect(duplicatedCell.findings.map((finding) => finding.code)).toEqual([
      "duplicate-aggregate-snapshot",
    ]);

    const numericSourceOrder = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r10"), aggregate("r2")],
      exposures: [],
    });
    expect(
      numericSourceOrder.findings[0]!.sources.map((source) => source.sourceRow),
    ).toEqual([2, 10]);
  });

  it("blocks every loss-derived component when an invalid claim shares a retained cell", () => {
    const compiled = compileDiagnosticDefinition(definition("claim"));
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [claim("r1", "c1", "2024", "2024", false), claim("r2", "c2")],
      exposures: [],
    });
    expect(
      prepared.inputAudit
        .filter((item) => item.kind === "loss")
        .map((item) => item.disposition),
    ).toEqual(["invalid", "retained"]);
    expect(prepared.cells).toHaveLength(1);
    expect(prepared.cells[0]!.components.claims).toMatchObject({
      value: null,
      sum: null,
      structural: 1,
      observed: 1,
    });
    expect(
      prepared.cells[0]!.structuralBlockers.claims!.map(
        (blocker) => blocker.code,
      ),
    ).toEqual(["incomplete-loss-record"]);
  });

  it("preserves claim-derivation quality and emits the failed expression path", () => {
    const compiled = compileDiagnosticDefinition(definition("claim"));
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [{ ...claim("r1", "c1"), measures: { claims: 1e308 } }],
      exposures: [],
    });
    expect(
      prepared.cells[0]!.contributions["doubled-claims"]![0],
    ).toMatchObject({ status: "non-finite", value: null });
    expect(prepared.cells[0]!.components["doubled-claims"]).toMatchObject({
      value: null,
      nonFinite: 1,
    });
    expect(prepared.findings).toContainEqual(
      expect.objectContaining({
        code: "diagnostic-expression-overflow",
        measureId: "doubled-claims",
        recordId: "r1",
        expressionPath: "/derivedMeasures/0/expression",
      }),
    );
  });

  it("rejects undeclared and wrong-source measures from arithmetic", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [
        aggregate("r1", "2023", "2023", true, { claims: 2, typo: 9 }),
        aggregate("r2", "2024", "2024", true, {
          claims: 2,
          "static-exposure": 10,
        }),
      ],
      exposures: [],
    });
    expect(prepared.cells).toEqual([]);
    expect(
      prepared.findings.map((finding) => [finding.code, finding.offendingKey]),
    ).toEqual([
      ["undeclared-loss-measure", "typo"],
      ["wrong-source-loss-measure", "static-exposure"],
    ]);
  });

  it("reconciles exposure cohorts, blocks invalid attachments, and reports join gaps", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r1")],
      exposures: [
        {
          key: "static",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          measureId: "static-exposure",
          value: 10,
          complete: true,
        },
        {
          key: "static",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2025",
          measureId: "static-exposure",
          value: 10,
          complete: true,
        },
        {
          key: "valuation",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          measureId: "valuation-exposure",
          value: null,
          complete: false,
        },
      ],
    });
    expect(
      prepared.exposures.find((item) => item.key === "static"),
    ).toMatchObject({ status: "valid", value: 10, deduplicated: 1 });
    expect(
      prepared.exposures.find((item) => item.key === "valuation"),
    ).toMatchObject({ status: "invalid", issues: ["missing", "incomplete"] });
    expect(prepared.cells[0]!.components["static-exposure"]).toMatchObject({
      value: 10,
      deduplicated: 1,
    });
    expect(prepared.cells[0]!.components["valuation-exposure"]).toMatchObject({
      value: null,
      structural: 2,
    });
    expect(prepared.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["missing-exposure-value", "incomplete-exposure"]),
    );
    expect(prepared.findings.map((finding) => finding.code)).not.toContain(
      "loss-without-exposure",
    );
  });

  it("distinguishes an absent exposure, an unattached exposure, and a missing expected cell", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: [aggregate("r1", "2024")],
      exposures: [
        {
          key: "orphan",
          sourceGroup: "all",
          origin: "2023",
          measureId: "static-exposure",
          value: 8,
          complete: true,
        },
      ],
      expectedCells: [
        { sourceGroup: "all", origin: "2023", valuation: "2023" },
      ],
    });
    expect(prepared.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "exposure-without-loss",
        "loss-without-exposure",
        "missing-expected-cell",
      ]),
    );
    expect(
      prepared.cells[0]!.components["valuation-exposure"]!.structural,
    ).toBe(1);
  });

  it("rejects invalid configuration atomically and preserves deterministic identities", () => {
    const compiled = compileDiagnosticDefinition({
      ...definition(),
      periodAxis: {
        kind: "ordered",
        id: "fiscal",
        version: "1",
        origins: [
          { label: "FY23", aliases: ["2023"], coordinate: 0 },
          { label: "FY24", aliases: ["2024"], coordinate: 12 },
        ],
        valuations: [
          { label: "V23", aliases: ["2023"], coordinate: 12 },
          { label: "V24", aliases: ["2024"], coordinate: 24 },
        ],
        ageUnit: "month",
        ageOffset: 0,
      },
    });
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: [],
        exposures: [],
        completePeriodCutoffs: [
          { sourceGroup: "all", originThrough: "2023", valuationThrough: null },
          { sourceGroup: "all", originThrough: "FY24", valuationThrough: null },
        ],
      }),
    ).toThrow(DiagnosticValidationError);
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: [],
        exposures: [],
        expectedCells: [
          { sourceGroup: "all", origin: "2023", valuation: "2023" },
          { sourceGroup: "all", origin: "FY23", valuation: "V23" },
        ],
      }),
    ).toThrow(/duplicated/i);
    expect(() =>
      prepareDiagnosticData({
        definition: compiled,
        losses: [],
        exposures: [],
        filter: { origins: ["unknown"] },
      }),
    ).toThrow(/Unknown origin/i);

    const rows = [
      { ...aggregate("r1", "2023"), origin: "2023", valuation: "2023" },
      { ...aggregate("r2", "2024"), origin: "2024", valuation: "2024" },
    ];
    const left = prepareDiagnosticData({
      definition: compiled,
      losses: rows,
      exposures: [],
      filter: { origins: ["2024", "2023", "2024"] },
    });
    const right = prepareDiagnosticData({
      definition: compiled,
      losses: [...rows].reverse(),
      exposures: [],
      filter: { origins: ["2023", "2024"] },
    });
    expect(left.preparationFingerprint).toBe(right.preparationFingerprint);
    expect(left.filter?.origins).toEqual(["FY23", "FY24"]);
  });

  it("rejects unknown source groups while preserving explicit select-nothing", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const input = {
      definition: compiled,
      losses: [aggregate("r1")],
      exposures: [],
    };
    expect(() =>
      prepareDiagnosticData({
        ...input,
        filter: { sourceGroups: ["missing"] },
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "unknown-reference",
            path: "$.filter.sourceGroups[0]",
          }),
        ],
      }),
    );
    expect(() =>
      prepareDiagnosticData({
        ...input,
        completePeriodCutoffs: [
          {
            sourceGroup: "missing",
            originThrough: "2024",
            valuationThrough: "2024",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "unknown-reference",
            path: "$.completePeriodCutoffs[0].sourceGroup",
          }),
        ],
      }),
    );
    expect(
      prepareDiagnosticData({ ...input, filter: { sourceGroups: [] } }).cells,
    ).toEqual([]);
  });
});
