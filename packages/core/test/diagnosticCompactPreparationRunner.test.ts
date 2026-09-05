import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as canonical from "../src/canonical.js";
import * as identity from "../src/diagnosticIdentity.js";
import {
  CASUALTY_FORMULA_TEMPLATES,
  DiagnosticValidationError,
  assertCompactMetricDiagnosticsResult,
  assertCompactPreparedDiagnosticData,
  assertPreparedDiagnosticData,
  commonMaturity,
  commonMaturityCompact,
  compareDiagnosticIdentityDocuments,
  compileDiagnosticDefinition,
  fingerprintDiagnosticIdentity,
  getCompactMetricDiagnosticsResultIdentityDocument,
  getCompactPreparedDiagnosticDataFingerprint,
  getCompactPreparedDiagnosticDataIdentityDocument,
  getMetricDiagnosticsResultIdentity,
  getPreparedDiagnosticDataIdentity,
  iterateDiagnosticIdentityJson,
  materializeMetricDiagnosticsResult,
  materializePreparedDiagnosticData,
  prepareDiagnosticData,
  prepareDiagnosticDataCompact,
  runMetricDiagnostics,
  runMetricDiagnosticsCompact,
  sameMaturity,
  sameMaturityCompact,
  validateCompactDiagnosticGroupingConfiguration,
  validateDiagnosticGroupingConfiguration,
  type DiagnosticDefinition,
  type DiagnosticDeepReadonly,
  type DiagnosticEmergencePoint,
  type DiagnosticLossInput,
  type CommonMaturityResult,
  type MetricDiagnosticsResult,
  type PrepareDiagnosticDataInput,
} from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

