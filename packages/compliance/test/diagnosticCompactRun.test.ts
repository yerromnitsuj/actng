import { describe, expect, it, vi } from "vitest";
import { getCompactDiagnosticRunOwner } from "../src/diagnosticCompactRun.js";
import * as publicCompliance from "../src/index.js";
import { currentEmptyGridReleaseTags } from "./diagnosticReleaseTags.js";
import {
  canonicalJson,
  getMetricDiagnosticsResultIdentity,
  iterateDiagnosticIdentityJson,
} from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnosticsCompact,
  validateDiagnosticRunInputCompact,
} from "@actuarial-ts/data";
import {
  assertVerifiedCompactDiagnosticRunProvenance,
  assertVerifiedDiagnosticRunProvenance,
  createCompactDiagnosticRunIdentity,
  createDiagnosticRunIdentity,
  digestDiagnosticArtifactChunks,
  type CompactDiagnosticArtifactEvidence,
} from "../src/index.js";
import {
  completedRun,
  definition,
  evidence,
} from "./fixtures/diagnosticIdentityRun.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    definition,
    losses: [
      {
        rowType: "aggregate",
        recordId: "r1",
        sourceGroup: "fleet",
        origin: "2025",
        valuation: "2025Q1",
        complete: true,
        source: { artifactId: "loss-run", sourceRow: 2 },
        measures: { reported: 4 },
      },
    ],
    exposures: [
      {
        key: "e1",
        sourceGroup: "fleet",
        origin: "2025",
        measureId: "exposure",
        value: 20,
        complete: true,
        source: { artifactId: "exposures", sourceRow: 2 },
      },
    ],
    datasetArtifactId: "loss-run",
    runPresetId: "annual-frequency-v1",
    ...overrides,
  };
}

function compactRun(overrides: Record<string, unknown> = {}) {
  const run = runValidatedMetricDiagnosticsCompact(
    validateDiagnosticRunInputCompact(input(overrides)),
  );
  if (run.status !== "completed")
    throw new Error("Fixture unexpectedly blocked");
  return run;
}

async function digest(
  id: string,
  value: number,
  scope: "input" | "preparation" = "input",
) {
  return digestDiagnosticArtifactChunks({ id, scope, expectedByteLength: 1 }, [
    new Uint8Array([value]),
  ]);
}

async function compactEvidence(overrides: Record<string, unknown> = {}) {
  return {
    completedRun: compactRun(overrides),
    inputArtifacts: await Promise.all([
      digest("loss-run", 1),
      digest("exposures", 2),
    ]),
    preparationArtifacts: [] as CompactDiagnosticArtifactEvidence[],
    preparationLineage: [],
  };
}

