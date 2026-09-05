import { describe, expect, it } from "vitest";
import { createDiagnosticEvidenceInterner } from "../src/diagnosticEvidenceIntern.js";
import { projectDiagnosticIdentity } from "../src/diagnosticIdentity.js";

describe("private owned evidence sharing", () => {
  it("shares equal finalized children and parents inside one pool only", () => {
    const pool = createDiagnosticEvidenceInterner();
    const one = pool.internOwned(Object.freeze({ value: 3 }), "plain");
    const two = pool.internOwned(Object.freeze({ value: 3 }), "plain");
    expect(two).toBe(one);
    const a = pool.internOwned(Object.freeze([one]), "plain");
    const b = pool.internOwned(Object.freeze([two]), "plain");
    expect(a).toBe(b);
    expect(
      createDiagnosticEvidenceInterner().internOwned(
        Object.freeze({ value: 3 }),
        "plain",
      ),
    ).not.toBe(one);
  });

  it("does not collapse modes, prototypes, key order or numeric distinctions", () => {
    const pool = createDiagnosticEvidenceInterner();
    const source = pool.internOwned(Object.freeze({ value: 0 }), "source");
    expect(pool.internOwned(Object.freeze({ value: 0 }), "free")).not.toBe(
      source,
    );
    expect(pool.internOwned(Object.freeze({ value: -0 }), "source")).not.toBe(
      source,
    );
    expect(
      pool.internOwned(
        Object.freeze(Object.assign(Object.create(null), { value: 0 })),
        "source",
      ),
    ).not.toBe(source);
    const ab = pool.internOwned(Object.freeze({ a: 1, b: 2 }), "plain");
    expect(pool.internOwned(Object.freeze({ b: 2, a: 1 }), "plain")).not.toBe(
      ab,
    );
    expect(pool.internOwned(Object.freeze({}), "plain")).not.toBe(
      pool.internOwned(Object.freeze({ absent: undefined }), "plain"),
    );
  });

  it("declines mutable children and accessors without invoking them", () => {
    const pool = createDiagnosticEvidenceInterner();
    let called = false;
    const accessor = Object.freeze({
      get value() {
        called = true;
        return 1;
      },
    });
    expect(pool.internOwned(accessor, "plain")).toBe(accessor);
    expect(called).toBe(false);
    const shallow = Object.freeze({ child: { value: 1 } });
    expect(pool.internOwned(shallow, "plain")).toBe(shallow);
    const mutable = { value: 1 };
    expect(pool.internOwned(mutable, "plain")).toBe(mutable);
  });

  it("declines wider or oversized candidates without changing their values", () => {
    const narrow = createDiagnosticEvidenceInterner({
      maxCandidateProperties: 1,
    });
    const candidate = Object.freeze({ a: 1, b: 2 });
    expect(narrow.internOwned(candidate, "plain")).toBe(candidate);
    expect(narrow.internOwned(Object.freeze({ a: 1, b: 2 }), "plain")).not.toBe(
      candidate,
    );
    const large = Object.freeze({ value: "x".repeat(4097) });
    expect(narrow.internOwned(large, "plain")).toBe(large);
  });

  it("keeps prior shares when the finite entry budget is full and safely skips new ones", () => {
    const pool = createDiagnosticEvidenceInterner({ maxEntries: 1 });
    const first = pool.internOwned(Object.freeze({ value: 1 }), "plain");
    const second = pool.internOwned(Object.freeze({ value: 2 }), "plain");
    expect(pool.internOwned(Object.freeze({ value: 1 }), "plain")).toBe(first);
    expect(pool.internOwned(Object.freeze({ value: 2 }), "plain")).not.toBe(
      second,
    );
    const disabled = createDiagnosticEvidenceInterner({
      maxSignatureCharacters: 0,
    });
    expect(disabled.internOwned(first, "plain")).toBe(first);
    expect(disabled.internOwned(Object.freeze({ value: 1 }), "plain")).not.toBe(
      first,
    );
  });

  it("shares normalized identity children without borrowing caller objects", () => {
    const row = {
      coordinate: { origin: "2024", valuation: "2024" },
      reasons: [],
    };
    const projected = projectDiagnosticIdentity([row, structuredClone(row)]);
    expect(projected[0]).toBe(projected[1]);
    expect(projected[0]).not.toBe(row);
    expect(projected[0]!.coordinate).not.toBe(row.coordinate);
    expect(Object.isFrozen(projected[0])).toBe(true);
    expect(projectDiagnosticIdentity([row])[0]).not.toBe(projected[0]);
  });

  it("retains enumerability and array length when frozen descriptor flags are implicit in signatures", () => {
    const pool = createDiagnosticEvidenceInterner();
    const visible = Object.freeze({ value: 1 });
    const hidden = Object.freeze(
      Object.defineProperty({}, "value", { value: 1, enumerable: false }),
    );
    expect(Object.getOwnPropertyDescriptor(visible, "value")).toEqual({
      value: 1,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    expect(pool.internOwned(visible, "plain")).not.toBe(
      pool.internOwned(hidden, "plain"),
    );
    const empty = pool.internOwned(Object.freeze([]), "plain");
    expect(Object.getOwnPropertyDescriptor(empty, "length")).toEqual({
      value: 0,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    expect(pool.internOwned(Object.freeze([undefined]), "plain")).not.toBe(
      empty,
    );
  });

  it("uses exact typed values in flat signatures without scalar or field-boundary collisions", () => {
    const pool = createDiagnosticEvidenceInterner();
    const values = [
      null,
      undefined,
      false,
      "false",
      0,
      -0,
      "-0",
      "number",
      "null",
    ];
    const records = values.map((value) =>
      pool.internOwned(Object.freeze({ 'a,"b': value }), "plain"),
    );
    expect(new Set(records).size).toBe(values.length);
    const left = pool.internOwned(Object.freeze({ a: "b,c", d: "e" }), "plain");
    const right = pool.internOwned(
      Object.freeze({ a: "b", "c,d": "e" }),
      "plain",
    );
    expect(left).not.toBe(right);
  });
});
