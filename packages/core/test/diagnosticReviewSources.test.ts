import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  evaluateDiagnosticReviewRules,
  evaluateDiagnosticReviewRulesCompact,
  getCompactDiagnosticReviewEvaluationsIdentityDocument,
  getDiagnosticReviewEvaluation,
  iterateDiagnosticIdentityJson,
  iterateDiagnosticReviewEvaluations,
  normalizeDiagnosticSourceLocations,
  pageDiagnosticReviewEvaluationSources,
  prepareDiagnosticData,
  prepareDiagnosticDataCompact,
  projectDiagnosticIdentity,
  type DiagnosticReviewRuleEvaluation,
  type DiagnosticSourceLocation,
  type PrepareDiagnosticDataInput,
} from "../src/index.js";
import * as sourceOrdering from "../src/diagnosticSourceOrdering.js";
import { createDiagnosticReviewSourcePool } from "../src/diagnosticReviewSources.js";
import { createCompactReviewBuilder } from "../src/diagnosticReviewStore.js";
import { compactReviewFixture } from "./helpers/compactReview.js";

function exactParity(input: PrepareDiagnosticDataInput) {
  const expected = evaluateDiagnosticReviewRules(prepareDiagnosticData(input));
  const store = evaluateDiagnosticReviewRulesCompact(
    prepareDiagnosticDataCompact(input),
  );
  const actual = [...iterateDiagnosticReviewEvaluations(store)];
  expect(actual).toEqual(expected);
  expect(canonicalJson(actual)).toBe(canonicalJson(expected));
  expect(
    [...iterateDiagnosticIdentityJson(
      getCompactDiagnosticReviewEvaluationsIdentityDocument(store),
    )].join(""),
  ).toBe(canonicalJson(projectDiagnosticIdentity(expected)));
  for (const [index, row] of actual.entries()) {
    for (const overflowIndex of [
      undefined,
      ...row.expressionOverflows.map((_, i) => i),
    ]) {
      const sources = overflowIndex === undefined
        ? row.scope.sources
        : row.expressionOverflows[overflowIndex]!.sources;
      const reconstructed: DiagnosticSourceLocation[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = pageDiagnosticReviewEvaluationSources(store, index, {
          offset,
          limit: 3,
          ...(overflowIndex === undefined ? {} : { overflowIndex }),
        });
        expect(page.total).toBe(sources.length);
        reconstructed.push(...page.items);
        offset = page.nextOffset;
      }
      expect(reconstructed).toEqual(sources);
    }
  }
  return { expected, actual, store };
}

