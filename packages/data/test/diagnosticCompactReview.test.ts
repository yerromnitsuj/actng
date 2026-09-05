import { describe, expect, it, vi } from "vitest";
import * as core from "@actuarial-ts/core";
import {
  canonicalJson,
  compileDiagnosticDefinition,
  iterateDiagnosticIdentityJson,
  prepareDiagnosticData,
  prepareDiagnosticDataCompact,
  type DiagnosticDefinition,
  type PrepareDiagnosticDataInput,
} from "@actuarial-ts/core";
import { compactReviewFixture } from "../../core/test/helpers/compactReview.js";
import {
  assertCompactDiagnosticReviewReceipt,
  getCompactDiagnosticReviewReceiptFingerprint,
  getCompactDiagnosticReviewReceiptIdentityDocument,
  getDiagnosticReviewFinding,
  iterateDiagnosticReviewFindings,
  pageDiagnosticReviewFindings,
  pageDiagnosticReviewFindingSources,
  reviewPreparedDiagnosticData,
  reviewPreparedDiagnosticDataCompact,
} from "../src/diagnosticPreparedReview.js";
import {
  assertCompactFindingCapacity,
  CompactDiagnosticJson,
} from "../src/compactDiagnosticJson.js";

/**
 * The shared core fixture compiles against core/src. Only plain definition/row
 * data may cross into this package: compile it again with the public core module
 * used by data, never cast or transplant another module's authenticated brand.
 * This reconstruction intentionally supports only this fixture's small schema.
 */
function publicCoreFixture(
  options: Parameters<typeof compactReviewFixture>[0] = {},
): PrepareDiagnosticDataInput {
  const input = compactReviewFixture(options);
  const original = input.definition.definition;
  const definition: DiagnosticDefinition = {
    diagnosticDefinitionVersion: original.diagnosticDefinitionVersion,
    id: original.id,
    version: original.version,
    lossRowGrain: original.lossRowGrain,
    measures: original.measures.map(
      ({
        basisId,
        countPopulationId,
        exposureBasisId,
        exposureTiming,
        ...measure
      }) => ({
        ...measure,
        ...(basisId === null ? {} : { basisId }),
        ...(countPopulationId === null ? {} : { countPopulationId }),
        ...(exposureBasisId === null ? {} : { exposureBasisId }),
        ...(exposureTiming === null ? {} : { exposureTiming }),
      }),
    ),
    countPopulations: [],
    exposureBases: [],
    amountBases: original.amountBases.map(
      ({ sourceDescription, components, ...basis }) => ({
        ...basis,
        ...(sourceDescription === null ? {} : { sourceDescription }),
        components: components.map((component) => {
          if (component.limitation.kind !== "unlimited")
            throw new Error(
              "Compact review fixture expects unlimited components",
            );
          return { ...component, limitation: component.limitation };
        }),
      }),
    ),
    derivedMeasures: [],
    formulas: [],
    instances: [],
    reviewRules: original.reviewRules.map((rule) => {
      if (rule.kind !== "control-total") return rule;
      const { filter, ...control } = rule;
      if (filter !== null)
        throw new Error("Compact review fixture expects unfiltered controls");
      return control;
    }),
    periodAxis: original.periodAxis,
  };
  const compiled = compileDiagnosticDefinition(definition);
  // Prove no mathematical or evidence settings changed during reconstruction.
  expect(compiled.definition).toEqual(original);
  expect(compiled.definitionIntegrity).toBe(
    input.definition.definitionIntegrity,
  );
  return { ...input, definition: compiled };
}

