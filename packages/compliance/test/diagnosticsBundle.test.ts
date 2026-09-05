import { describe, expect, it } from "vitest";
import { getMetricDiagnosticsResultIdentity } from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import { parseDocument } from "@actuarial-ts/interchange";
import { currentEmptyGridReleaseTags } from "./diagnosticReleaseTags.js";
import {
  ComplianceError,
  assertVerifiedDiagnosticRunProvenance,
  canonicalJson,
  createBundle,
  createDiagnosticRunIdentity,
  fnv1a64,
  verifyBundle,
  verifyDiagnosticRunIdentity,
} from "../src/index.js";

import {
  definition,
  completedRun,
  evidence,
} from "./fixtures/diagnosticIdentityRun.js";

function diagnosticBundle(
  provenance: Awaited<ReturnType<typeof createDiagnosticRunIdentity>>,
) {
  return createBundle({
    inputs: {},
    parameters: {},
    results: provenance.result,
    sdkVersions: {
      "@actuarial-ts/core": "0.7.0",
      "@actuarial-ts/data": "0.7.0",
      "@actuarial-ts/compliance": "0.7.0",
    },
    createdAt: "2026-09-03T12:00:00.000Z",
    diagnosticRuns: [provenance],
    wrap: { triangles: [], selections: [], results: [] },
  });
}

function stamp(payload: Record<string, unknown>): string {
  return `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, ...payload }))}`;
}

function restampRun(run: any): void {
  const { review, ...executionPolicy } = run.manifest.executionPolicy;
  run.runFingerprint = stamp({
    kind: "diagnostic-run",
    manifest: {
      ...run.manifest,
      executionPolicy: {
        ...executionPolicy,
        review: {
          body: review.identityBody,
          reportFingerprint: review.reportFingerprint,
        },
      },
    },
  });
  run.resultFingerprint = stamp({
    kind: "diagnostic-result",
    result: getMetricDiagnosticsResultIdentity(run.result),
  });
  run.runResultFingerprint = stamp({
    kind: "diagnostic-run-result",
    runFingerprint: run.runFingerprint,
    resultFingerprint: run.resultFingerprint,
  });
}

function restampBundle(doc: any, body: any): void {
  doc.bundle.payload = canonicalJson(body);
  doc.bundle.hash = fnv1a64(doc.bundle.payload);
  doc.integrity = fnv1a64(
    canonicalJson({ bundle: doc.bundle, interchange: doc.interchange }),
  );
}

