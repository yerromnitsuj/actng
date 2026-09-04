import { describe, expect, it } from "vitest";
import {
  DiagnosticValidationError,
  diagnosticJsonPreflight,
  diagnosticRecord,
  hasDiagnosticOwn,
  isDiagnosticToken,
  isRealIsoDate,
  normalizeDiagnosticNumber,
  snapshotDiagnosticJson,
} from "../src/index.js";

describe("diagnostic runtime boundary primitives", () => {
  it("preserves all structured boundary issues when snapshotting hostile values", () => {
    const input = { first: Number.NaN, second: undefined };
    try {
      snapshotDiagnosticJson(input);
      throw new Error("Expected a diagnostic validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticValidationError);
      expect((error as DiagnosticValidationError).issues).toEqual([
        { domain: "input", code: "invalid-json-value", path: "$.first", message: "JSON numeric value must be finite" },
        { domain: "input", code: "invalid-json-value", path: "$.second", message: "Value is not plain JSON data" },
      ]);
    }
  });

  it("rejects indexed array accessors without invoking them", () => {
    let calls = 0;
    const input = [1];
    Object.defineProperty(input, "0", {
      enumerable: true,
      get: () => { calls++; throw new Error("Array getter must not run"); },
    });
    expect(() => snapshotDiagnosticJson(input)).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [{
          domain: "input", code: "invalid-json-value", path: "$[0]",
          message: "JSON arrays may contain only indexed data properties",
        }],
      }),
    );
    expect(calls).toBe(0);
  });

  it.each([
    { input: new (class CustomArray extends Array<number> {})(1) },
    { input: Object.setPrototypeOf([1], { custom: true }) },
    { input: Object.setPrototypeOf([1], null) },
  ])("rejects nonstandard array prototypes %# with a typed issue", ({ input }) => {
    expect(() => snapshotDiagnosticJson(input)).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [{
          domain: "input", code: "invalid-json-value", path: "$",
          message: "Value must use a plain object or array prototype",
        }],
      }),
    );
  });

  it("rejects array method overrides before any clone can invoke them", () => {
    const input = [1];
    Object.defineProperty(input, "map", {
      value: () => { throw new Error("Array method must not run"); },
    });
    expect(() => snapshotDiagnosticJson(input)).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [{
          domain: "input", code: "invalid-json-value", path: "$.map",
          message: "JSON arrays may contain only indexed data properties",
        }],
      }),
    );
  });

  it("treats prototype names as ordinary legal keys", () => {
    const record = diagnosticRecord<number>();
    for (const [key, value] of [
      ["__proto__", 1],
      ["constructor", 2],
      ["toString", 3],
    ] as const)
      record[key] = value;
    expect(
      ["__proto__", "constructor", "toString"].map((key) => record[key]),
    ).toEqual([1, 2, 3]);
    expect(hasDiagnosticOwn(record, "__proto__")).toBe(true);
    expect(hasDiagnosticOwn({}, "toString")).toBe(false);
  });

  it("classifies hostile JSON without invoking getters or overflowing", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const custom = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    custom.own = true;
    const getter = {} as Record<string, unknown>;
    Object.defineProperty(getter, "value", {
      enumerable: true,
      get: () => {
        throw new Error("must not run");
      },
    });
    expect(diagnosticJsonPreflight(cycle, "input")).toContainEqual(
      expect.objectContaining({ code: "cycle", path: "$.self" }),
    );
    expect(diagnosticJsonPreflight(custom, "input")).toContainEqual(
      expect.objectContaining({ code: "invalid-json-value", path: "$" }),
    );
    expect(diagnosticJsonPreflight(getter, "input")).toContainEqual(
      expect.objectContaining({ code: "invalid-json-value", path: "$.value" }),
    );
    expect(
      diagnosticJsonPreflight({ value: "bad\0value" }, "input"),
    ).toContainEqual(
      expect.objectContaining({ code: "invalid-json-value", path: "$.value" }),
    );
    expect(
      diagnosticJsonPreflight({ value: "\ud800" }, "input"),
    ).toContainEqual(
      expect.objectContaining({ code: "invalid-json-value", path: "$.value" }),
    );
  });

  it("validates tokens, Gregorian dates, snapshots, and negative zero", () => {
    expect(isDiagnosticToken("__proto__")).toBe(true);
    expect(isDiagnosticToken(" spaced ")).toBe(false);
    expect(isDiagnosticToken("nul\0key")).toBe(false);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2023-02-29")).toBe(false);
    expect(isRealIsoDate("2024-02-29suffix")).toBe(false);
    expect(Object.is(normalizeDiagnosticNumber(-0), 0)).toBe(true);
    const caller = { nested: { value: -0 } };
    const snapshot = snapshotDiagnosticJson(caller);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.is(snapshot.nested.value, 0)).toBe(true);
    expect(Object.isFrozen(caller.nested)).toBe(false);
  });
});
