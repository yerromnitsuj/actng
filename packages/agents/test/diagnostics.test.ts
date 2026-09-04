import { RequestContext } from "@mastra/core/request-context";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import { createDiagnosticRunIdentity } from "@actuarial-ts/compliance";
import { runValidatedMetricDiagnostics, validateDiagnosticRunInput } from "@actuarial-ts/data";
import { describe, expect, it } from "vitest";
import { AgentsError } from "../src/errors.js";
import {
  createDiagnosticSelectionTool,
  diagnosticAgentToolInputSchema,
  type DiagnosticAgentRunPreset,
} from "../src/diagnostics.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "agent-fleet",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    { id: "reported", displayName: "Reported", description: "Reported claims", source: "loss", kind: "count", unit: "claim", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", countPopulationId: "claims" },
    { id: "closed", displayName: "Closed", description: "Closed claims", source: "loss", kind: "count", unit: "claim", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", countPopulationId: "claims" },
    { id: "exposure", displayName: "Exposure", description: "Earned exposure", source: "exposure", kind: "exposure", unit: "vehicle-year", developmentSemantics: "point-in-time", aggregation: "sum", missing: "unknown", exposureBasisId: "earned", exposureTiming: "origin-static" },
  ],
  countPopulations: [{ id: "claims", displayName: "Claims", subject: "claim", unit: "claim", description: "One per claim" }],
  exposureBases: [{ id: "earned", displayName: "Earned vehicles", basis: "earned", unit: "vehicle-year", description: "Earned vehicle years" }],
  amountBases: [],
  derivedMeasures: [],
  formulas: [CASUALTY_FORMULA_TEMPLATES.find((item) => item.id === "frequency")!],
  instances: [
    { id: "z-reported-frequency", version: "1.0.0", formulaId: "frequency", bindings: { claims: { op: "measure", measureId: "reported" }, exposure: { op: "measure", measureId: "exposure" } }, presentation: { displayName: "Reported frequency", description: "Reported per exposure", displayUnit: "claim per vehicle-year", scale: 1, numeratorLabel: "reported", denominatorLabel: "exposure" }, rules: [] },
    { id: "a-closed-frequency", version: "1.0.0", formulaId: "frequency", bindings: { claims: { op: "measure", measureId: "closed" }, exposure: { op: "measure", measureId: "exposure" } }, presentation: { displayName: "Closed frequency", description: "Closed per exposure", displayUnit: "claim per vehicle-year", scale: 1, numeratorLabel: "closed", denominatorLabel: "exposure" }, rules: [] },
  ],
  reviewRules: [],
  periodAxis: { kind: "calendar", originCadence: "year", valuationCadence: "quarter", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 },
};

const compiled = compileDiagnosticDefinition(definition);
const ids = ["z-reported-frequency", "a-closed-frequency"] as const;

async function provenance(instanceIds: readonly string[], runPresetId = "approved") {
  const run = runValidatedMetricDiagnostics(validateDiagnosticRunInput({
    definition,
    losses: [{ rowType: "aggregate", recordId: "row-1", sourceGroup: "fleet", origin: "2025", valuation: "2025-03-31", complete: true, source: { artifactId: "loss-run", sourceRow: 2 }, measures: { reported: 4, closed: 2 } }],
    exposures: [{ key: "exp-1", sourceGroup: "fleet", origin: "2025", measureId: "exposure", value: 20, complete: true, source: { artifactId: "exposures", sourceRow: 2 } }],
    filter: { instanceIds: [...instanceIds] },
    runPresetId,
    datasetArtifactId: "loss-run",
  }));
  if (run.status !== "completed") throw new Error("diagnostic fixture unexpectedly blocked");
  return createDiagnosticRunIdentity({ completedRun: run, artifacts: [{ id: "loss-run", scope: "input", assurance: "sdk-computed", bytes: new TextEncoder().encode("loss") }, { id: "exposures", scope: "input", assurance: "sdk-computed", bytes: new TextEncoder().encode("exposure") }] });
}

function context(value: unknown = "tenant-7") {
  const requestContext = new RequestContext();
  requestContext.set("projectId", value);
  return { requestContext } as never;
}

function preset(overrides: Partial<DiagnosticAgentRunPreset> = {}): DiagnosticAgentRunPreset {
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
  try { build(); } catch (error) { expect((error as AgentsError).code).toBe("BAD_DIAGNOSTIC_CATALOG"); }
}

