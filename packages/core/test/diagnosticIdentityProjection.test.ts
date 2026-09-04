import { describe, expect, it } from "vitest";
import {
  DiagnosticValidationError,
  compileDiagnosticDefinition,
  getMetricDiagnosticsResultIdentity,
  getPreparedDiagnosticDataIdentity,
  normalizeDiagnosticsFilterIdentity,
  prepareDiagnosticData,
  projectDiagnosticIdentity,
  runMetricDiagnostics,
  type DiagnosticDefinition,
  type DiagnosticsFilter,
} from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "projection",
  version: "1",
  lossRowGrain: "aggregate",
  measures: [],
  countPopulations: [],
  exposureBases: [],
  amountBases: [],
  derivedMeasures: [],
  formulas: [],
  instances: [],
  reviewRules: [],
  periodAxis: {
    kind: "calendar",
    originCadence: "year",
    valuationCadence: "year",
    originAnchor: "start",
    valuationAnchor: "end",
    ageUnit: "month",
    ageOffset: 0,
  },
};

describe("normative diagnostic identity projection", () => {
  it("materializes source fields and all filter selectors without changing execution data", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition),
      losses: [
        {
          rowType: "aggregate",
          recordId: "r",
          sourceGroup: "all",
          origin: "2024",
          valuation: "2024",
          complete: true,
          measures: {},
          source: { artifactId: "loss", sourceRow: -0 },
        },
      ],
      exposures: [],
      filter: {},
      expectedCells: [
        { sourceGroup: "all", origin: "2024", valuation: "2024" },
      ],
    });
    const identity = getPreparedDiagnosticDataIdentity(prepared);
    expect(identity.filter).toEqual({
      sourceGroups: null,
      outputGroups: null,
      origins: null,
      originFrom: null,
      originThrough: null,
      valuations: null,
      valuationFrom: null,
      valuationThrough: null,
      minDevelopmentAge: null,
      maxDevelopmentAge: null,
      instanceIds: null,
    });
    expect(identity.inputAudit[0]!.record.source).toEqual({
      artifactId: "loss",
      sourceFile: null,
      sourceSheet: null,
      sourceRow: 0,
      sourceCell: null,
    });
    expect(identity.expectedCells).toEqual([
      { sourceGroup: "all", origin: "2024", valuation: "2024", source: null },
    ]);
    expect(prepared.expectedCells[0]).not.toHaveProperty("source");
    expect(prepared.inputAudit[0]!.record.source).not.toHaveProperty(
      "sourceFile",
    );
  });

  it("returns an owned result identity and does not interpret free JSON as source evidence", () => {
    const prepared = prepareDiagnosticData({
      definition: compileDiagnosticDefinition(definition),
      losses: [],
      exposures: [],
    });
    const callerResult = structuredClone(runMetricDiagnostics({ prepared }));
    const identity = getMetricDiagnosticsResultIdentity(callerResult);
    expect(identity).not.toBe(callerResult);
    expect(Object.isFrozen(callerResult)).toBe(false);
    expect(Object.isFrozen(callerResult.emergence)).toBe(false);
    expect(Object.isFrozen(identity.emergence)).toBe(true);
    const free = {
      groupDimensions: {
        all: {
          source: { artifactId: "metadata" },
          sources: [{ artifactId: "metadata" }],
        },
      },
    };
    expect(projectDiagnosticIdentity(free)).toEqual(free);
    const point = { dimensions: free.groupDimensions.all };
    expect(projectDiagnosticIdentity(point)).toEqual(point);
  });

  it("preserves absent versus empty filters and does not freeze caller selectors", () => {
    const filter = { sourceGroups: [] as string[] };
    expect(normalizeDiagnosticsFilterIdentity(null)).toBeNull();
    expect(normalizeDiagnosticsFilterIdentity(filter)?.sourceGroups).toEqual(
      [],
    );
    expect(Object.isFrozen(filter.sourceGroups)).toBe(false);
  });

  it.each([
    [42, "invalid-type", "$", "Filter must be a plain object or null"],
    [{ sourceGroups: "bad" }, "invalid-type", "$.sourceGroups", "Filter selector must be an array"],
    [{ origins: [2024] }, "invalid-string", "$.origins[0]", "Filter selectors must use nonempty token strings"],
    [{ originFrom: " 2024" }, "invalid-string", "$.originFrom", "Filter selectors must use nonempty token strings"],
    [{ minDevelopmentAge: -1 }, "invalid-number", "$.minDevelopmentAge", "Development-age bounds must be nonnegative safe integers"],
    [{ minDevelopmentAge: 2, maxDevelopmentAge: 1 }, "invalid-configuration", "$", "Minimum development age exceeds maximum"],
    [{ futureSelector: true }, "unknown-key", "$.futureSelector", "Unknown filter key futureSelector"],
  ])("rejects malformed public filter input %# with exact typed issues", (filter, code, path, message) => {
    expect(() => normalizeDiagnosticsFilterIdentity(filter as DiagnosticsFilter)).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [{ domain: "configuration", code, path, message }],
      }),
    );
  });

  it("canonicalizes filter selector sets and negative zero without freezing callers", () => {
    const filter = { sourceGroups: ["z", "a", "z"], minDevelopmentAge: -0 };
    const identity = normalizeDiagnosticsFilterIdentity(filter)!;
    expect(identity.sourceGroups).toEqual(["a", "z"]);
    expect(Object.is(identity.minDevelopmentAge, 0)).toBe(true);
    expect(Object.isFrozen(identity.sourceGroups)).toBe(true);
    expect(filter.sourceGroups).toEqual(["z", "a", "z"]);
    expect(Object.isFrozen(filter.sourceGroups)).toBe(false);
  });

  it("rejects cyclic identity values with a typed issue", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    try {
      projectDiagnosticIdentity(value);
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticValidationError);
      expect((error as DiagnosticValidationError).issues).toEqual([
        {
          domain: "input",
          code: "cycle",
          path: "$.self",
          message: "JSON value contains a cycle",
        },
      ]);
    }
  });

  it("does not silently discard unknown source evidence", () => {
    expect(() =>
      projectDiagnosticIdentity({
        source: { artifactId: "file", futureEvidence: true },
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          {
            domain: "input",
            code: "unknown-key",
            path: "$.source.futureEvidence",
            message: "Unknown source-location key futureEvidence",
          },
        ],
      }),
    );
  });
});