describe("invocation-owned compact review source evidence", () => {
  it("normalizes complete source values once and keeps exact extra own data", () => {
    const nested = Object.freeze({ signedZero: -0, text: "🧮 e\u0301 é \\\" | ," });
    const sources = [
      { artifactId: "same", sourceRow: 10, sourceFile: "loss.csv", extra: nested },
      { artifactId: "same", sourceRow: 2, sourceFile: "loss.csv", extra: nested },
      { artifactId: "same", sourceRow: -0, extra: "first" },
      { artifactId: "same", sourceRow: 0, extra: "first" },
      { artifactId: "same", sourceRow: 0, extra: "different" },
      { artifactId: "same", sourceRow: 2, sourceSheet: "a", sourceCell: "A2" },
      { artifactId: "same", sourceRow: 2, sourceSheet: "b", sourceCell: "A2" },
      { artifactId: "same", sourceRow: 2, sourceSheet: "b", sourceCell: "B2" },
      { artifactId: "same" },
    ].map((source) => Object.freeze(source));
    const expected = normalizeDiagnosticSourceLocations(sources);
    const pool = createDiagnosticReviewSourcePool();
    const normalizer = vi.spyOn(
      sourceOrdering,
      "normalizeDiagnosticSourceLocations",
    );
    try {
      const first = pool.forPreparedSources(sources);
      const second = pool.forPreparedSources([...sources]);
      expect(normalizer).toHaveBeenCalledTimes(sources.length);
      expect(first).toEqual(expected);
      expect(canonicalJson(first)).toBe(canonicalJson(expected));
      expect(first).toHaveLength(sources.length - 1);
      expect(first.every((source) => !Object.is(source.sourceRow, -0))).toBe(true);
      const withExtra = first.find(
        (source) => "extra" in source && typeof source.extra === "object",
      );
      expect(withExtra && "extra" in withExtra ? withExtra.extra : undefined)
        .toBe(nested);
      expect(pool.union([first, second])).toEqual(expected);
      expect(normalizer).toHaveBeenCalledTimes(sources.length);
      expect(second.every((source, index) => source === first[index])).toBe(true);
      expect(pool.ownsList(first)).toBe(true);
      expect(first.every(Object.isFrozen)).toBe(true);
      const other = createDiagnosticReviewSourcePool();
      expect(other.ownsList(first)).toBe(false);
      expect(other.sourceKey(first[0]!)).toBeUndefined();
      expect(other.forPreparedSources(sources)[0]).not.toBe(first[0]);
    } finally {
      normalizer.mockRestore();
    }
  });

  it("does not mistake frozen foreign arrays or shallow-frozen sources for ownership", () => {
    const pool = createDiagnosticReviewSourcePool();
    const metadata = { note: "before" };
    const source = Object.freeze({ artifactId: "foreign", metadata });
    const foreign = Object.freeze([source]);
    const first = pool.union([foreign]);
    expect(pool.ownsList(foreign)).toBe(false);
    expect(pool.ownsList(first)).toBe(false);
    expect(pool.sourceKey(source)).toBeUndefined();
    expect(pool.sourceKey(first[0]!)).toBeUndefined();
    metadata.note = "after";
    expect(pool.union([foreign])).toEqual(
      normalizeDiagnosticSourceLocations(foreign),
    );
    expect(pool.union([foreign])[0]).not.toBe(first[0]);
  });

  it("preserves each union's first representative when extra -0/+0 canonical keys match", () => {
    const negative = Object.freeze({
      artifactId: "loss",
      metadata: Object.freeze({ signedZero: -0 }),
    });
    const positive = Object.freeze({
      artifactId: "loss",
      metadata: Object.freeze({ signedZero: 0 }),
    });
    const pool = createDiagnosticReviewSourcePool();
    const negativeList = pool.forPreparedSources([negative]);
    const positiveList = pool.forPreparedSources([positive]);
    for (const [input, lists] of [
      [[negative, positive], [negativeList, positiveList]],
      [[positive, negative], [positiveList, negativeList]],
    ] as const) {
      const result = pool.union(lists);
      expect(result).toEqual(normalizeDiagnosticSourceLocations(input));
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(lists[0][0]);
    }
  });

  it("reuses authenticated list IDs, including high-fanout lists, only for their owner", () => {
    const prepared = prepareDiagnosticData(compactReviewFixture());
    const original = evaluateDiagnosticReviewRules(prepared)[0]!;
    const pool = createDiagnosticReviewSourcePool();
    const sources = pool.forPreparedSources(
      Array.from({ length: 130 }, (_, i) =>
        Object.freeze({ artifactId: "loss", sourceFile: "loss.csv", sourceRow: i }),
      ),
    );
    const sourceKey = vi.fn(pool.sourceKey);
    const builder = createCompactReviewBuilder(
      prepared.definition.definition.reviewRules,
      { sourceKey, ownsList: pool.ownsList },
    );
    const row = {
      ...original,
      scope: { ...original.scope, sources },
    } as DiagnosticReviewRuleEvaluation;
    builder.append(row);
    builder.append(row);
    expect(sourceKey).toHaveBeenCalledTimes(130);
    const store = builder.finish();
    expect(getDiagnosticReviewEvaluation(store, 0).scope.sources).toEqual(sources);
    expect(getDiagnosticReviewEvaluation(store, 1).scope.sources).toEqual(sources);
    const other = createDiagnosticReviewSourcePool();
    const foreignKey = vi.fn(other.sourceKey);
    const otherBuilder = createCompactReviewBuilder(
      prepared.definition.definition.reviewRules,
      { sourceKey: foreignKey, ownsList: other.ownsList },
    );
    otherBuilder.append(row);
    otherBuilder.append(row);
    expect(foreignKey).toHaveBeenCalledTimes(260);
    expect(
      getDiagnosticReviewEvaluation(otherBuilder.finish(), 1).scope.sources,
    ).toEqual(sources);
  });

  it("re-reads mutable items inside an unowned frozen list during column construction", () => {
    const prepared = prepareDiagnosticData(compactReviewFixture());
    const original = evaluateDiagnosticReviewRules(prepared)[0]!;
    const mutable = { artifactId: "loss", sourceRow: 10 };
    const sources = Object.freeze([mutable]);
    const pool = createDiagnosticReviewSourcePool();
    const builder = createCompactReviewBuilder(
      prepared.definition.definition.reviewRules,
      pool,
    );
    const row = {
      ...original,
      scope: { ...original.scope, sources },
    } as DiagnosticReviewRuleEvaluation;
    builder.append(row);
    mutable.sourceRow = 71;
    builder.append(row);
    const store = builder.finish();
    expect(getDiagnosticReviewEvaluation(store, 0).scope.sources[0]!.sourceRow)
      .toBe(10);
    expect(getDiagnosticReviewEvaluation(store, 1).scope.sources[0]!.sourceRow)
      .toBe(71);
  });

  it("preserves all source tuples, numeric ordering and paged high-fanout control evidence", () => {
    const fixture = compactReviewFixture({ groups: 70 });
    const sources = Array.from({ length: fixture.losses.length }, (_, index) => ({
      artifactId: index % 2 ? "🧮-loss" : "loss",
      sourceFile: index % 3 ? 'a|b,"c.csv' : "a.csv",
      ...(index % 4 ? { sourceSheet: index % 5 ? "é" : "e\u0301" } : {}),
      sourceRow: index === 0 ? -0 : index % 7,
      sourceCell: `C${index}`,
    }));
    const { actual } = exactParity({
      ...fixture,
      losses: fixture.losses.map((row, index) => ({
        ...row,
        source: sources[index]!,
      })),
    });
    const control = actual.find((row) => row.ruleKind === "control-total")!;
    expect(control.scope.sources).toEqual(
      normalizeDiagnosticSourceLocations(sources),
    );
    expect(control.scope.sources.length).toBeGreaterThan(64);
  });

  it("retains missing, structural, selection and expression overflow evidence", () => {
    const fixture = compactReviewFixture({
      mixedSources: true,
      gap: true,
      overflow: true,
    });
    const blockedExposure = {
      ...fixture.exposures[0]!,
      value: null,
      source: {
        artifactId: "loss",
        sourceFile: "other.csv",
        sourceSheet: "Other",
        sourceRow: 10,
      },
    };
    const { actual } = exactParity({
      ...fixture,
      exposures: [blockedExposure, ...fixture.exposures.slice(1)],
    });
    expect(actual.some((row) => row.status === "not-evaluated")).toBe(true);
    expect(actual.some((row) =>
      row.notEvaluatedReasons.includes("structural-ambiguity"),
    )).toBe(true);
    expect(actual.some((row) => row.expressionOverflows.length > 0)).toBe(true);
    expect(actual.some((row) => row.scope.sources.some((source) =>
      source.artifactId === "expected",
    ))).toBe(true);
    expect(actual.some((row) => row.scope.sources.some((source) =>
      source.sourceFile === "other.csv",
    ))).toBe(true);
  });

  it("keeps preparation isolation and authentication, without retaining caller mutation", () => {
    const input = compactReviewFixture({ mixedSources: true });
    const expected = evaluateDiagnosticReviewRules(prepareDiagnosticData(input));
    const prepared = prepareDiagnosticDataCompact(input);
    const first = evaluateDiagnosticReviewRulesCompact(prepared);
    const source = input.losses[0]!.source as { sourceRow: number };
    source.sourceRow = 999;
    const second = evaluateDiagnosticReviewRulesCompact(prepared);
    expect([...iterateDiagnosticReviewEvaluations(first)]).toEqual(expected);
    expect([...iterateDiagnosticReviewEvaluations(second)]).toEqual(expected);
    for (const forged of [
      Object.freeze({ ...prepared }),
      Object.create(prepared),
      prepareDiagnosticData(input),
    ])
      expect(() => evaluateDiagnosticReviewRulesCompact(forged)).toThrow(/authentic/);
    expect(() =>
      prepareDiagnosticDataCompact({
        ...input,
        losses: input.losses.map((row) => ({
          ...row,
          source: { ...row.source!, extra: true },
        })),
      }),
    ).toThrow(/source|Unknown key/);
  });
});