describe("sealed diagnostic run provenance", () => {
  it("pins independent full-workflow identity vectors for a sourced, explicitly empty-grid run", async () => {
    const run = completedRun({ expectedCells: [] });
    const provenance = await createDiagnosticRunIdentity(evidence(run));
    expect({
      formula: provenance.definition.identities.formulaById.frequency,
      calculation:
        provenance.definition.identities.calculationByInstanceId[
          "reported-frequency"
        ],
      definition: provenance.definition.identities.definition,
      preparation: provenance.manifest.preparationFingerprint,
      expectedGrid: provenance.manifest.expectedCellGridFingerprint,
      review: provenance.review.reportFingerprint,
      run: provenance.runFingerprint,
      result: provenance.resultFingerprint,
      binding: provenance.runResultFingerprint,
    }).toEqual({
      formula: "fnv1a64-jcs-v1:8f7ef2461fb01f41",
      calculation: "fnv1a64-jcs-v1:b54459c9e7241fd2",
      definition: "fnv1a64-jcs-v1:7074328075af1ef0",
      preparation: "fnv1a64-jcs-v1:982bb1bea97984d1",
      expectedGrid: "fnv1a64-jcs-v1:5df97dffd0ba263d",
      review: "fnv1a64-jcs-v1:00df4f88cca38090",
      ...currentEmptyGridReleaseTags,
    });
  });

  it("normalizes review sources and filters without changing the authentic public result reference", async () => {
    const run = completedRun({
      filter: { instanceIds: ["reported-frequency"] },
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
    });
    const provenance = await createDiagnosticRunIdentity(evidence(run));
    expect(provenance.result).toBe(run.result);
    expect(provenance.manifest.filter).toMatchObject({
      outputGroups: null,
      originFrom: null,
      instanceIds: ["reported-frequency"],
    });
    expect(
      provenance.review.identityBody.evidence?.groupingAssignments[0]?.source,
    ).toEqual({
      artifactId: "loss-run",
      sourceRow: 2,
      sourceFile: null,
      sourceSheet: null,
      sourceCell: null,
    });
    expect(provenance.review.evidence?.groupingAssignments[0]?.source).toEqual({
      artifactId: "loss-run",
      sourceRow: 2,
    });
    expect(
      verifyBundle(
        JSON.parse(JSON.stringify(diagnosticBundle(provenance).wrapped)),
        provenance.result,
      ),
    ).toMatchObject({ reproduced: true });
  });
  it.each([
    { expectedCells: [] },
    {
      expectedCells: [
        {
          sourceGroup: "fleet",
          origin: "2025",
          valuation: "2025Q1",
          source: { artifactId: "loss-run" },
        },
      ],
    },
    { filter: { instanceIds: [] } },
    {
      completePeriodCutoffs: [
        { sourceGroup: "fleet", originThrough: "2024", valuationThrough: null },
      ],
    },
    {
      reviewEvidence: {
        groupingAssignments: [
          { key: "fleet", group: "fleet", source: { artifactId: "loss-run" } },
        ],
        cachedFormulas: [],
      },
    },
    {
      groupMap: { fleet: "constructor" },
      groupDimensions: { constructor: { territory: "West" } },
    },
  ])("replays normalized preparation and context %j", async (options) => {
    const provenance = await createDiagnosticRunIdentity(
      evidence(completedRun(options)),
    );
    const bundle = diagnosticBundle(provenance);
    expect(
      verifyBundle(
        JSON.parse(JSON.stringify(bundle.wrapped)),
        provenance.result,
      ),
    ).toMatchObject({ reproduced: true });
  });

  it("replays non-finite audit sentinels under an explicitly justified fail-allowing policy", async () => {
    const run = completedRun({
      losses: [
        {
          rowType: "aggregate",
          recordId: "r1",
          sourceGroup: "fleet",
          origin: "2025",
          valuation: "2025Q1",
          complete: true,
          source: { artifactId: "loss-run" },
          measures: { reported: NaN },
        },
      ],
      policy: {
        allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
        allowedMetricFindingSeverities: ["info", "warning", "fail"],
        rationaleRef: "rationale",
      },
    });
    const provenance = await createDiagnosticRunIdentity({
      ...evidence(run),
      preparationArtifacts: [
        {
          id: "rationale",
          scope: "preparation",
          assurance: "sdk-computed",
          bytes: new TextEncoder().encode(
            "Retain invalid input explicitly for review",
          ),
        },
      ],
    });
    expect(
      verifyBundle(
        JSON.parse(JSON.stringify(diagnosticBundle(provenance).wrapped)),
        provenance.result,
      ),
    ).toMatchObject({ reproduced: true });
  });

  it("regenerates review prose without treating descriptions/details as identity", async () => {
    const input = evidence();
    const provenance = await createDiagnosticRunIdentity(input);
    const candidate = structuredClone(provenance) as any;
    candidate.review.report.checks[0].description = "Caller display text";
    candidate.review.report.checks[0].details = ["Caller display detail"];
    candidate.manifest.executionPolicy.review = candidate.review;
    const verified = await verifyDiagnosticRunIdentity(candidate, input);
    expect(verified.review.report.checks[0]!.description).toBe(
      provenance.review.report.checks[0]!.description,
    );
    expect(verified.runFingerprint).toBe(provenance.runFingerprint);
  });
  it("uses the exact normative run, result, and binding identity payloads", async () => {
    const provenance = await createDiagnosticRunIdentity(evidence());
    const restamped = structuredClone(provenance);
    restampRun(restamped);
    expect(provenance.runFingerprint).toBe(restamped.runFingerprint);
    expect(provenance.runResultFingerprint).toBe(
      restamped.runResultFingerprint,
    );
  });

  it("snapshots a verification candidate before asynchronous artifact hashing", async () => {
    const input = evidence();
    const provenance = await createDiagnosticRunIdentity(input);
    const candidate = structuredClone(provenance) as any;
    const pending = verifyDiagnosticRunIdentity(candidate, input);
    candidate.result.emergence[0].metrics[
      "reported-frequency"
    ].calculation.value = 999;
    await expect(pending).resolves.toMatchObject({
      resultFingerprint: provenance.resultFingerprint,
    });
  });

  it.each([
    [
      "numeric output",
      (run: any) => {
        run.result.emergence[0].metrics[
          "reported-frequency"
        ].calculation.value = 999;
      },
      '.result.emergence[0].metrics["reported-frequency"].calculation.value',
    ],
    [
      "audit disposition",
      (run: any) => {
        run.manifest.inputAudit[0].disposition = "filter";
      },
      ".manifest.inputAudit[0].disposition",
    ],
    [
      "review summary",
      (run: any) => {
        run.review.report.summary.fail = 20;
        run.manifest.executionPolicy.review = run.review;
      },
      ".review.report.summary.fail",
    ],
    [
      "orphan artifact",
      (run: any) => {
        run.manifest.inputArtifacts.push({
          id: "orphan",
          scope: "input",
          assurance: "caller-declared",
          algorithm: "git",
          value: "abc",
        });
      },
      ".manifest.inputArtifacts[2].id",
    ],
    [
      "digest assurance",
      (run: any) => {
        run.manifest.inputArtifacts[0].assurance = "future";
      },
      ".manifest.inputArtifacts[0].assurance",
    ],
    [
      "digest length",
      (run: any) => {
        run.manifest.inputArtifacts[0].byteLength = -1;
      },
      ".manifest.inputArtifacts[0].byteLength",
    ],
    [
      "gate policy",
      (run: any) => {
        run.manifest.executionPolicy.gate.allowedReviewStatuses = ["pass"];
      },
      ".manifest.executionPolicy.gate",
    ],
    [
      "unknown gate status",
      (run: any) => {
        run.manifest.executionPolicy.gate.allowedReviewStatuses = ["future"];
      },
      ".manifest.executionPolicy.gate.allowedReviewStatuses[0]",
    ],
    [
      "unknown artifact scope",
      (run: any) => {
        run.manifest.inputArtifacts[0].scope = "future";
      },
      ".manifest.inputArtifacts[0].scope",
    ],
    [
      "invalid replayed row",
      (run: any) => {
        run.manifest.inputAudit.find(
          (item: any) => item.kind === "loss",
        ).record.complete = "yes";
      },
      ".manifest.inputAudit[0].record.complete",
    ],
    [
      "preparation fingerprint",
      (run: any) => {
        run.manifest.preparationFingerprint = "fnv1a64-jcs-v1:0000000000000000";
        run.review.preparationFingerprint = run.manifest.preparationFingerprint;
        run.result.preparationFingerprint = run.manifest.preparationFingerprint;
      },
      ".manifest.preparationFingerprint",
    ],
  ] as const)(
    "rejects restamped %s corruption through semantic replay",
    async (_name, mutate, expectedPath) => {
      const provenance = await createDiagnosticRunIdentity(evidence());
      const doc = structuredClone(diagnosticBundle(provenance).wrapped) as any;
      const body = JSON.parse(doc.bundle.payload);
      mutate(body.diagnosticRuns[0]);
      restampRun(body.diagnosticRuns[0]);
      restampBundle(doc, body);
      expect(verifyBundle(doc, provenance.result)).toMatchObject({
        reproduced: false,
        mismatchPath: `$.diagnosticRuns[0]${expectedPath}`,
      });
    },
  );

  it("verifies a serialized unmodified diagnostic bundle and rejects outer generator disagreement", async () => {
    const provenance = await createDiagnosticRunIdentity(evidence());
    const doc = JSON.parse(
      JSON.stringify(diagnosticBundle(provenance).wrapped),
    );
    expect(verifyBundle(doc, provenance.result)).toMatchObject({
      reproduced: true,
    });
    doc.generator.version = "0.0.0";
    expect(verifyBundle(doc, provenance.result)).toMatchObject({
      reproduced: false,
      mismatchPath: "$.generator.version",
    });
  });

  it.each(["0.6.0", "0.6.1"])("verifies coherent historical %s package stamps using the supported algorithm", async (version) => {
    const provenance = await createDiagnosticRunIdentity(evidence());
    const doc = structuredClone(diagnosticBundle(provenance).wrapped) as any;
    const body = JSON.parse(doc.bundle.payload);
    const run = body.diagnosticRuns[0];
    run.manifest.engine.packages = {
      core: version,
      data: version,
      compliance: version,
    };
    for (const name of Object.keys(body.sdkVersions))
      body.sdkVersions[name] = version;
    doc.generator.version = version;
    for (const definitionDoc of doc.interchange.diagnosticDefinitions)
      definitionDoc.generator.version = version;
    restampRun(run);
    restampBundle(doc, body);
    expect(verifyBundle(doc, provenance.result)).toMatchObject({
      reproduced: true,
    });
    body.sdkVersions["@actuarial-ts/data"] = "0.0.0";
    restampBundle(doc, body);
    expect(verifyBundle(doc, provenance.result)).toMatchObject({
      reproduced: false,
      mismatchPath: "$.sdkVersions.@actuarial-ts/data",
    });
  });
  it("replays, fingerprints, freezes, verifies, and supplies typed bundle definitions", async () => {
    const run = completedRun();
    const inputArtifacts = [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new TextEncoder().encode("loss"),
      },
      {
        id: "exposures",
        scope: "input" as const,
        assurance: "caller-declared" as const,
        algorithm: "source-sha256",
        value: "abc",
      },
    ];
    const provenance = await createDiagnosticRunIdentity({
      completedRun: run,
      inputArtifacts,
      preparationArtifacts: [],
      preparationLineage: [],
    });
    assertVerifiedDiagnosticRunProvenance(provenance);
    expect(provenance.result).toBe(run.result);
    expect(provenance.manifest.engine.packages).toEqual({
      core: "0.7.0",
      data: "0.7.0",
      compliance: "0.7.0",
    });
    expect(provenance.runResultFingerprint).toMatch(/^fnv1a64-jcs-v1:/);
    expect(Object.isFrozen(provenance.definition)).toBe(true);
    const restored = await verifyDiagnosticRunIdentity(
      JSON.parse(JSON.stringify(provenance)),
      {
        completedRun: run,
        inputArtifacts,
        preparationArtifacts: [],
        preparationLineage: [],
      },
    );
    assertVerifiedDiagnosticRunProvenance(restored);

    const bundle = createBundle({
      inputs: {},
      parameters: {},
      results: run.result,
      sdkVersions: {
        "@actuarial-ts/core": "0.7.0",
        "@actuarial-ts/data": "0.7.0",
        "@actuarial-ts/compliance": "0.7.0",
      },
      createdAt: "2026-09-03T12:00:00.000Z",
      diagnosticRuns: [provenance],
      wrap: { triangles: [], selections: [], results: [] },
    });
    expect(bundle.wrapped.interchangeVersion).toBe("1.1.0");
    expect(bundle.wrapped.interchange.diagnosticDefinitions).toHaveLength(1);
    expect(parseDocument(bundle.wrapped).warnings).toEqual([]);
  });

  it("rejects forged provenance and stale serialized content", async () => {
    const run = completedRun();
    expect(() => assertVerifiedDiagnosticRunProvenance({} as never)).toThrow(
      ComplianceError,
    );
    const inputArtifacts = [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new TextEncoder().encode("loss"),
      },
      {
        id: "exposures",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new TextEncoder().encode("exposure"),
      },
    ];
    const provenance = await createDiagnosticRunIdentity({
      completedRun: run,
      inputArtifacts,
      preparationArtifacts: [],
      preparationLineage: [],
    });
    const stale = structuredClone(provenance) as any;
    stale.result.definitionIntegrity = "fnv1a64-jcs-v1:0000000000000000";
    await expect(
      verifyDiagnosticRunIdentity(stale, {
        completedRun: run,
        inputArtifacts,
        preparationArtifacts: [],
        preparationLineage: [],
      }),
    ).rejects.toMatchObject({
      code: "DIAGNOSTIC_MISMATCH",
      path: "$.result.definitionIntegrity",
    });
  });

  it("rejects fully restamped bundle provenance that is semantically incoherent", async () => {
    const run = completedRun();
    const provenance = await createDiagnosticRunIdentity({
      completedRun: run,
      inputArtifacts: [
        {
          id: "loss-run",
          scope: "input" as const,
          assurance: "sdk-computed",
          bytes: new Uint8Array([1]),
        },
        {
          id: "exposures",
          scope: "input" as const,
          assurance: "sdk-computed",
          bytes: new Uint8Array([2]),
        },
      ],
      preparationArtifacts: [],
      preparationLineage: [],
    });
    const bundle = createBundle({
      inputs: {},
      parameters: {},
      results: run.result,
      sdkVersions: {
        "@actuarial-ts/core": "0.7.0",
        "@actuarial-ts/data": "0.7.0",
        "@actuarial-ts/compliance": "0.7.0",
      },
      createdAt: "2026-09-03T12:00:00.000Z",
      diagnosticRuns: [provenance],
      wrap: { triangles: [], selections: [], results: [] },
    });
    const hostile = structuredClone(bundle.wrapped) as any;
    const body = JSON.parse(hostile.bundle.payload);
    const stored = body.diagnosticRuns[0];
    stored.result.emergence[0].metrics[
      "reported-frequency"
    ].calculationFingerprint = "fnv1a64-jcs-v1:0000000000000000";
    const tag = (kind: string, key: string, value: unknown) =>
      `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind, [key]: value }))}`;
    stored.resultFingerprint = tag(
      "diagnostic-result",
      "result",
      stored.result,
    );
    stored.runResultFingerprint = tag("diagnostic-run-result", "binding", {
      runFingerprint: stored.runFingerprint,
      resultFingerprint: stored.resultFingerprint,
    });
    hostile.bundle.payload = canonicalJson(body);
    hostile.bundle.hash = fnv1a64(hostile.bundle.payload);
    hostile.integrity = fnv1a64(
      canonicalJson({
        bundle: hostile.bundle,
        interchange: hostile.interchange,
      }),
    );
    expect(verifyBundle(hostile, run.result)).toMatchObject({
      reproduced: false,
      mismatchPath:
        '$.diagnosticRuns[0].result.emergence[0].metrics["reported-frequency"].calculationFingerprint',
    });
  });

  it("snapshots SDK bytes before the first await and hashes that exact copy", async () => {
    const backing = new TextEncoder().encode("[loss]");
    const bytes = backing.subarray(1, 5);
    const pending = createDiagnosticRunIdentity({
      completedRun: completedRun(),
      inputArtifacts: [
        {
          id: "loss-run",
          scope: "input" as const,
          assurance: "sdk-computed",
          bytes,
        },
        {
          id: "exposures",
          scope: "input" as const,
          assurance: "sdk-computed",
          bytes: new TextEncoder().encode("exposure"),
        },
      ],
      preparationArtifacts: [],
      preparationLineage: [],
    });
    bytes.fill(0);
    const provenance = await pending;
    expect(
      provenance.manifest.inputArtifacts.find(
        (artifact) => artifact.id === "loss-run",
      )?.value,
    ).toBe("2ea71c18131a7f0383294917672136b6d5beae857e6bacca02d99d83e5f7d371");
  });

  it("rejects unresolved, orphaned, and cyclic artifact graphs", async () => {
    const run = completedRun();
    const required = [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([1]),
      },
      {
        id: "exposures",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([2]),
      },
    ];
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: required,
        preparationArtifacts: [],
        preparationLineage: [
          {
            outputArtifactId: "loss-run",
            inputArtifactIds: ["missing"],
            transformationArtifactIds: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_DIAGNOSTIC_RUN" });
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: required,
        preparationArtifacts: [
          {
            id: "orphan",
            scope: "preparation" as const,
            assurance: "sdk-computed",
            bytes: new Uint8Array([3]),
          },
        ],
        preparationLineage: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_DIAGNOSTIC_RUN" });
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: required,
        preparationArtifacts: [],
        preparationLineage: [
          {
            outputArtifactId: "loss-run",
            inputArtifactIds: ["exposures"],
            transformationArtifactIds: [],
          },
          {
            outputArtifactId: "exposures",
            inputArtifactIds: ["loss-run"],
            transformationArtifactIds: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_DIAGNOSTIC_RUN" });
  });

  it("rejects malformed artifact discriminants, empty lineage, and cross-array ID collisions", async () => {
    const run = completedRun();
    const required = [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([1]),
      },
      {
        id: "exposures",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([2]),
      },
    ];
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: [
          ...required,
          { id: "bad", scope: "input" as const, assurance: "future" } as never,
        ],
        preparationArtifacts: [],
        preparationLineage: [],
      }),
    ).rejects.toMatchObject({
      code: "BAD_DIAGNOSTIC_RUN",
      path: "$.inputArtifacts[2].assurance",
    });
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: required,
        preparationArtifacts: [],
        preparationLineage: [
          {
            outputArtifactId: "loss-run",
            inputArtifactIds: [],
            transformationArtifactIds: [],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "BAD_DIAGNOSTIC_RUN",
      path: "$.preparationLineage[0]",
    });
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: required,
        preparationArtifacts: [
          {
            id: "loss-run",
            scope: "preparation" as const,
            assurance: "caller-declared",
            algorithm: "git",
            value: "x",
          },
        ],
        preparationLineage: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_DIAGNOSTIC_RUN" });
  });
});