describe("compact prepared diagnostic review", () => {
  it("guards private index capacities without allocating large collections", () => {
    expect(() => assertCompactFindingCapacity(0xffff_fffe)).not.toThrow();
    expect(() => assertCompactFindingCapacity(0xffff_ffff, 0)).not.toThrow();
    for (const count of [0xffff_ffff, -1, NaN, Number.MAX_SAFE_INTEGER])
      expect(() => assertCompactFindingCapacity(count)).toThrow(/capacity/);
    for (const addition of [-1, NaN, Number.MAX_SAFE_INTEGER])
      expect(() => assertCompactFindingCapacity(0, addition)).toThrow(
        /capacity/,
      );
  });
  for (const options of [
    {},
    { nullable: true },
    { gap: true },
    { overflow: true },
    { quarter: true, gap: true },
  ]) {
    it(`matches every eager check and finding: ${JSON.stringify(options)}`, () => {
      const input = publicCoreFixture(options);
      const evidence = {
        groupingAssignments: [
          {
            key: "a",
            group: "x",
            source: { artifactId: "groups", sourceRow: 10 },
          },
          {
            key: "a",
            group: "y",
            source: { artifactId: "groups", sourceRow: 2 },
          },
        ],
        cachedFormulas: [{ id: "formula", declaredFormulaSource: true }],
      };
      const old = reviewPreparedDiagnosticData({
        prepared: prepareDiagnosticData(input),
        evidence,
      });
      const current = reviewPreparedDiagnosticDataCompact({
        prepared: prepareDiagnosticDataCompact(input),
        evidence,
      });
      expect(() => assertCompactDiagnosticReviewReceipt(current)).not.toThrow();
      expect(current.report.summary).toEqual(old.report.summary);
      expect(current.report.checks).toEqual(
        old.report.checks.map(({ findings, ...check }) => ({
          ...check,
          findingCount: findings.length,
        })),
      );
      const entries = [...iterateDiagnosticReviewFindings(current.findings)];
      const expected = old.report.checks.flatMap((check) =>
        check.findings.map((finding) => ({ checkId: check.id, finding })),
      );
      expect(entries.map(({ index: _index, ...entry }) => entry)).toEqual(
        expected,
      );
      expect(canonicalJson(entries.map((entry) => entry.finding))).toBe(
        canonicalJson(expected.map((entry) => entry.finding)),
      );
      expect(current).not.toHaveProperty("identityBody");
      expect(current).not.toHaveProperty("reportFingerprint");
      expect(current).not.toHaveProperty("preparationFingerprint");
      expect(
        [
          ...iterateDiagnosticIdentityJson(
            getCompactDiagnosticReviewReceiptIdentityDocument(current),
          ),
        ].join(""),
      ).toBe(canonicalJson(old.identityBody));
      expect(getCompactDiagnosticReviewReceiptFingerprint(current)).toBe(
        old.reportFingerprint,
      );
      const page = pageDiagnosticReviewFindings(current.findings, { limit: 2 });
      expect(page.total).toBe(entries.length);
      expect(page.items).toHaveLength(Math.min(2, entries.length));
      if (entries.length) {
        const first = entries[0]!;
        expect(getDiagnosticReviewFinding(current.findings, 0)).toEqual(first);
        expect(
          pageDiagnosticReviewFindingSources(current.findings, 0).items,
        ).toEqual(first.finding.context?.sources ?? []);
        expect(page.items[0]!.finding.context).not.toHaveProperty("sources");
      }
    });
  }
  it("stores and pages warning-heavy findings, and authenticates all readers", () => {
    const current = reviewPreparedDiagnosticDataCompact({
      prepared: prepareDiagnosticDataCompact(
        publicCoreFixture({ groups: 100 }),
      ),
      evidence: null,
    });
    expect(current.findings.count).toBeGreaterThan(100);
    const page = pageDiagnosticReviewFindings(current.findings, {
      checkId: "reconcile",
      offset: 50,
      limit: 5,
    });
    expect(page.total).toBe(200);
    expect(page.items).toHaveLength(5);
    expect(page.items.every((entry) => entry.checkId === "reconcile")).toBe(
      true,
    );
    expect(() =>
      assertCompactDiagnosticReviewReceipt(JSON.parse(JSON.stringify(current))),
    ).toThrow(/authentic/);
    expect(() => getDiagnosticReviewFinding({ count: 1 } as never, 0)).toThrow(
      /authentic/,
    );
    let getters = 0;
    expect(() =>
      pageDiagnosticReviewFindings(current.findings, {
        get limit() {
          getters++;
          return 1;
        },
      }),
    ).toThrow();
    expect(getters).toBe(0);
    expect(() =>
      pageDiagnosticReviewFindings(current.findings, { limit: 1001 }),
    ).toThrow();
    expect(() =>
      pageDiagnosticReviewFindingSources(current.findings, -1),
    ).toThrow();
    expect(() =>
      getCompactDiagnosticReviewReceiptFingerprint({ ...current }),
    ).toThrow(/authentic/);
  });
  it("unions thousands of duplicate finding sources before encoding, without retaining every growing prefix", () => {
    const groups = 1000;
    const originalEvaluation = core.getDiagnosticReviewEvaluation;
    const coordinate = {
      sourceGroup: "same",
      origin: "2024",
      valuation: "2024",
      developmentAge: 12,
      ageUnit: "month",
    };
    // This is a finding-normalizer stress input, not an alternate actuarial oracle.
    // Real numerical equivalence is exercised without stubs in the tests above.
    const evaluation = vi
      .spyOn(core, "getDiagnosticReviewEvaluation")
      .mockImplementation((store, index) => {
        const value = originalEvaluation(store, index);
        const sources = [{ artifactId: "distinct-row", sourceRow: index + 1 }];
        const scope =
          value.scope.kind === "cell"
            ? { ...value.scope, cell: coordinate, sources }
            : value.scope.kind === "valuation-pair"
              ? {
                  ...value.scope,
                  previous: coordinate,
                  current: coordinate,
                  sources,
                }
              : { ...value.scope, sources };
        return { ...value, scope } as typeof value;
      });
    const originalAdd = CompactDiagnosticJson.prototype.add;
    let encodedSourceEntries = 0;
    CompactDiagnosticJson.prototype.add = function (value: unknown): number {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value[0] &&
        typeof value[0] === "object" &&
        "artifactId" in value[0]
      )
        encodedSourceEntries += value.length;
      return originalAdd.call(this, value);
    };
    try {
      const receipt = reviewPreparedDiagnosticDataCompact({
        prepared: prepareDiagnosticDataCompact(publicCoreFixture({ groups })),
        evidence: null,
      });
      const check = receipt.report.checks.find(
        (check) => check.id === "reconcile",
      )!;
      expect(check.findingCount).toBe(1);
      const finding = pageDiagnosticReviewFindings(receipt.findings, {
        checkId: "reconcile",
      }).items[0]!;
      const first = pageDiagnosticReviewFindingSources(
        receipt.findings,
        finding.index,
        { limit: 1 },
      );
      const last = pageDiagnosticReviewFindingSources(
        receipt.findings,
        finding.index,
        { offset: groups * 2 - 1, limit: 1 },
      );
      expect(first.total).toBe(groups * 2);
      expect(first.items[0]!.sourceRow).toBe(groups * 2 + 1);
      expect(last.items[0]!.sourceRow).toBe(groups * 4);
      expect(encodedSourceEntries).toBeLessThan(groups * 20);
      expect(receipt.evaluations.count).toBe(groups * 7 + 1);
    } finally {
      CompactDiagnosticJson.prototype.add = originalAdd;
      evaluation.mockRestore();
    }
  });
});
