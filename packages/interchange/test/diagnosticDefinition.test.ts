import { describe, expect, it } from "vitest";
import { compileDiagnosticDefinition, type DiagnosticDefinition } from "@actuarial-ts/core";
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
  parseDocument,
  stampIntegrity,
  type BundleDoc,
} from "../src/index.js";

const CREATED_AT = "2026-09-03T12:00:00.000Z";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "portable-frequency",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    { id: "reported", displayName: "Reported", description: "Reported claims", source: "loss", kind: "count", unit: "claim", developmentSemantics: "cumulative", aggregation: "sum", missing: "unknown", countPopulationId: "claims" },
    { id: "exposure", displayName: "Exposure", description: "Earned exposure", source: "exposure", kind: "exposure", unit: "vehicle-year", developmentSemantics: "point-in-time", aggregation: "sum", missing: "unknown", exposureBasisId: "earned", exposureTiming: "origin-static" },
  ],
  countPopulations: [{ id: "claims", displayName: "Claims", subject: "claim", unit: "claim", description: "One per claim" }],
  exposureBases: [{ id: "earned", displayName: "Earned vehicles", basis: "earned", unit: "vehicle-year", description: "Earned vehicle years" }],
  amountBases: [], derivedMeasures: [],
  formulas: [{ id: "frequency", version: "1.0.0", roles: { claims: { kind: "count" }, exposure: { kind: "exposure" } }, numerator: { op: "role", role: "claims" }, denominator: { op: "role", role: "exposure" }, denominatorPolicy: "positive-or-null" }],
  instances: [{ id: "reported-frequency", version: "1.0.0", formulaId: "frequency", bindings: { claims: { op: "measure", measureId: "reported" }, exposure: { op: "measure", measureId: "exposure" } }, presentation: { displayName: "Reported frequency", description: "Reported per exposure", displayUnit: "claims per vehicle-year", scale: 1, numeratorLabel: "reported", denominatorLabel: "exposure" }, rules: [] }],
  reviewRules: [],
  periodAxis: { kind: "calendar", originCadence: "year", valuationCadence: "quarter", originAnchor: "start", valuationAnchor: "end", ageUnit: "month", ageOffset: 0 },
};

function authored() {
  return diagnosticDefinitionToDoc(compileDiagnosticDefinition(definition), { createdAt: CREATED_AT });
}

describe("diagnostic-definition interchange", () => {
  it("writes 1.1.0 and round-trips to a new authentic compiled definition", () => {
    const doc = authored();
    expect(doc.interchangeVersion).toBe("1.1.0");
    const parsed = docToDiagnosticDefinition(JSON.parse(JSON.stringify(doc)));
    expect(parsed.definition.definition).toEqual(compileDiagnosticDefinition(definition).definition);
    expect(parsed.definition.definitionIntegrity).toBe(doc.diagnosticDefinition.identities.definition);
    expect(parsed.warnings).toEqual([]);
  });

  it("rejects structural compiled-definition lookalikes at the author boundary", () => {
    const compiled = compileDiagnosticDefinition(definition);
    expect(() => diagnosticDefinitionToDoc({ ...compiled } as never, { createdAt: CREATED_AT })).toThrow(/authentic/);
  });

  it("detects body mutation and independently detects stale nested identities", () => {
    const doc = authored();
    const changed = structuredClone(doc) as any;
    changed.diagnosticDefinition.definition.instances[0]!.presentation.displayName = "Changed";
    expect(() => docToDiagnosticDefinition(changed)).toThrow(/Integrity tag mismatch/);
    const restamped = stampIntegrity(changed);
    expect(() => docToDiagnosticDefinition(restamped)).toThrow(/identities do not match/);
  });

  it("preserves generic same-major fields while the semantic converter refuses unknown behavior", () => {
    const doc = authored();
    const future = structuredClone(doc) as any;
    future.futureEnvelope = "preserved";
    future.diagnosticDefinition.definition.measures[0] = {
      ...future.diagnosticDefinition.definition.measures[0]!,
      futureBehavior: true,
    } as never;
    const restamped = stampIntegrity(future);
    const generic = parseDocument(restamped).doc as any;
    expect(generic.futureEnvelope).toBe("preserved");
    expect(generic.diagnosticDefinition.definition.measures[0].futureBehavior).toBe(true);
    expect(() => docToDiagnosticDefinition(restamped)).toThrow(/unsupported executable/i);
  });

  it("verifies nested definitions and covers them with bundle integrity", () => {
    const nested = authored();
    const bundle = stampIntegrity<BundleDoc>({
      interchangeVersion: "1.1.0", kind: "bundle", generator: nested.generator,
      createdAt: CREATED_AT, bundle: {},
      interchange: { triangles: [], selections: [], results: [], diagnosticDefinitions: [nested] },
    });
    expect(parseDocument(bundle).doc.kind).toBe("bundle");
    const changed = structuredClone(bundle) as any;
    changed.interchange.diagnosticDefinitions![0]!.diagnosticDefinition.definition.id = "changed";
    expect(() => parseDocument(changed)).toThrow(/Integrity tag mismatch/);
  });
});
