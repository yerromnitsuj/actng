import { describe, expect, it } from "vitest";
import {
  DiagnosticValidationError,
  reconcileDiagnosticExposures,
  type DiagnosticExposureObservation,
} from "../src/index.js";

const observation: DiagnosticExposureObservation = {
  key: "fleet",
  sourceGroup: "book",
  origin: "2024",
  measureId: "earned",
  value: 100,
  complete: true,
};
const timings = { earned: "origin-static" } as const;
function issuesOf(value: unknown) {
  try {
    reconcileDiagnosticExposures(
      value as DiagnosticExposureObservation[],
      timings,
    );
  } catch (error) {
    expect(error).toBeInstanceOf(DiagnosticValidationError);
    return (error as DiagnosticValidationError).issues;
  }
  throw new Error("Expected a typed diagnostic validation error");
}

describe("bounded exposure collections", () => {
  it("reconciles 250,000 fully attributed observations without a metadata-dependent collection ceiling", () => {
    const rows = Array.from({ length: 250_000 }, (_, index) => ({
      ...observation,
      key: `fleet-${index}`,
      source: {
        artifactId: "input",
        sourceFile: "exposure.xlsx",
        sourceSheet: "Exposure",
        sourceRow: index + 2,
        sourceCell: `D${index + 2}`,
      },
    }));
    const result = reconcileDiagnosticExposures(rows, timings);
    expect(result).toHaveLength(250_000);
    expect(
      result.every((item) => item.status === "valid" && item.value === 100),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    const first = result.find((item) => item.key === "fleet-0")!;
    expect(first.status).toBe("valid");
    if (first.status !== "valid") throw new Error("Expected valid cohort");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sources)).toBe(true);
    expect(Object.isFrozen(first.sources[0])).toBe(true);
    rows[0]!.source.sourceRow = 999;
    expect(first.sources[0]!.sourceRow).toBe(2);
    expect(Object.isFrozen(rows[0]!.source)).toBe(false);
  }, 60_000);

  it("retains a large conflicting cohort as frozen audited observations, not an oversized JSON snapshot", () => {
    const rows = Array.from({ length: 100_001 }, (_, index) => ({
      ...observation,
      value: index % 2,
      source: {
        artifactId: "input",
        sourceFile: "exposure.xlsx",
        sourceSheet: "Exposure",
        sourceRow: index,
      },
    }));
    const [result] = reconcileDiagnosticExposures(rows, timings);
    expect(result?.status).toBe("invalid");
    if (result?.status !== "invalid") throw new Error("Expected conflict");
    expect(result.issues).toEqual(["conflict"]);
    expect(result.observations).toHaveLength(100_001);
    expect(Object.isFrozen(result.observations)).toBe(true);
    expect(Object.isFrozen(result.observations[0])).toBe(true);
    expect(Object.isFrozen(result.observations[0]!.source)).toBe(true);
  }, 60_000);

  it("rejects collections above the documented bound before visiting any element", () => {
    const rows = Array(250_001);
    Object.defineProperty(rows, "0", {
      get: () => {
        throw new Error("Do not read");
      },
    });
    expect(issuesOf(rows)).toEqual([
      {
        domain: "input",
        code: "expression-limit",
        path: "$.observations",
        message: "Exposure observation count exceeds 250000",
      },
    ]);
  });

  it("rejects accessors, holes, symbols, custom prototypes, and method overrides without invoking them", () => {
    let calls = 0;
    const indexed = [observation];
    Object.defineProperty(indexed, "0", {
      get: () => {
        calls++;
        return observation;
      },
    });
    const method = [observation];
    Object.defineProperty(method, "entries", {
      get: () => {
        calls++;
        return () => [];
      },
    });
    const symbol = [observation];
    Object.defineProperty(symbol, Symbol.iterator, {
      value: () => {
        calls++;
        return [][Symbol.iterator]();
      },
    });
    const metadata = { ...observation, source: { artifactId: "input" } };
    Object.defineProperty(metadata.source, "sourceRow", {
      enumerable: true,
      get: () => {
        calls++;
        return 1;
      },
    });
    for (const rows of [
      indexed,
      method,
      symbol,
      Array(1),
      Object.setPrototypeOf([observation], null),
      [metadata],
    ])
      expect(
        issuesOf(rows).some((issue) => issue.code === "invalid-json-value"),
      ).toBe(true);
    expect(calls).toBe(0);
  });

  it("retains per-record node/depth/cycle limits and rejects nonfinite metadata", () => {
    expect(
      issuesOf([{ ...observation, padding: Array(1_000_001).fill(0) }]),
    ).toContainEqual(
      expect.objectContaining({
        code: "expression-limit",
        path: "$.observations[0]",
      }),
    );
    let nested: unknown = null;
    for (let index = 0; index < 256; index++) nested = { nested };
    expect(
      issuesOf([{ ...observation, nested }]).some(
        (issue) => issue.code === "expression-limit",
      ),
    ).toBe(true);
    const cycle = { ...observation } as Record<string, unknown>;
    cycle.self = cycle;
    expect(issuesOf([cycle])).toContainEqual(
      expect.objectContaining({
        code: "cycle",
        path: "$.observations[0].self",
      }),
    );
    expect(
      issuesOf([
        {
          ...observation,
          source: { artifactId: "input", sourceRow: Infinity },
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        code: "invalid-json-value",
        path: "$.observations[0].source.sourceRow",
      }),
    );
  });

  it("rejects hidden accessors on known observation and source fields before semantic validation", () => {
    let calls = 0;
    const hiddenValue = { ...observation };
    Object.defineProperty(hiddenValue, "value", {
      enumerable: false,
      get: () => {
        calls++;
        return 100;
      },
    });
    const hiddenSource = { ...observation, source: { artifactId: "input" } };
    Object.defineProperty(hiddenSource.source, "sourceRow", {
      enumerable: false,
      get: () => {
        calls++;
        return 1;
      },
    });
    expect(issuesOf([hiddenValue])).toContainEqual(
      expect.objectContaining({
        code: "invalid-json-value",
        path: "$.observations[0].value",
      }),
    );
    expect(issuesOf([hiddenSource])).toContainEqual(
      expect.objectContaining({
        code: "invalid-json-value",
        path: "$.observations[0].source.sourceRow",
      }),
    );
    expect(calls).toBe(0);
  });
});
