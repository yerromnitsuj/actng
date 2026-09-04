import { describe, expect, it } from "vitest";
import {
  CASUALTY_FORMULA_TEMPLATES,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import { parseDocument } from "@actuarial-ts/interchange";
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

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "fleet",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported",
      description: "Reported claims",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "exposure",
      displayName: "Exposure",
      description: "Earned exposure",
      source: "exposure",
      kind: "exposure",
      unit: "vehicle-year",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "earned",
      exposureTiming: "origin-static",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "One per claim",
    },
  ],
  exposureBases: [
    {
      id: "earned",
      displayName: "Earned vehicles",
      basis: "earned",
      unit: "vehicle-year",
      description: "Earned vehicle years",
    },
  ],
  amountBases: [],
  derivedMeasures: [],
  formulas: [CASUALTY_FORMULA_TEMPLATES[0]],
  instances: [
    {
      id: "reported-frequency",
      version: "1.0.0",
      formulaId: "frequency",
      bindings: {
        claims: { op: "measure", measureId: "reported" },
        exposure: { op: "measure", measureId: "exposure" },
      },
      presentation: {
        displayName: "Reported frequency",
        description: "Reported per exposure",
        displayUnit: "claim per vehicle-year",
        scale: 1,
        numeratorLabel: "reported",
        denominatorLabel: "exposure",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: {
    kind: "calendar",
    originCadence: "year",
    valuationCadence: "quarter",
    originAnchor: "start",
    valuationAnchor: "end",
    ageUnit: "month",
    ageOffset: 0,
  },
};

function completedRun() {
  const outcome = runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
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
    }),
  );
  if (outcome.status !== "completed")
    throw new Error("fixture unexpectedly blocked");
  return outcome;
}

describe("sealed diagnostic run provenance", () => {
  it("replays, fingerprints, freezes, verifies, and supplies typed bundle definitions", async () => {
    const run = completedRun();
    const inputArtifacts = [
      {
        id: "loss-run",
        assurance: "sdk-computed" as const,
        bytes: new TextEncoder().encode("loss"),
      },
      {
        id: "exposures",
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
      core: "0.6.1",
      data: "0.6.1",
      compliance: "0.6.1",
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
        "@actuarial-ts/core": "0.6.1",
        "@actuarial-ts/data": "0.6.1",
        "@actuarial-ts/compliance": "0.6.1",
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
        assurance: "sdk-computed" as const,
        bytes: new TextEncoder().encode("loss"),
      },
      {
        id: "exposures",
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
          assurance: "sdk-computed",
          bytes: new Uint8Array([1]),
        },
        {
          id: "exposures",
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
        "@actuarial-ts/core": "0.6.1",
        "@actuarial-ts/data": "0.6.1",
        "@actuarial-ts/compliance": "0.6.1",
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
        "$.diagnosticRuns[0].result.emergence[0].metrics.reported-frequency.calculationFingerprint",
    });
  });

  it("snapshots SDK bytes before the first await and hashes that exact copy", async () => {
    const bytes = new TextEncoder().encode("loss");
    const pending = createDiagnosticRunIdentity({
      completedRun: completedRun(),
      inputArtifacts: [
        { id: "loss-run", assurance: "sdk-computed", bytes },
        {
          id: "exposures",
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
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([1]),
      },
      {
        id: "exposures",
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
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([1]),
      },
      {
        id: "exposures",
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([2]),
      },
    ];
    await expect(
      createDiagnosticRunIdentity({
        completedRun: run,
        inputArtifacts: [
          ...required,
          { id: "bad", assurance: "future" } as never,
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
