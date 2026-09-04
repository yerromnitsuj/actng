import { RequestContext } from "@mastra/core/request-context";
import { makeCoreTool } from "@mastra/core/utils";
import {
  standardSchemaToJSONSchema,
  type StandardSchemaWithJSON,
} from "@mastra/core/schema";
import { readFileSync } from "node:fs";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import { createDiagnosticRunIdentity } from "@actuarial-ts/compliance";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import { describe, expect, it } from "vitest";
import { AgentsError } from "../src/errors.js";
import {
  createDiagnosticSelectionTool,
  diagnosticAgentToolInputSchema,
  diagnosticAgentToolResultSchema,
  type DiagnosticAgentRunPreset,
} from "../src/diagnostics.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "agent-fleet",
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
      id: "closed",
      displayName: "Closed",
      description: "Closed claims",
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
  formulas: [
    CASUALTY_FORMULA_TEMPLATES.find((item) => item.id === "frequency")!,
  ],
  instances: [
    {
      id: "z-reported-frequency",
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
    {
      id: "a-closed-frequency",
      version: "1.0.0",
      formulaId: "frequency",
      bindings: {
        claims: { op: "measure", measureId: "closed" },
        exposure: { op: "measure", measureId: "exposure" },
      },
      presentation: {
        displayName: "Closed frequency",
        description: "Closed per exposure",
        displayUnit: "claim per vehicle-year",
        scale: 1,
        numeratorLabel: "closed",
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

const compiled = compileDiagnosticDefinition(definition);
const ids = ["z-reported-frequency", "a-closed-frequency"] as const;
const hostileCorpus = JSON.parse(
  readFileSync(
    new URL(
      "../../../interop/conformance/fixtures/diagnostics/hostile-boundaries.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  mutations: { id: string; value: unknown }[];
};
const prototypeKeys = [
  ...hostileCorpus.mutations.flatMap((item) =>
    item.id.startsWith("prototype-") && typeof item.value === "string"
      ? [item.value]
      : [],
  ),
  ":__proto__",
];

async function provenance(
  instanceIds: readonly string[],
  runPresetId = "approved",
  runDefinition = definition,
  runOverrides: Record<string, unknown> = {},
) {
  const run = runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
      definition: runDefinition,
      losses: [
        {
          rowType: "aggregate",
          recordId: "row-1",
          sourceGroup: "fleet",
          origin: "2025",
          valuation: "2025Q1",
          complete: true,
          source: { artifactId: "loss-run", sourceRow: 2 },
          measures: { reported: 4, closed: 2 },
        },
      ],
      exposures: [
        {
          key: "exp-1",
          sourceGroup: "fleet",
          origin: "2025",
          measureId: "exposure",
          value: 20,
          complete: true,
          source: { artifactId: "exposures", sourceRow: 2 },
        },
      ],
      filter: { instanceIds: [...instanceIds] },
      runPresetId,
      datasetArtifactId: "loss-run",
      ...runOverrides,
    }),
  );
  if (run.status !== "completed")
    throw new Error("diagnostic fixture unexpectedly blocked");
  return createDiagnosticRunIdentity({
    completedRun: run,
    inputArtifacts: [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed",
        bytes: new TextEncoder().encode("loss"),
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
}

function context(value: unknown = "tenant-7") {
  const requestContext = new RequestContext();
  requestContext.set("projectId", value);
  return { requestContext } as never;
}

function preset(
  overrides: Partial<DiagnosticAgentRunPreset> = {},
): DiagnosticAgentRunPreset {
  return {
    id: "approved",
    definitionIntegrity: compiled.definitionIntegrity,
    allowedInstanceIds: ids,
    execute: ({ instanceIds }) => provenance(instanceIds),
    ...overrides,
  };
}

function catalogError(build: () => unknown) {
  expect(build).toThrowError(AgentsError);
  try {
    build();
  } catch (error) {
    expect((error as AgentsError).code).toBe("BAD_DIAGNOSTIC_CATALOG");
  }
}

describe("diagnostic trusted-catalog tool", () => {
  it.each(["emergence", "latest-diagonal", "triangles"] as const)(
    "preserves prototype-name records in the %s output seam",
    async (view) => {
      const keys = prototypeKeys;
      const dimensions = Object.fromEntries(
        keys.map((key) => [key, { [key]: "retained" }]),
      );
      const prototypeDefinition: DiagnosticDefinition = {
        ...definition,
        measures: [
          { ...definition.measures[0]!, id: "__proto__" },
          definition.measures[2]!,
        ],
        formulas: keys.map((key) => ({ ...definition.formulas[0]!, id: key })),
        instances: keys.map((key) => ({
          ...definition.instances[0]!,
          id: key,
          formulaId: key,
          bindings: {
            claims: { op: "measure" as const, measureId: "__proto__" },
            exposure: { op: "measure" as const, measureId: "exposure" },
          },
        })),
      };
      const prototypeCompiled =
        compileDiagnosticDefinition(prototypeDefinition);
      const tool = createDiagnosticSelectionTool({
        definition: prototypeCompiled,
        runPresets: [
          {
            id: "approved",
            definitionIntegrity: prototypeCompiled.definitionIntegrity,
            allowedInstanceIds: keys,
            execute: ({ instanceIds }) =>
              provenance(instanceIds, "approved", prototypeDefinition, {
                losses: [
                  {
                    rowType: "aggregate",
                    recordId: "prototype-row",
                    sourceGroup: "fleet",
                    origin: "2025",
                    valuation: "2025Q1",
                    complete: true,
                    source: { artifactId: "loss-run", sourceRow: 2 },
                    measures: { ["__proto__"]: 4 },
                  },
                ],
                groupMap: { fleet: "__proto__" },
                groupDimensions: { ["__proto__"]: dimensions },
              }),
          },
        ],
      });
      const result = await tool.execute(
        { runPresetId: "approved", instanceIds: keys, view },
        context(),
      );
      const requestContext = new RequestContext();
      requestContext.set("projectId", "tenant-7");
      const coreTool = makeCoreTool(tool, { name: tool.id, requestContext });
      const throughMastra = await coreTool.execute!(
        { runPresetId: "approved", instanceIds: keys, view },
        { requestContext } as never,
      );
      expect(throughMastra).toEqual(result);
      const outputJsonSchema = standardSchemaToJSONSchema(
        tool.outputSchema as StandardSchemaWithJSON<unknown, unknown>,
        { io: "output" },
      );
      expect(JSON.stringify(outputJsonSchema)).toContain("formulaFingerprints");
      expect(JSON.stringify(outputJsonSchema)).toContain(
        "additionalProperties",
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(Object.keys(result.data.formulaFingerprints).sort()).toEqual(
        [...keys].sort(),
      );
      expect(Object.keys(result.data.calculationFingerprints).sort()).toEqual(
        [...keys].sort(),
      );
      const display = result.data.display;
      const evaluations =
        display.view === "triangles"
          ? display.triangles.map(
              (triangle) => triangle.cells[0]![0]!.evaluation,
            )
          : Object.values(display.points[0]!.metrics);
      expect(evaluations).toHaveLength(keys.length);
      for (const evaluation of evaluations) {
        expect(Object.hasOwn(evaluation.components, "__proto__")).toBe(true);
        expect(evaluation.components.__proto__?.value).toBe(4);
        expect(evaluation.calculation.value).toBe(0.2);
      }
      if (display.view !== "triangles") {
        expect(Object.keys(display.points[0]!.metrics).sort()).toEqual(
          [...keys].sort(),
        );
        expect(display.points[0]!.dimensions).toEqual(dimensions);
      }
      expect(diagnosticAgentToolResultSchema.parse(result)).toEqual(result);

      const malformed = structuredClone(result) as any;
      malformed.data.formulaFingerprints.__proto__ = "invalid-tag";
      expect(diagnosticAgentToolResultSchema.safeParse(malformed).success).toBe(
        false,
      );
      const malformedMetric = structuredClone(result) as any;
      const metric =
        view === "triangles"
          ? malformedMetric.data.display.triangles[0].cells[0][0].evaluation
          : malformedMetric.data.display.points[0].metrics.__proto__;
      metric.components.__proto__.value = "wrong-type";
      expect(
        diagnosticAgentToolResultSchema.safeParse(malformedMetric).success,
      ).toBe(false);
    },
  );

  it.each(["emergence", "latest-diagonal", "triangles"] as const)(
    "returns the normative %s display envelope",
    async (view) => {
      const tool = createDiagnosticSelectionTool({
        definition: compiled,
        runPresets: [preset()],
      });
      const result = await tool.execute(
        { runPresetId: "approved", instanceIds: [ids[0]], view },
        context(),
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(Object.keys(result).sort()).toEqual(["data", "success"]);
      expect(result.data.display.view).toBe(view);
      if (result.data.display.view === "triangles") {
        expect(Object.keys(result.data.display).sort()).toEqual([
          "triangles",
          "view",
        ]);
        expect(result.data.display.triangles).toHaveLength(1);
      } else {
        expect(Object.keys(result.data.display).sort()).toEqual([
          "points",
          "view",
        ]);
        expect(result.data.display.points).toHaveLength(1);
        expect(result.data.display.points[0]).not.toHaveProperty("components");
        expect(result.data.display.points[0]?.metrics[ids[0]]).toBeDefined();
      }
    },
  );
  it("validates nested review identity and rejects malformed public output", async () => {
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [preset()],
    });
    const result = await tool.execute(
      { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
      context(),
    );
    expect(result.success).toBe(true);
    expect(diagnosticAgentToolResultSchema.safeParse(result).success).toBe(
      true,
    );
    const corruptions = [
      (value: any) => {
        value.data.review.identityBody = true;
      },
      (value: any) => {
        value.data.review.identityBody.summary = {};
      },
      (value: any) => {
        value.data.review.identityBody.checks[0].status = "future";
      },
      (value: any) => {
        value.data.review.report.checks[0].findings = [
          { code: "x", message: "x", context: { developmentAge: "wrong" } },
        ];
      },
      (value: any) => {
        value.data.review.evaluations = [
          {
            ruleId: "x",
            ruleKind: "compare",
            status: "pass",
            severity: "warning",
            triggerReason: null,
            left: 1,
            right: 2,
            relation: "less",
            notEvaluatedReasons: [],
            expressionOverflows: [],
            scope: true,
          },
        ];
      },
      (value: any) => {
        value.data.instanceIds = [];
      },
      (value: any) => {
        value.data.definitionIntegrity = "not-a-tag";
      },
      (value: any) => {
        value.data.runPresetId = "bad\ud800";
      },
    ];
    for (const corrupt of corruptions) {
      const invalid = structuredClone(result);
      corrupt(invalid);
      expect(diagnosticAgentToolResultSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
  it("accepts only IDs/view in its strict model input", () => {
    expect(
      diagnosticAgentToolInputSchema.parse({
        runPresetId: "approved",
        instanceIds: [ids[0]],
        view: "emergence",
      }),
    ).toBeTruthy();
    expect(() =>
      diagnosticAgentToolInputSchema.parse({
        runPresetId: "approved",
        instanceIds: [ids[0]],
        view: "emergence",
        basis: {},
      }),
    ).toThrow();
    for (const forbidden of [
      "projectId",
      "definition",
      "filter",
      "rules",
      "provenance",
    ]) {
      expect(() =>
        diagnosticAgentToolInputSchema.parse({
          runPresetId: "approved",
          instanceIds: [ids[0]],
          view: "emergence",
          [forbidden]: "x",
        }),
      ).toThrow();
    }
  });

  it("refuses removed ageMonths in a diagnostic review context", async () => {
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [preset()],
    });
    const result = await tool.execute(
      { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
      context(),
    );
    if (!result.success) throw new Error("Valid fixture failed");
    const candidate = structuredClone(result) as any;
    const contextValue: Record<string, unknown> = {
      developmentAge: 12,
      ageUnit: "month",
    };
    candidate.data.review.report.checks[0].findings = [
      { code: "context", message: "Context", context: contextValue },
    ];
    expect(diagnosticAgentToolResultSchema.safeParse(candidate).success).toBe(
      true,
    );
    contextValue.ageMonths = 12;
    expect(diagnosticAgentToolResultSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("runs an exact, sorted selection and returns only selected identity keys", async () => {
    let received: readonly string[] = [];
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [
        preset({
          execute: async ({ tenantId, instanceIds }) => {
            expect(tenantId).toBe("tenant-7");
            received = instanceIds;
            return provenance(instanceIds);
          },
        }),
      ],
    });
    const result = await tool.execute(
      {
        runPresetId: "approved",
        instanceIds: [ids[0], ids[1], ids[0]],
        view: "latest-diagonal",
      },
      context(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(received).toEqual([ids[1], ids[0]]);
    expect(result.data.instanceIds).toEqual([ids[1], ids[0]]);
    expect(Object.keys(result.data.formulaFingerprints)).toEqual(["frequency"]);
    expect(Object.keys(result.data.calculationFingerprints)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect(result.data.definitionIntegrity).toBe(compiled.definitionIntegrity);
    expect(result.data.runResultFingerprint).toMatch(/^fnv1a64-jcs-v1:/);
    expect(result.data.display.view).toBe("latest-diagonal");
  });

  it("fails tenant, preset, and allowlist checks in order without throwing", async () => {
    let calls = 0;
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [
        preset({
          execute: async ({ instanceIds }) => {
            calls += 1;
            return provenance(instanceIds);
          },
        }),
      ],
    });
    await expect(
      tool.execute(
        { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
        {} as never,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "NO_TENANT_CONTEXT" },
    });
    await expect(
      tool.execute(
        { runPresetId: "missing", instanceIds: [ids[0]], view: "emergence" },
        context(),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNKNOWN_DIAGNOSTIC_PRESET" },
    });
    await expect(
      tool.execute(
        {
          runPresetId: "approved",
          instanceIds: ["unknown"],
          view: "emergence",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAPPROVED_DIAGNOSTIC_INSTANCE" },
    });
    expect(calls).toBe(0);
  });

  it("normalizes malformed raw input before tenant or host execution", async () => {
    let calls = 0;
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [
        preset({
          execute: async ({ instanceIds }) => {
            calls += 1;
            return provenance(instanceIds);
          },
        }),
      ],
    });
    await expect(
      tool.execute(
        { runPresetId: "approved", instanceIds: [], view: "emergence" },
        context(),
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_INPUT_INVALID",
        message: "Tool input failed schema validation",
      },
    });
    expect(calls).toBe(0);
  });

  it("rejects unauthenticated, cross-definition, wrong-preset, and cached-superset runs", async () => {
    const cases = [
      async () => ({}) as never,
      async () => provenance([ids[0]], "different"),
      async () => provenance(ids),
    ];
    for (const execute of cases) {
      const tool = createDiagnosticSelectionTool({
        definition: compiled,
        runPresets: [preset({ execute: execute as never })],
      });
      await expect(
        tool.execute(
          { runPresetId: "approved", instanceIds: [ids[0]], view: "triangles" },
          context(),
        ),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "DIAGNOSTIC_RUN_MISMATCH" },
      });
    }
    const other = compileDiagnosticDefinition({ ...definition, id: "other" });
    const tool = createDiagnosticSelectionTool({
      definition: other,
      runPresets: [
        {
          ...preset(),
          definitionIntegrity: other.definitionIntegrity,
          execute: ({ instanceIds }) => provenance(instanceIds),
        },
      ],
    });
    await expect(
      tool.execute(
        { runPresetId: "approved", instanceIds: [ids[0]], view: "triangles" },
        context(),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "DIAGNOSTIC_RUN_MISMATCH" },
    });
  });

  it("copies and freezes host catalog authority at construction", async () => {
    const allowed = [...ids];
    let originalCalls = 0;
    const mutable = preset({
      allowedInstanceIds: allowed,
      execute: async ({ instanceIds }) => {
        originalCalls += 1;
        return provenance(instanceIds);
      },
    }) as {
      id: string;
      definitionIntegrity: string;
      allowedInstanceIds: string[];
      execute: DiagnosticAgentRunPreset["execute"];
    };
    const presets = [mutable];
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: presets,
    });
    allowed.length = 0;
    mutable.id = "mutated";
    mutable.definitionIntegrity = "wrong";
    mutable.execute = async () => {
      throw new Error("mutated");
    };
    presets.length = 0;
    const result = await tool.execute(
      { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
      context(),
    );
    expect(result.success).toBe(true);
    expect(originalCalls).toBe(1);
  });

  it("captures the authenticated definition authority before a host await", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const catalog = {
      definition: compiled,
      runPresets: [
        preset({
          execute: async ({ instanceIds }) => {
            await waiting;
            return provenance(instanceIds);
          },
        }),
      ],
    };
    const tool = createDiagnosticSelectionTool(catalog);
    const pending = tool.execute(
      { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
      context(),
    );
    catalog.definition = compileDiagnosticDefinition({
      ...definition,
      id: "changed-after-call",
    });
    release!();
    await expect(pending).resolves.toMatchObject({
      success: true,
      data: { definitionIntegrity: compiled.definitionIntegrity },
    });
  });

  it("validates the complete host catalog atomically", () => {
    for (const malformed of [
      { definition: compiled },
      { definition: compiled, runPresets: null },
      { definition: compiled, runPresets: [null] },
      {
        definition: compiled,
        runPresets: [preset({ allowedInstanceIds: null as never })],
      },
      { definition: compiled, runPresets: [preset()], description: null },
    ])
      catalogError(() => createDiagnosticSelectionTool(malformed as never));
    const bad = [
      () =>
        createDiagnosticSelectionTool({
          definition: { ...compiled } as never,
          runPresets: [preset()],
        }),
      () =>
        createDiagnosticSelectionTool({ definition: compiled, runPresets: [] }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          id: "",
          runPresets: [preset()],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          description: " ",
          runPresets: [preset()],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          tenantContextKey: "",
          runPresets: [preset()],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset({ id: "" })],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset(), preset()],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset({ allowedInstanceIds: [ids[0], ids[0]] })],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset({ allowedInstanceIds: ["unknown"] })],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset({ definitionIntegrity: "wrong" })],
        }),
      () =>
        createDiagnosticSelectionTool({
          definition: compiled,
          runPresets: [preset({ execute: null as never })],
        }),
    ];
    for (const build of bad) catalogError(build);
  });

  it("preserves coded hostile executor failures as readonly envelopes", async () => {
    const tool = createDiagnosticSelectionTool({
      definition: compiled,
      runPresets: [
        preset({
          execute: async () => {
            throw Object.assign(new Error("host unavailable"), {
              code: "HOST_DOWN",
            });
          },
        }),
      ],
    });
    const result = await tool.execute(
      { runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" },
      context(),
    );
    expect(result).toEqual({
      success: false,
      error: { code: "HOST_DOWN", message: "host unavailable" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { error: object }).error)).toBe(true);
  });
});
