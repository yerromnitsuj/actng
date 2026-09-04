import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileDiagnosticDefinition,
  ReservingError,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
  parseDocument,
  stampIntegrity,
  type BundleDoc,
} from "../src/index.js";

const CREATED_AT = "2026-09-03T12:00:00.000Z";
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

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "portable-frequency",
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
  formulas: [
    {
      id: "frequency",
      version: "1.0.0",
      roles: { claims: { kind: "count" }, exposure: { kind: "exposure" } },
      numerator: { op: "role", role: "claims" },
      denominator: { op: "role", role: "exposure" },
      denominatorPolicy: "positive-or-null",
    },
  ],
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
        displayUnit: "claims per vehicle-year",
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

function authored() {
  return diagnosticDefinitionToDoc(compileDiagnosticDefinition(definition), {
    createdAt: CREATED_AT,
  });
}

describe("diagnostic-definition interchange", () => {
  it.each(prototypeKeys)(
    "preserves the valid %s key in semantic registries and opaque extensions",
    (key) => {
      const portableDefinition: DiagnosticDefinition = {
        ...definition,
        countPopulations: [
          {
            ...definition.countPopulations[0]!,
            attributes: { [key]: "retained" },
          },
        ],
        exposureBases: [
          {
            ...definition.exposureBases[0]!,
            attributes: { [key]: "retained" },
          },
        ],
        formulas: [
          {
            ...definition.formulas[0]!,
            id: key,
            roles: { [key]: { kind: "count" }, exposure: { kind: "exposure" } },
            numerator: { op: "role", role: key },
          },
        ],
        instances: [
          {
            ...definition.instances[0]!,
            id: key,
            formulaId: key,
            bindings: {
              [key]: { op: "measure", measureId: "reported" },
              exposure: { op: "measure", measureId: "exposure" },
            },
          },
        ],
      };
      const compiled = compileDiagnosticDefinition(portableDefinition);
      const extensions = { [key]: { [key]: "opaque" } };
      const doc = diagnosticDefinitionToDoc(compiled, {
        createdAt: CREATED_AT,
        extensions,
      });
      expect(doc.diagnosticDefinition.definition).toEqual(compiled.definition);
      expect(
        Object.hasOwn(doc.diagnosticDefinition.identities.formulaById, key),
      ).toBe(true);
      expect(
        Object.hasOwn(
          doc.diagnosticDefinition.identities.calculationByInstanceId,
          key,
        ),
      ).toBe(true);
      expect(doc.extensions).toEqual(extensions);
      const parsed = parseDocument(JSON.parse(JSON.stringify(doc))).doc;
      expect(parsed).toEqual(doc);
      expect(docToDiagnosticDefinition(parsed).definition.definition).toEqual(
        compiled.definition,
      );
      expect(Object.isFrozen(extensions)).toBe(false);

      const invalid = structuredClone(doc) as any;
      invalid.diagnosticDefinition.definition.formulas[0].roles[key].kind =
        "unknown-kind";
      expect(() => parseDocument(stampIntegrity(invalid))).toThrow(
        /schema validation/,
      );
    },
  );

  it("preserves prototype-name opaque envelope fields but refuses executable additions", () => {
    const doc = authored();
    const envelope = { ...doc, ["__proto__"]: { future: true } };
    const parsed = parseDocument(envelope).doc;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ future: true });
    expect(
      docToDiagnosticDefinition(envelope).definition.definitionIntegrity,
    ).toBe(doc.diagnosticDefinition.identities.definition);
    const executable = structuredClone(doc) as any;
    Object.defineProperty(
      executable.diagnosticDefinition.definition.measures[0],
      "__proto__",
      {
        value: { future: true },
        enumerable: true,
        configurable: true,
        writable: true,
      },
    );
    const stamped = stampIntegrity(executable);
    expect(
      Object.hasOwn(
        (parseDocument(stamped).doc as any).diagnosticDefinition.definition
          .measures[0],
        "__proto__",
      ),
    ).toBe(true);
    expect(() =>
      docToDiagnosticDefinition(stamped, { strictness: "warn" }),
    ).toThrow(/unsupported executable/i);
  });

  it("writes 1.1.0 and round-trips to a new authentic compiled definition", () => {
    const doc = authored();
    expect(doc.interchangeVersion).toBe("1.1.0");
    const parsed = docToDiagnosticDefinition(JSON.parse(JSON.stringify(doc)));
    expect(parsed.definition.definition).toEqual(
      compileDiagnosticDefinition(definition).definition,
    );
    expect(parsed.definition.definitionIntegrity).toBe(
      doc.diagnosticDefinition.identities.definition,
    );
    expect(parsed.warnings).toEqual([]);
  });

  it("rejects structural compiled-definition lookalikes at the author boundary", () => {
    const compiled = compileDiagnosticDefinition(definition);
    expect(() =>
      diagnosticDefinitionToDoc({ ...compiled } as never, {
        createdAt: CREATED_AT,
      }),
    ).toThrow(/authentic/);
  });

  it.each([
    undefined,
    null,
    "wrong",
    { createdAt: CREATED_AT, unexpected: true },
    { createdAt: CREATED_AT, generator: null },
    { createdAt: CREATED_AT, extensions: { callback: () => {} } },
  ])(
    "rejects malformed author options with a structured error: %j",
    (options) => {
      try {
        diagnosticDefinitionToDoc(
          compileDiagnosticDefinition(definition),
          options as never,
        );
        expect.unreachable("malformed options must fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ReservingError);
        expect((error as ReservingError).code).toBe("BAD_INTERCHANGE");
      }
    },
  );

  it("snapshots author options, freezes output, and rejects malformed envelope fields", () => {
    const generator = { name: "custom", version: "1.0.0" };
    const extensions = { nested: { value: "original" } };
    const doc = diagnosticDefinitionToDoc(
      compileDiagnosticDefinition(definition),
      {
        createdAt: CREATED_AT,
        generator,
        extensions,
      },
    );
    generator.name = "mutated";
    extensions.nested.value = "mutated";
    expect(doc.generator.name).toBe("custom");
    expect((doc.extensions!.nested as { value: string }).value).toBe(
      "original",
    );
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.diagnosticDefinition.definition)).toBe(true);
    expect(() =>
      diagnosticDefinitionToDoc(compileDiagnosticDefinition(definition), {
        createdAt: "2026-02-30T12:00:00.000Z",
      }),
    ).toThrow(/BAD_INTERCHANGE|Invalid diagnostic-definition/);
    expect(() =>
      diagnosticDefinitionToDoc(compileDiagnosticDefinition(definition), {
        createdAt: CREATED_AT,
        generator: { name: "", version: "1.0.0" },
      }),
    ).toThrow(/BAD_INTERCHANGE|Invalid diagnostic-definition/);
  });

  it("detects body mutation and independently detects stale nested identities", () => {
    const doc = authored();
    const changed = structuredClone(doc) as any;
    changed.diagnosticDefinition.definition.instances[0]!.presentation.displayName =
      "Changed";
    expect(() => docToDiagnosticDefinition(changed)).toThrow(
      /Integrity tag mismatch/,
    );
    const restamped = stampIntegrity(changed);
    expect(() => docToDiagnosticDefinition(restamped)).toThrow(
      /identities do not match/,
    );
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
    expect(
      generic.diagnosticDefinition.definition.measures[0].futureBehavior,
    ).toBe(true);
    expect(() => docToDiagnosticDefinition(restamped)).toThrow(
      /unsupported executable/i,
    );
  });

  it("verifies nested definitions and covers them with bundle integrity", () => {
    const nested = authored();
    const bundle = stampIntegrity<BundleDoc>({
      interchangeVersion: "1.1.0",
      kind: "bundle",
      generator: nested.generator,
      createdAt: CREATED_AT,
      bundle: {},
      interchange: {
        triangles: [],
        selections: [],
        results: [],
        diagnosticDefinitions: [nested],
      },
    });
    expect(parseDocument(bundle).doc.kind).toBe("bundle");
    const changed = structuredClone(bundle) as any;
    changed.interchange.diagnosticDefinitions![0]!.diagnosticDefinition.definition.id =
      "changed";
    expect(() => parseDocument(changed)).toThrow(/Integrity tag mismatch/);
  });
});
