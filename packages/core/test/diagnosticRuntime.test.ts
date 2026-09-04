import { describe, expect, it } from "vitest";
import {
  diagnosticJsonPreflight,
  diagnosticRecord,
  hasDiagnosticOwn,
  isDiagnosticToken,
  isRealIsoDate,
  normalizeDiagnosticNumber,
  snapshotDiagnosticJson,
} from "../src/index.js";

describe("diagnostic runtime boundary primitives", () => {
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