describe("compact diagnostic provenance", () => {
  it("exposes its authentic owner only through internal transport plumbing", async () => {
    const args = await compactEvidence();
    const provenance = createCompactDiagnosticRunIdentity(args);
    expect(getCompactDiagnosticRunOwner(provenance)).toBe(args.completedRun);
    expect(() => getCompactDiagnosticRunOwner({ ...provenance })).toThrow(
      /authentic verified compact/,
    );
    expect(() =>
      getCompactDiagnosticRunOwner(args.completedRun as never),
    ).toThrow(/authentic verified compact/);
    expect(
      Object.hasOwn(publicCompliance, "getCompactDiagnosticRunOwner"),
    ).toBe(false);
  });

  it.each([
    ["implicit grid", {}],
    ["explicit empty grid", { expectedCells: [] }],
    [
      "source-null grid",
      {
        expectedCells: [
          { sourceGroup: "fleet", origin: "2025", valuation: "2025Q1" },
        ],
      },
    ],
    [
      "source metadata, filter and free JSON",
      {
        filter: { instanceIds: ["reported-frequency"] },
        groupDimensions: {
          fleet: { source: { custom: true }, values: [null, -0, "Unicode 😀"] },
        },
        reviewEvidence: {
          groupingAssignments: [
            {
              key: "fleet",
              group: "fleet",
              source: { artifactId: "loss-run", sourceRow: 2 },
            },
          ],
          cachedFormulas: [],
        },
      },
    ],
    [
      "review rules and explicit permissive policy",
      {
        definition: {
          ...definition,
          reviewRules: [
            {
              id: "claims-limit",
              kind: "compare",
              code: "limit",
              description: "Review high claims",
              severity: "fail",
              missingInput: "not-evaluated",
              when: {
                left: { op: "measure", measureId: "reported" },
                operator: "gt",
                right: { op: "constant", value: 2 },
              },
            },
          ],
        },
        policy: {
          allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
          rationaleRef: "review-note",
        },
      },
    ],
  ])(
    "matches every legacy normalized byte and tag: %s",
    async (_name, overrides) => {
      const policy = (overrides as Record<string, unknown>).policy as
        | { rationaleRef?: string }
        | undefined;
      const preparationArtifacts = policy?.rationaleRef
        ? [
            {
              id: policy.rationaleRef,
              scope: "preparation" as const,
              assurance: "caller-declared" as const,
              algorithm: "memo",
              value: "reviewed",
            },
          ]
        : [];
      const old = await createDiagnosticRunIdentity({
        ...evidence(completedRun(overrides)),
        preparationArtifacts,
      });
      const compact = createCompactDiagnosticRunIdentity({
        ...(await compactEvidence(overrides)),
        preparationArtifacts,
      });
      const manifest = {
        ...old.manifest,
        executionPolicy: {
          gate: old.manifest.executionPolicy.gate,
          review: {
            body: old.review.identityBody,
            reportFingerprint: old.review.reportFingerprint,
          },
        },
      };
      const manifestText = [
        ...iterateDiagnosticIdentityJson(compact.manifestIdentityDocument),
      ].join("");
      const resultText = [
        ...iterateDiagnosticIdentityJson(compact.resultIdentityDocument),
      ].join("");
      expect(manifestText).toBe(canonicalJson(manifest));
      expect(resultText).toBe(
        canonicalJson(getMetricDiagnosticsResultIdentity(old.result)),
      );
      expect(compact.definition).toEqual(old.definition);
      expect(compact.preparationFingerprint).toBe(
        old.manifest.preparationFingerprint,
      );
      expect(compact.reviewFingerprint).toBe(old.review.reportFingerprint);
      expect([
        compact.runFingerprint,
        compact.resultFingerprint,
        compact.runResultFingerprint,
      ]).toEqual([
        old.runFingerprint,
        old.resultFingerprint,
        old.runResultFingerprint,
      ]);
      expect(() =>
        assertVerifiedCompactDiagnosticRunProvenance(compact),
      ).not.toThrow();
      expect(() => assertVerifiedDiagnosticRunProvenance(compact)).toThrow();
      expect(Object.hasOwn(compact, "manifest")).toBe(false);
      expect(Object.hasOwn(compact, "result")).toBe(false);
      expect(Object.isFrozen(compact)).toBe(true);
    },
  );

  it("pins the empty-grid numerical identity and version-bound run tags without changing goldens", async () => {
    const compact = createCompactDiagnosticRunIdentity(
      await compactEvidence({ expectedCells: [] }),
    );
    expect(compact.runFingerprint).toBe(currentEmptyGridReleaseTags.run);
    expect(compact.resultFingerprint).toBe(currentEmptyGridReleaseTags.result);
    expect(compact.runResultFingerprint).toBe(
      currentEmptyGridReleaseTags.binding,
    );
  });

  it("requires owner authority independently of structural documents or matching copied hashes", async () => {
    const args = await compactEvidence();
    const real = createCompactDiagnosticRunIdentity(args);
    for (const fake of [{ ...real }, real.manifestIdentityDocument, {}, null])
      expect(() => assertVerifiedCompactDiagnosticRunProvenance(fake)).toThrow(
        /authentic/,
      );
    for (const fake of [
      { ...args.completedRun },
      completedRun(),
      {
        ...args.completedRun,
        gate: { ...args.completedRun.gate, allowedReviewStatuses: [] },
      },
    ])
      expect(() =>
        createCompactDiagnosticRunIdentity({
          ...args,
          completedRun: fake as never,
        }),
      ).toThrow(/authentic completed compact/);
    const forgedDigest = { ...args.inputArtifacts[0]! };
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [forgedDigest, args.inputArtifacts[1]!],
      }),
    ).toThrow(/authentic/);
  });

  it("keeps caller declarations separate and snapshots their mutable metadata", async () => {
    const args = await compactEvidence();
    const declaration = {
      id: "exposures",
      scope: "input" as const,
      assurance: "caller-declared" as const,
      algorithm: "external-v1",
      value: "external-check",
    };
    const compact = createCompactDiagnosticRunIdentity({
      ...args,
      inputArtifacts: [args.inputArtifacts[0]!, declaration],
    });
    const before = [
      ...iterateDiagnosticIdentityJson(compact.manifestIdentityDocument),
    ].join("");
    declaration.value = "changed";
    expect(
      [...iterateDiagnosticIdentityJson(compact.manifestIdentityDocument)].join(
        "",
      ),
    ).toBe(before);
    expect(
      compact.inputArtifacts.find((item) => item.id === "exposures")?.assurance,
    ).toBe("caller-declared");
    expect(Object.isFrozen(declaration)).toBe(false);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [
          { ...declaration, id: "loss-run" },
          args.inputArtifacts[1]!,
        ],
      }),
    ).toThrow(/SDK-computed/);
  });

  it("rejects unresolved, orphaned, duplicated and wrong-scope artifacts", async () => {
    const args = await compactEvidence();
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: args.inputArtifacts.slice(0, 1),
      }),
    ).toThrow(/unresolved/);
    const orphan = await digest("orphan", 3);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [...args.inputArtifacts, orphan],
      }),
    ).toThrow(/orphaned/);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [...args.inputArtifacts, args.inputArtifacts[0]!],
      }),
    ).toThrow(/unique/);
    const wrongScope = await digest("exposures", 2, "preparation");
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [args.inputArtifacts[0]!, wrongScope],
      }),
    ).toThrow(/input scope/);
  });

  it("shares the complete lineage validation and freezes copied lineage", async () => {
    const args = await compactEvidence();
    const raw = await digest("raw", 3);
    const transform = await digest("mapping", 4, "preparation");
    const edge = {
      outputArtifactId: "loss-run",
      inputArtifactIds: ["raw"],
      transformationArtifactIds: ["mapping"],
    };
    const good = {
      ...args,
      inputArtifacts: [...args.inputArtifacts, raw],
      preparationArtifacts: [transform],
      preparationLineage: [edge],
    };
    const compact = createCompactDiagnosticRunIdentity(good);
    edge.inputArtifactIds[0] = "elsewhere";
    expect(compact.preparationLineage[0]?.inputArtifactIds).toEqual(["raw"]);
    expect(
      Object.isFrozen(compact.preparationLineage[0]?.inputArtifactIds),
    ).toBe(true);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...good,
        preparationLineage: [{ ...edge, inputArtifactIds: ["loss-run"] }],
      }),
    ).toThrow(/itself/);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...good,
        preparationLineage: [
          { ...edge, inputArtifactIds: ["raw"] },
          {
            outputArtifactId: "raw",
            inputArtifactIds: ["loss-run"],
            transformationArtifactIds: [],
          },
        ],
      }),
    ).toThrow(/cycle/);
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...good,
        preparationLineage: [
          { ...edge, inputArtifactIds: ["raw"] },
          { ...edge, inputArtifactIds: ["raw"] },
        ],
      }),
    ).toThrow(/one producing/);
  });

  it("requires policy rationale artifacts and cannot promote a genuinely blocked outcome", async () => {
    const args = await compactEvidence({
      policy: { rationaleRef: "review-note" },
    });
    expect(() => createCompactDiagnosticRunIdentity(args)).toThrow(
      /unresolved/,
    );
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        preparationArtifacts: [
          {
            id: "review-note",
            scope: "preparation",
            assurance: "caller-declared",
            algorithm: "memo",
            value: "reviewed",
          },
        ],
      }),
    ).not.toThrow();
    const blocked = runValidatedMetricDiagnosticsCompact(
      validateDiagnosticRunInputCompact(
        input({ policy: { allowedReviewStatuses: ["pass"] } }),
      ),
    );
    expect(blocked.status).not.toBe("completed");
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        completedRun: blocked as never,
      }),
    ).toThrow(/authentic completed compact/);
  });

  it("never invokes getters at evidence or lineage boundaries", async () => {
    const args = await compactEvidence();
    const getter = vi.fn(() => "loss-run");
    const badArtifact = Object.defineProperty(
      {
        scope: "input",
        assurance: "caller-declared",
        algorithm: "a",
        value: "b",
      },
      "id",
      { enumerable: true, get: getter },
    );
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        inputArtifacts: [badArtifact as never],
      }),
    ).toThrow(/data properties/);
    const badEdge = Object.defineProperty({}, "outputArtifactId", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      createCompactDiagnosticRunIdentity({
        ...args,
        preparationLineage: [badEdge as never],
      }),
    ).toThrow(/data properties/);
    const badArray = Object.defineProperty([], "0", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      createCompactDiagnosticRunIdentity({ ...args, inputArtifacts: badArray }),
    ).toThrow(/data properties/);
    const badInput = Object.defineProperty({}, "completedRun", {
      enumerable: true,
      get: getter,
    });
    expect(() => createCompactDiagnosticRunIdentity(badInput as never)).toThrow(
      /data properties/,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
