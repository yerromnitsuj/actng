import { afterEach, describe, expect, it, vi } from "vitest";
import * as canonical from "../src/canonical.js";
import {
  compileDiagnosticDefinition,
  getCompactPreparedDiagnosticDataFingerprint,
  prepareDiagnosticData,
  prepareDiagnosticDataCompact,
  type DiagnosticDefinition,
  type DiagnosticInputAuditRecord,
  type DiagnosticLossInput,
  type PrepareDiagnosticDataInput,
} from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

function definition(): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: "audit-sort",
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
        missing: "unknown",
        countPopulationId: "claims",
      },
      {
        id: "nights",
        displayName: "Nights",
        description: "Nights",
        source: "exposure",
        kind: "exposure",
        unit: "night",
        developmentSemantics: "cumulative",
        aggregation: "sum",
        missing: "unknown",
        exposureBasisId: "nights",
        exposureTiming: "origin-static",
      },
    ],
    countPopulations: [
      {
        id: "claims",
        displayName: "Claims",
        description: "Claims",
        subject: "claim",
        unit: "claim",
      },
    ],
    exposureBases: [
      {
        id: "nights",
        displayName: "Nights",
        description: "Nights",
        basis: "earned",
        unit: "night",
      },
    ],
    amountBases: [],
    derivedMeasures: [],
    formulas: [],
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

function input(): PrepareDiagnosticDataInput {
  const groups = ["a", "b", "c"];
  const losses: DiagnosticLossInput[] = Array.from(
    { length: 40 },
    (_, index) => ({
      rowType: "aggregate",
      recordId: `record-${index}`,
      sourceGroup: groups[index % groups.length]!,
      origin:
        index === 0
          ? "invalid-year"
          : String(2020 + Math.floor(index / groups.length)),
      valuation: String(2020 + Math.floor(index / groups.length) + (index % 2)),
      complete: true,
      measures: {
        claims: index % 7 === 0 ? Number.NaN : index % 5 === 0 ? null : index,
      },
      source: {
        artifactId: "losses",
        sourceRow: index % 2 === 0 ? 10 : 2,
        sourceCell: `A\\\"🧮${index}`,
      },
    }),
  );
  return {
    definition: compileDiagnosticDefinition(definition()),
    losses: losses.reverse(),
    exposures: Array.from({ length: 18 }, (_, index) => ({
      key: `exposure-${index}`,
      sourceGroup: groups[index % groups.length]!,
      origin: String(2020 + Math.floor(index / groups.length)),
      measureId: "nights",
      value: index % 3 === 0 ? null : index * 100,
      complete: true,
      source: { artifactId: "exposures", sourceRow: index + 2 },
    })).reverse(),
    expectedCells: groups.map((sourceGroup) => ({
      sourceGroup,
      origin: "2021",
      valuation: "2021",
      source: { artifactId: "expected" },
    })),
    filter: { sourceGroups: ["a", "b"], maxDevelopmentAge: 12 },
    completePeriodCutoffs: [
      { sourceGroup: "a", originThrough: null, valuationThrough: "2025" },
    ],
  };
}

/** Frozen reference comparator: keep canonical text, not a semantic field sort. */
function previousComparator(
  left: DiagnosticInputAuditRecord,
  right: DiagnosticInputAuditRecord,
): number {
  const rank = { loss: 0, exposure: 1, "expected-cell": 2 };
  const disposition = {
    invalid: 0,
    "complete-period-cutoff": 1,
    filter: 2,
    retained: 3,
  };
  if (rank[left.kind] !== rank[right.kind])
    return rank[left.kind] - rank[right.kind];
  const a = canonical.canonicalJson(left.record);
  const b = canonical.canonicalJson(right.record);
  return (
    (a < b ? -1 : a > b ? 1 : 0) ||
    disposition[left.disposition] - disposition[right.disposition]
  );
}

describe("invocation-local audit sort keys", () => {
  it.each([prepareDiagnosticData, prepareDiagnosticDataCompact])(
    "serializes each compared audit record once and retains exact previous order",
    (prepare) => {
      const authored = input();
      const serialize = vi.spyOn(canonical, "canonicalJson");
      const prepared = prepare(authored);
      const records = new Set(prepared.inputAudit.map((item) => item.record));
      const calls = serialize.mock.calls
        .map(([value]) => value)
        .filter((value) =>
          records.has(value as DiagnosticInputAuditRecord["record"]),
        );
      expect(calls.length).toBe(records.size);
      expect(new Set(calls).size).toBe(calls.length);
      serialize.mockRestore();
      expect(
        [...prepared.inputAudit].reverse().sort(previousComparator),
      ).toEqual(prepared.inputAudit);
      expect(prepared.inputAudit).toHaveLength(61);
      expect(
        new Set(prepared.inputAudit.map((item) => item.disposition)),
      ).toEqual(
        new Set(["invalid", "complete-period-cutoff", "filter", "retained"]),
      );
    },
  );

  it("does not serialize records when kind ordering alone resolves comparisons", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const serialize = vi.spyOn(canonical, "canonicalJson");
    const prepared = prepareDiagnosticDataCompact({
      definition: compiled,
      losses: [
        {
          rowType: "aggregate",
          recordId: "r",
          sourceGroup: "a",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: { claims: 1 },
        },
      ],
      exposures: [
        {
          key: "e",
          sourceGroup: "a",
          origin: "2024",
          measureId: "nights",
          value: 10,
          complete: true,
        },
      ],
      expectedCells: [{ sourceGroup: "a", origin: "2024", valuation: "2024" }],
    });
    const records = new Set(prepared.inputAudit.map((item) => item.record));
    expect(
      serialize.mock.calls.some(([value]) =>
        records.has(value as DiagnosticInputAuditRecord["record"]),
      ),
    ).toBe(false);
  });

  it("keeps stable ties including runtime negative-zero source rows", () => {
    const compiled = compileDiagnosticDefinition(definition());
    const losses: DiagnosticLossInput[] = [-0, 0, -0].map((sourceRow) => ({
      rowType: "aggregate",
      recordId: "duplicate",
      sourceGroup: "a",
      origin: "2024",
      valuation: "2024",
      complete: true,
      measures: { claims: 1 },
      source: { artifactId: "losses", sourceRow },
    }));
    const prepared = prepareDiagnosticDataCompact({
      definition: compiled,
      losses,
      exposures: [],
    });
    expect(
      prepared.inputAudit.map((item) =>
        Object.is(item.record.source!.sourceRow, -0),
      ),
    ).toEqual([true, false, true]);
  });

  it("does not retain keys across preparations or alter full preparation fingerprints", () => {
    const authored = input();
    const first = prepareDiagnosticDataCompact(authored);
    const serialize = vi.spyOn(canonical, "canonicalJson");
    const second = prepareDiagnosticDataCompact(authored);
    const records = new Set(second.inputAudit.map((item) => item.record));
    expect(
      serialize.mock.calls.filter(([value]) =>
        records.has(value as DiagnosticInputAuditRecord["record"]),
      ),
    ).toHaveLength(records.size);
    serialize.mockRestore();
    expect(getCompactPreparedDiagnosticDataFingerprint(first)).toBe(
      getCompactPreparedDiagnosticDataFingerprint(second),
    );
    expect(getCompactPreparedDiagnosticDataFingerprint(first)).toBe(
      prepareDiagnosticData(authored).preparationFingerprint,
    );
  });
});