describe("diagnostic trusted-catalog tool", () => {
  it("accepts only IDs/view in its strict model input", () => {
    expect(diagnosticAgentToolInputSchema.parse({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" })).toBeTruthy();
    expect(() => diagnosticAgentToolInputSchema.parse({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence", basis: {} })).toThrow();
    for (const forbidden of ["projectId", "definition", "filter", "rules", "provenance"]) {
      expect(() => diagnosticAgentToolInputSchema.parse({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence", [forbidden]: "x" })).toThrow();
    }
  });

  it("runs an exact, sorted selection and returns only selected identity keys", async () => {
    let received: readonly string[] = [];
    const tool = createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: async ({ tenant, instanceIds }) => { expect(tenant).toBe("tenant-7"); received = instanceIds; return provenance(instanceIds); } })] });
    const result = await tool.execute({ runPresetId: "approved", instanceIds: [ids[0], ids[1], ids[0]], view: "latest-diagonal" }, context());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(received).toEqual([ids[1], ids[0]]);
    expect(result.instanceIds).toEqual([ids[1], ids[0]]);
    expect(Object.keys(result.formulaFingerprints)).toEqual(["frequency"]);
    expect(Object.keys(result.calculationFingerprints)).toEqual([ids[1], ids[0]]);
    expect(result.definitionIntegrity).toBe(compiled.definitionIntegrity);
    expect(result.runResultFingerprint).toMatch(/^fnv1a64-jcs-v1:/);
    expect(result.display.view).toBe("latest-diagonal");
  });

  it("fails tenant, preset, and allowlist checks in order without throwing", async () => {
    let calls = 0;
    const tool = createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: async ({ instanceIds }) => { calls += 1; return provenance(instanceIds); } })] });
    await expect(tool.execute({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" }, {} as never)).resolves.toMatchObject({ success: false, error: { code: "NO_TENANT_CONTEXT" } });
    await expect(tool.execute({ runPresetId: "missing", instanceIds: [ids[0]], view: "emergence" }, context())).resolves.toMatchObject({ success: false, error: { code: "UNKNOWN_DIAGNOSTIC_PRESET" } });
    await expect(tool.execute({ runPresetId: "approved", instanceIds: ["unknown"], view: "emergence" }, context())).resolves.toMatchObject({ success: false, error: { code: "UNAPPROVED_DIAGNOSTIC_INSTANCE" } });
    expect(calls).toBe(0);
  });

  it("normalizes malformed raw input before tenant or host execution", async () => {
    let calls = 0;
    const tool = createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: async ({ instanceIds }) => { calls += 1; return provenance(instanceIds); } })] });
    await expect(tool.execute({ runPresetId: "approved", instanceIds: [], view: "emergence" }, context())).resolves.toEqual({ success: false, error: { code: "TOOL_INPUT_INVALID", message: "Tool input failed schema validation" } });
    expect(calls).toBe(0);
  });

  it("rejects unauthenticated, cross-definition, wrong-preset, and cached-superset runs", async () => {
    const cases = [
      async () => ({}) as never,
      async () => provenance([ids[0]], "different"),
      async () => provenance(ids),
    ];
    for (const execute of cases) {
      const tool = createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: execute as never })] });
      await expect(tool.execute({ runPresetId: "approved", instanceIds: [ids[0]], view: "triangles" }, context())).resolves.toMatchObject({ success: false, error: { code: "DIAGNOSTIC_RUN_MISMATCH" } });
    }
    const other = compileDiagnosticDefinition({ ...definition, id: "other" });
    const tool = createDiagnosticSelectionTool({ definition: other, presets: [{ ...preset(), definitionIntegrity: other.definitionIntegrity, execute: ({ instanceIds }) => provenance(instanceIds) }] });
    await expect(tool.execute({ runPresetId: "approved", instanceIds: [ids[0]], view: "triangles" }, context())).resolves.toMatchObject({ success: false, error: { code: "DIAGNOSTIC_RUN_MISMATCH" } });
  });

  it("copies and freezes host catalog authority at construction", async () => {
    const allowed = [...ids];
    let originalCalls = 0;
    const mutable = preset({ allowedInstanceIds: allowed, execute: async ({ instanceIds }) => { originalCalls += 1; return provenance(instanceIds); } }) as { id: string; definitionIntegrity: string; allowedInstanceIds: string[]; execute: DiagnosticAgentRunPreset["execute"] };
    const presets = [mutable];
    const tool = createDiagnosticSelectionTool({ definition: compiled, presets });
    allowed.length = 0;
    mutable.id = "mutated";
    mutable.definitionIntegrity = "wrong";
    mutable.execute = async () => { throw new Error("mutated"); };
    presets.length = 0;
    const result = await tool.execute({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" }, context());
    expect(result.success).toBe(true);
    expect(originalCalls).toBe(1);
  });

  it("validates the complete host catalog atomically", () => {
    const bad = [
      () => createDiagnosticSelectionTool({ definition: { ...compiled } as never, presets: [preset()] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [] }),
      () => createDiagnosticSelectionTool({ definition: compiled, id: "", presets: [preset()] }),
      () => createDiagnosticSelectionTool({ definition: compiled, description: " ", presets: [preset()] }),
      () => createDiagnosticSelectionTool({ definition: compiled, tenantContextKey: "", presets: [preset()] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ id: "" })] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset(), preset()] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ allowedInstanceIds: [ids[0], ids[0]] })] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ allowedInstanceIds: ["unknown"] })] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ definitionIntegrity: "wrong" })] }),
      () => createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: null as never })] }),
    ];
    for (const build of bad) catalogError(build);
  });

  it("preserves coded hostile executor failures as readonly envelopes", async () => {
    const tool = createDiagnosticSelectionTool({ definition: compiled, presets: [preset({ execute: async () => { throw Object.assign(new Error("host unavailable"), { code: "HOST_DOWN" }); } })] });
    const result = await tool.execute({ runPresetId: "approved", instanceIds: [ids[0]], view: "emergence" }, context());
    expect(result).toEqual({ success: false, error: { code: "HOST_DOWN", message: "host unavailable" } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { error: object }).error)).toBe(true);
  });
});