function definition(): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: "compact-parity",
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
    formulas: [
      CASUALTY_FORMULA_TEMPLATES.find((item) => item.id === "frequency")!,
    ],
    instances: [
      {
        id: "frequency",
        version: "1",
        formulaId: "frequency",
        bindings: {
          claims: { op: "measure", measureId: "claims" },
          exposure: { op: "measure", measureId: "nights" },
        },
        presentation: {
          displayName: "Frequency",
          description: "Claims per night",
          displayUnit: "claims per 100 nights",
          scale: 100,
          numeratorLabel: "Claims",
          denominatorLabel: "Nights",
        },
        rules: [],
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

function row(
  recordId: string,
  sourceGroup: string,
  valuation: string,
  claims: number | null,
): DiagnosticLossInput {
  return {
    rowType: "aggregate",
    recordId,
    sourceGroup,
    origin: "2024",
    valuation,
    complete: true,
    measures: { claims },
    source: { artifactId: "losses", sourceRow: 2 },
  };
}

function input(): PrepareDiagnosticDataInput {
  return {
    definition: compileDiagnosticDefinition(definition()),
    losses: [
      row("a1", "a", "2024", 2),
      row("a2", "a", "2025", 4),
      row("b1", "b", "2024", 8),
    ],
    exposures: [
      {
        key: "a",
        sourceGroup: "a",
        origin: "2024",
        measureId: "nights",
        value: 100,
        complete: true,
        source: { artifactId: "exposures", sourceRow: 2 },
      },
      {
        key: "b",
        sourceGroup: "b",
        origin: "2024",
        measureId: "nights",
        value: 300,
        complete: true,
        source: { artifactId: "exposures", sourceRow: 3 },
      },
    ],
  };
}

describe("compact diagnostic preparation and runner", () => {
  it("defers every identity projection and hash during preparation and calculation", () => {
    const authored = input();
    const projection = vi.spyOn(identity, "projectDiagnosticIdentity");
    const hash = vi.spyOn(canonical, "fnv1a64");
    const streamingHash = vi.spyOn(canonical, "canonicalFnv1a64");
    const compact = prepareDiagnosticDataCompact(authored);
    const result = runMetricDiagnosticsCompact({ prepared: compact });
    expect(projection).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(streamingHash).not.toHaveBeenCalled();
    for (const value of [compact, result]) {
      expect(Object.hasOwn(value, "preparationFingerprint")).toBe(false);
      expect(Object.hasOwn(value, "identityBody")).toBe(false);
      expect(Object.isFrozen(value)).toBe(true);
      for (const descriptor of Object.values(
        Object.getOwnPropertyDescriptors(value),
      ))
        expect("value" in descriptor).toBe(true);
    }
    expect(compact.inputAudit).toHaveLength(5);
    expect(compact.cells).toHaveLength(3);
    expect(result.emergence).toHaveLength(3);
  });

  it("materializes exactly the legacy preparation, identities, numeric views, and aliases", () => {
    const authored = input();
    const legacy = prepareDiagnosticData(authored);
    const compact = prepareDiagnosticDataCompact(authored);
    const eager = materializePreparedDiagnosticData(compact);
    expect(JSON.stringify(eager)).toBe(JSON.stringify(legacy));
    expect(getPreparedDiagnosticDataIdentity(eager)).toEqual(
      getPreparedDiagnosticDataIdentity(legacy),
    );
    expect(eager.cells).toBe(compact.cells);
    expect(eager.inputAudit).toBe(compact.inputAudit);
    const compactResult = runMetricDiagnosticsCompact({ prepared: compact });
    const eagerResult = materializeMetricDiagnosticsResult(compactResult);
    const legacyResult = runMetricDiagnostics({ prepared: legacy });
    expect(JSON.stringify(eagerResult)).toBe(JSON.stringify(legacyResult));
    expect(getMetricDiagnosticsResultIdentity(eagerResult)).toEqual(
      getMetricDiagnosticsResultIdentity(legacyResult),
    );
    expect(eagerResult.emergence).toBe(compactResult.emergence);
    expect(eagerResult.triangles).toBe(compactResult.triangles);
    expect(eagerResult.latestDiagonal[0]).toBe(compactResult.latestDiagonal[0]);
    expect(sameMaturityCompact(compactResult, 12)).toEqual(
      sameMaturity(legacyResult, 12),
    );
    expect(commonMaturityCompact(compactResult, ["a", "b"])).toEqual(
      commonMaturity(legacyResult, ["a", "b"]),
    );
    expect(Object.hasOwn(compact, "preparationFingerprint")).toBe(false);
    expect(Object.hasOwn(compactResult, "preparationFingerprint")).toBe(false);
  });

  it("preserves the exact eager maturity function contracts alongside compact helpers", () => {
    expectTypeOf<typeof sameMaturity>().toEqualTypeOf<
      (
        result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
        developmentAge: number,
        outputGroups?: readonly string[],
      ) => readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[]
    >();
    expectTypeOf<typeof commonMaturity>().toEqualTypeOf<
      (
        result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
        outputGroups: readonly string[],
      ) => DiagnosticDeepReadonly<CommonMaturityResult>
    >();
    const authored = input();
    const prepared = prepareDiagnosticData(authored);
    const result = runMetricDiagnostics({ prepared });
    const compact = runMetricDiagnosticsCompact({
      prepared: prepareDiagnosticDataCompact(authored),
    });
    for (const groups of [undefined, [], ["b", "a", "b"]]) {
      for (const age of [0, 12, 24, 999])
        expect(sameMaturityCompact(compact, age, groups)).toEqual(
          sameMaturity(result, age, groups),
        );
      if (groups !== undefined)
        expect(commonMaturityCompact(compact, groups)).toEqual(
          commonMaturity(result, groups),
        );
    }
    expect(result.preparationFingerprint).toBe(prepared.preparationFingerprint);
    expect(Object.hasOwn(compact, "preparationFingerprint")).toBe(false);
    expect(() => sameMaturityCompact(compact, -1)).toThrow(
      /nonnegative safe integer/,
    );
    expect(() => sameMaturityCompact(compact, 12, ["missing"])).toThrow(
      /Unknown output group/,
    );
    expect(() => commonMaturityCompact(compact, [" "])).toThrow(
      /nonempty token/,
    );
  });

  it("authenticates compact values separately and rejects structural copies", () => {
    const authored = input();
    const compact = prepareDiagnosticDataCompact(authored);
    const legacy = prepareDiagnosticData(authored);
    expect(() => assertCompactPreparedDiagnosticData(compact)).not.toThrow();
    expect(() => assertPreparedDiagnosticData(compact)).toThrow();
    expect(() => assertCompactPreparedDiagnosticData(legacy)).toThrow();
    for (const forged of [{ ...compact }, structuredClone(compact), legacy]) {
      expect(() =>
        materializePreparedDiagnosticData(forged as never),
      ).toThrow();
      expect(() =>
        runMetricDiagnosticsCompact({ prepared: forged as never }),
      ).toThrow();
    }
    const result = runMetricDiagnosticsCompact({ prepared: compact });
    expect(() => assertCompactMetricDiagnosticsResult(result)).not.toThrow();
    for (const forged of [
      { ...result },
      structuredClone(result),
      runMetricDiagnostics({ prepared: legacy }),
    ])
      expect(() =>
        materializeMetricDiagnosticsResult(forged as never),
      ).toThrow();
  });

  it("retains every excluded audit row and exact expected-grid/cutoff semantics", () => {
    const authored = {
      ...input(),
      filter: { sourceGroups: ["a"] },
      completePeriodCutoffs: [
        { sourceGroup: "a", originThrough: null, valuationThrough: "2024" },
      ],
      expectedCells: [
        { sourceGroup: "a", origin: "2024", valuation: "2024" },
        { sourceGroup: "a", origin: "2024", valuation: "2025" },
      ],
    };
    const compact = prepareDiagnosticDataCompact(authored);
    const legacy = prepareDiagnosticData(authored);
    expect(compact.inputAudit).toHaveLength(7);
    expect(compact.cells).toHaveLength(1);
    expect(compact.expectedCellsProvided).toBe(true);
    expect(
      compact.inputAudit.some((item) => item.disposition === "filter"),
    ).toBe(true);
    expect(
      compact.inputAudit.some(
        (item) => item.disposition === "complete-period-cutoff",
      ),
    ).toBe(true);
    expect(materializePreparedDiagnosticData(compact)).toEqual(legacy);
    const absent = prepareDiagnosticDataCompact(input());
    const empty = prepareDiagnosticDataCompact({
      ...input(),
      expectedCells: [],
    });
    expect(
      materializePreparedDiagnosticData(absent).preparationFingerprint,
    ).not.toBe(materializePreparedDiagnosticData(empty).preparationFingerprint);
  });

  it.each([null, 0, -1, -0])(
    "preserves null results for denominator %s",
    (value) => {
      const base = input();
      const authored = {
        ...base,
        losses: [base.losses[0]!],
        exposures: [{ ...base.exposures[0]!, value }],
      };
      const compact = runMetricDiagnosticsCompact({
        prepared: prepareDiagnosticDataCompact(authored),
      });
      const legacy = runMetricDiagnostics({
        prepared: prepareDiagnosticData(authored),
      });
      expect(
        compact.emergence[0]!.metrics.frequency!.calculation.value,
      ).toBeNull();
      expect(materializeMetricDiagnosticsResult(compact)).toEqual(legacy);
    },
  );

  it("uses weighted sum/sum groups and identical grouping boundary errors", () => {
    const authored = input();
    const compact = prepareDiagnosticDataCompact(authored);
    const legacy = prepareDiagnosticData(authored);
    const groupMap = { a: "all", b: "all" };
    const result = runMetricDiagnosticsCompact({ prepared: compact, groupMap });
    expect(result.emergence[0]!.metrics.frequency!.calculation.value).toBe(
      10 / 400,
    );
    expect(result.emergence[0]!.metrics.frequency!.presentation.value).toBe(
      2.5,
    );
    expect(materializeMetricDiagnosticsResult(result)).toEqual(
      runMetricDiagnostics({ prepared: legacy, groupMap }),
    );
    const issues = (action: () => unknown) => {
      try {
        action();
        throw new Error("Expected invalid configuration");
      } catch (error) {
        expect(error).toBeInstanceOf(DiagnosticValidationError);
        return (error as DiagnosticValidationError).issues;
      }
    };
    expect(
      issues(() =>
        validateCompactDiagnosticGroupingConfiguration({
          prepared: compact,
          groupMap: { unused: "all" },
        }),
      ),
    ).toEqual(
      issues(() =>
        validateDiagnosticGroupingConfiguration({
          prepared: legacy,
          groupMap: { unused: "all" },
        }),
      ),
    );
  });

  it("owns complete immutable snapshots without freezing caller records", () => {
    const authored = input();
    const compact = prepareDiagnosticDataCompact(authored);
    const baseline = JSON.stringify(compact);
    expect(Object.isFrozen(authored.losses[0]!.measures)).toBe(false);
    (authored.losses[0]!.measures as Record<string, number>).claims = 999;
    (authored.losses[0]!.source as { sourceRow: number }).sourceRow = 999;
    (authored.exposures[0] as { value: number }).value = 999;
    expect(JSON.stringify(compact)).toBe(baseline);
    expect(Object.isFrozen(compact.cells[0]!.contributions.claims)).toBe(true);
    expect(() =>
      (compact.cells[0]!.contributions.claims as unknown[]).push({}),
    ).toThrow();
  });

  it("preserves the exact legacy malformed-input boundary errors", () => {
    const base = input();
    const authored = {
      ...base,
      losses: [{ ...base.losses[0]!, measures: { claims: "invalid" } }],
    } as unknown as PrepareDiagnosticDataInput;
    const failures: unknown[] = [];
    for (const prepare of [
      prepareDiagnosticData,
      prepareDiagnosticDataCompact,
    ]) {
      try {
        prepare(authored);
        throw new Error("Expected invalid input");
      } catch (error) {
        expect(error).toBeInstanceOf(DiagnosticValidationError);
        failures.push((error as DiagnosticValidationError).issues);
      }
    }
    expect(failures[1]).toEqual(failures[0]);
  });

  it.each([prepareDiagnosticData, prepareDiagnosticDataCompact])(
    "owns optional sources on every record family without freezing caller sources",
    (prepare) => {
      const base = input();
      const expectedSource = { artifactId: "expected", sourceRow: 4 };
      const authored = {
        ...base,
        expectedCells: [
          {
            sourceGroup: "a",
            origin: "2024",
            valuation: "2024",
            source: expectedSource,
          },
        ],
      };
      const prepared = prepare(authored);
      const before = JSON.stringify(prepared);
      for (const source of [
        authored.losses[0]!.source!,
        authored.exposures[0]!.source!,
        expectedSource,
      ]) {
        expect(Object.isFrozen(source)).toBe(false);
        (source as { sourceRow: number }).sourceRow = 900;
      }
      expect(JSON.stringify(prepared)).toBe(before);
      expect(Object.isFrozen(prepared.expectedCells[0]!.source)).toBe(true);
    },
  );

  it("keeps authentic runs and explicit materializations isolated across calls", () => {
    const base = input();
    const first = prepareDiagnosticDataCompact(base);
    const second = prepareDiagnosticDataCompact(base);
    expect(first).not.toBe(second);
    expect(first.cells).not.toBe(second.cells);
    const firstResult = runMetricDiagnosticsCompact({ prepared: first });
    const secondResult = runMetricDiagnosticsCompact({ prepared: second });
    const firstEager = materializePreparedDiagnosticData(first);
    const secondEager = materializePreparedDiagnosticData(first);
    expect(firstEager).not.toBe(secondEager);
    expect(getPreparedDiagnosticDataIdentity(firstEager)).not.toBe(
      getPreparedDiagnosticDataIdentity(secondEager),
    );
    expect(firstEager.preparationFingerprint).toBe(
      secondEager.preparationFingerprint,
    );
    expect(materializeMetricDiagnosticsResult(firstResult)).toEqual(
      materializeMetricDiagnosticsResult(secondResult),
    );
    expect(() =>
      assertCompactPreparedDiagnosticData(Object.create(first)),
    ).toThrow();
    expect(() =>
      assertCompactMetricDiagnosticsResult(Object.create(firstResult)),
    ).toThrow();
  });

  it.each(["eager", "compact"] as const)(
    "%s results own each group's opaque dimensions without changing their values",
    (mode) => {
      const authored = input();
      const source = { artifactId: "opaque", sourceRow: -3, extra: true };
      const metadata = Object.assign(Object.create(null), {
        z: -0,
        source,
        sameSource: source,
        values: [null, 1],
      });
      Object.defineProperty(metadata, "__proto__", {
        value: "ordinary data",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const groupDimensions = { all: metadata };
      const result =
        mode === "eager"
          ? runMetricDiagnostics({
              prepared: prepareDiagnosticData(authored),
              groupMap: { a: "all", b: "all" },
              groupDimensions,
            })
          : runMetricDiagnosticsCompact({
              prepared: prepareDiagnosticDataCompact(authored),
              groupMap: { a: "all", b: "all" },
              groupDimensions,
            });
      const stored = result.emergence[0]!.dimensions as typeof metadata;
      expect(stored).not.toBe(metadata);
      expect(result.emergence[1]!.dimensions).toBe(stored);
      expect(Object.getPrototypeOf(stored)).toBeNull();
      expect(Object.keys(stored)).toEqual(Object.keys(metadata));
      expect(Object.is(stored.z, -0)).toBe(true);
      expect(stored.__proto__).toBe("ordinary data");
      expect(stored.source).toEqual(source);
      expect(stored.sameSource).toBe(stored.source);
      expect(Object.isFrozen(metadata)).toBe(false);
      expect(Object.isFrozen(source)).toBe(false);
      const before = JSON.stringify(result);
      source.sourceRow = 999;
      metadata.values.push(2);
      metadata.z = 9;
      expect(JSON.stringify(result)).toBe(before);
      expect(Object.isFrozen(stored.source)).toBe(true);
    },
  );

  it("streams every preparation identity byte and the unchanged legacy tag", () => {
    const base = input();
    const authored = {
      ...base,
      losses: [...base.losses, row("non-finite", "a", "2026", Number.NaN)],
      expectedCells: [
        { sourceGroup: "a", origin: "2024", valuation: "2024" },
        {
          sourceGroup: "b",
          origin: "2024",
          valuation: "2024",
          source: { artifactId: "expected", sourceRow: -0 },
        },
      ],
    };
    const legacy = prepareDiagnosticData(authored);
    const compact = prepareDiagnosticDataCompact(authored);
    const document = getCompactPreparedDiagnosticDataIdentityDocument(compact);
    const chunks = [...iterateDiagnosticIdentityJson(document)];
    expect(chunks.join("")).toBe(
      canonical.canonicalJson(getPreparedDiagnosticDataIdentity(legacy)),
    );
    expect(getCompactPreparedDiagnosticDataFingerprint(compact)).toBe(
      legacy.preparationFingerprint,
    );
    expect(
      fingerprintDiagnosticIdentity(document, {
        kind: "diagnostic-preparation",
        property: "preparation",
      }),
    ).toBe(legacy.preparationFingerprint);
    expect(getCompactPreparedDiagnosticDataIdentityDocument(compact)).toBe(
      document,
    );
    expect([...iterateDiagnosticIdentityJson(document)]).toEqual(chunks);
    expect(Object.hasOwn(compact, "preparationFingerprint")).toBe(false);
    const other = getCompactPreparedDiagnosticDataIdentityDocument(
      prepareDiagnosticDataCompact(authored),
    );
    expect(compareDiagnosticIdentityDocuments(document, other)).toEqual({
      equal: true,
    });
  });

  it("streams the unchanged result identity including opaque dimension values", () => {
    const authored = input();
    const groupMap = { a: "all", b: "all" };
    const groupDimensions = {
      all: {
        source: { artifactId: "opaque", sourceRow: -3, custom: true },
        z: -0,
      },
    };
    const legacy = runMetricDiagnostics({
      prepared: prepareDiagnosticData(authored),
      groupMap,
      groupDimensions,
    });
    const compact = runMetricDiagnosticsCompact({
      prepared: prepareDiagnosticDataCompact(authored),
      groupMap,
      groupDimensions,
    });
    const document = getCompactMetricDiagnosticsResultIdentityDocument(compact);
    const expected = getMetricDiagnosticsResultIdentity(legacy);
    expect([...iterateDiagnosticIdentityJson(document)].join("")).toBe(
      canonical.canonicalJson(expected),
    );
    expect(
      fingerprintDiagnosticIdentity(document, {
        kind: "diagnostic-result",
        property: "result",
      }),
    ).toBe(
      `fnv1a64-jcs-v1:${canonical.fnv1a64(
        canonical.canonicalJson({
          identityVersion: 1,
          kind: "diagnostic-result",
          result: expected,
        }),
      )}`,
    );
    expect(getCompactMetricDiagnosticsResultIdentityDocument(compact)).toBe(
      document,
    );
    expect(Object.hasOwn(compact, "preparationFingerprint")).toBe(false);
    expect(() =>
      getCompactMetricDiagnosticsResultIdentityDocument({ ...compact }),
    ).toThrow();
    expect(() =>
      getCompactPreparedDiagnosticDataIdentityDocument({
        ...prepareDiagnosticDataCompact(authored),
      }),
    ).toThrow();
  });
});
