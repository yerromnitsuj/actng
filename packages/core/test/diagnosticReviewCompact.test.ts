import { describe, expect, it, vi } from "vitest";
import * as sourceOrdering from "../src/diagnosticSourceOrdering.js";
import {
  canonicalJson,
  evaluateDiagnosticReviewRules,
  evaluateDiagnosticReviewRulesCompact,
  getDiagnosticReviewEvaluation,
  getDiagnosticReviewEvaluationSummary,
  getCompactDiagnosticReviewEvaluationsIdentityDocument,
  iterateDiagnosticIdentityJson,
  projectDiagnosticIdentity,
  iterateDiagnosticReviewEvaluations,
  pageDiagnosticReviewEvaluations,
  pageDiagnosticReviewEvaluationSources,
  prepareDiagnosticData,
  prepareDiagnosticDataCompact,
} from "../src/index.js";
import {
  assertCompactReviewCapacity,
  createCompactReviewBuilder,
} from "../src/diagnosticReviewStore.js";
import { compactReviewFixture } from "./helpers/compactReview.js";

describe("compact diagnostic review evaluations", () => {
  for (const options of [
    {},
    { nullable: true },
    { overflow: true },
    { gap: true },
    { quarter: true },
    { quarter: true, gap: true, nullable: true },
    { mixedSources: true },
    { mixedSources: true, overflow: true },
    { mixedSources: true, quarter: true, gap: true, nullable: true },
  ]) {
    it(`retains exact old values, sources and order: ${JSON.stringify(options)}`, () => {
      const input = compactReviewFixture(options);
      const old = evaluateDiagnosticReviewRules(prepareDiagnosticData(input));
      const store = evaluateDiagnosticReviewRulesCompact(
        prepareDiagnosticDataCompact(input),
      );
      const rows = [...iterateDiagnosticReviewEvaluations(store)];
      expect(rows).toEqual(old);
      expect(canonicalJson(rows)).toBe(canonicalJson(old));
      expect(
        [
          ...iterateDiagnosticIdentityJson(
            getCompactDiagnosticReviewEvaluationsIdentityDocument(store),
          ),
        ].join(""),
      ).toBe(canonicalJson(projectDiagnosticIdentity(old)));
      expect(store.count).toBe(old.length);
      expect(store.rules.reduce((sum, rule) => sum + rule.count, 0)).toBe(
        store.count,
      );
      expect(
        Object.values(store.summary).reduce((sum, count) => sum + count, 0),
      ).toBe(store.count);
      expect([...iterateDiagnosticReviewEvaluations(store)]).toEqual(rows);
      for (const row of rows) {
        expect(Object.isFrozen(row)).toBe(true);
        expect(Object.isFrozen(row.scope.sources)).toBe(true);
      }
      const control = rows.find((row) => row.ruleKind === "control-total")!;
      expect(control.scope.sources.map((source) => source.sourceRow)).toEqual([
        2, 10,
      ]);
      if (options.overflow) expect(store.summary.fail).toBeGreaterThan(0);
      if (options.mixedSources) {
        const mixed = rows.filter((row) => row.ruleId.startsWith("exposure-"));
        for (const row of mixed) {
          expect(
            row.scope.sources.every(
              (source) => source.artifactId === "exposure",
            ),
          ).toBe(true);
          expect(row.scope.sources.map((source) => source.sourceRow)).toEqual(
            row.ruleId === "exposure-subset" ? [10] : [2, 10],
          );
          for (const overflow of row.expressionOverflows)
            expect(overflow.sources.map((source) => source.sourceRow)).toEqual([
              2, 10,
            ]);
        }
        expect(
          rows
            .filter((row) => !row.ruleId.startsWith("exposure-"))
            .flatMap((row) => row.scope.sources)
            .every((source) => source.artifactId !== "exposure"),
        ).toBe(true);
      }
    });
  }

  it("reuses exact source subsets only within a compact review invocation", () => {
    const input = compactReviewFixture({ mixedSources: true });
    const prepared = prepareDiagnosticDataCompact(input);
    const eager = prepareDiagnosticData(input);
    const spy = vi.spyOn(sourceOrdering, "normalizeDiagnosticSourceLocations");
    try {
      const expected = evaluateDiagnosticReviewRules(eager);
      const originalCalls = spy.mock.calls.length;
      spy.mockClear();
      const first = evaluateDiagnosticReviewRulesCompact(prepared);
      const compactCalls = spy.mock.calls.length;
      expect(compactCalls).toBeLessThan(originalCalls);
      expect([...iterateDiagnosticReviewEvaluations(first)]).toEqual(expected);
      spy.mockClear();
      const second = evaluateDiagnosticReviewRulesCompact(prepared);
      expect(spy.mock.calls.length).toBe(compactCalls);
      expect([...iterateDiagnosticReviewEvaluations(second)]).toEqual(expected);
      expect(getDiagnosticReviewEvaluation(first, 0).scope.sources[0]).not.toBe(
        getDiagnosticReviewEvaluation(second, 0).scope.sources[0],
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("does not memoize mutable source references in private column construction", () => {
    const prepared = prepareDiagnosticData(compactReviewFixture());
    const evaluation = structuredClone(
      evaluateDiagnosticReviewRules(prepared)[0]!,
    );
    const builder = createCompactReviewBuilder(
      prepared.definition.definition.reviewRules,
    );
    builder.append(evaluation);
    // Direct private-builder test: public callers cannot inject evaluation rows.
    const source = evaluation.scope.sources[0] as { sourceRow: number };
    source.sourceRow = 71;
    builder.append(evaluation);
    const store = builder.finish();
    expect(
      getDiagnosticReviewEvaluation(store, 0).scope.sources[0]!.sourceRow,
    ).toBe(10);
    expect(
      getDiagnosticReviewEvaluation(store, 1).scope.sources[0]!.sourceRow,
    ).toBe(71);
  });

  it("pages complete results across column chunks without retaining a DTO per evaluation", () => {
    const store = evaluateDiagnosticReviewRulesCompact(
      prepareDiagnosticDataCompact(compactReviewFixture({ groups: 600 })),
    );
    expect(store.count).toBeGreaterThan(4096);
    const all = [...iterateDiagnosticReviewEvaluations(store)];
    const page = pageDiagnosticReviewEvaluations(store, {
      offset: 4090,
      limit: 20,
    });
    expect(page.total).toBe(store.count);
    expect(page.items.map((row) => row.index)).toEqual(
      Array.from({ length: 20 }, (_, index) => 4090 + index),
    );
    for (const item of page.items)
      expect(getDiagnosticReviewEvaluation(store, item.index)).toEqual(
        all[item.index],
      );
    const warnings = pageDiagnosticReviewEvaluations(store, {
      effectiveStatus: "warning",
      sourceGroup: "group-0",
    });
    expect(warnings.total).toBeGreaterThan(0);
    expect(
      warnings.items.every((item) => item.scope.kind !== "control-total"),
    ).toBe(true);
    expect(
      pageDiagnosticReviewEvaluations(store, { ruleId: "missing" }),
    ).toEqual({ total: 0, offset: 0, items: [], nextOffset: null });
    expect(
      pageDiagnosticReviewEvaluations(store, { ruleId: "compare" }).total,
    ).toBe(1200);
    const last = store.count - 1;
    const sourcePage = pageDiagnosticReviewEvaluationSources(store, last, {
      offset: 1,
      limit: 1,
    });
    expect(sourcePage.total).toBe(2);
    expect(sourcePage.items[0]!.sourceRow).toBe(10);
    expect(
      getDiagnosticReviewEvaluationSummary(store, last).scope.sourceCount,
    ).toBe(2);
  });

  it("rejects forged stores, unsafe indices, accessors and malformed page filters", () => {
    const store = evaluateDiagnosticReviewRulesCompact(
      prepareDiagnosticDataCompact(compactReviewFixture()),
    );
    expect(() =>
      getDiagnosticReviewEvaluation(JSON.parse(JSON.stringify(store)), 0),
    ).toThrow(/authentic/);
    for (const index of [-1, NaN, Infinity, store.count])
      expect(() => getDiagnosticReviewEvaluation(store, index)).toThrow(
        /index/i,
      );
    for (const query of [
      { limit: 0 },
      { limit: 1001 },
      { offset: -1 },
      { ruleId: " " },
      { unknown: true },
    ])
      expect(() => pageDiagnosticReviewEvaluations(store, query)).toThrow();
    let calls = 0;
    expect(() =>
      pageDiagnosticReviewEvaluations(store, {
        get limit() {
          calls++;
          return 1;
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
    expect(() => assertCompactReviewCapacity(0xffff_fffe)).not.toThrow();
    for (const count of [0xffff_ffff, -1, Number.MAX_SAFE_INTEGER, NaN])
      expect(() => assertCompactReviewCapacity(count)).toThrow(/capacity/);
  });
});
