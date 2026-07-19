import { describe, expect, it } from "vitest";
import type { CreateBundleInput } from "../src/bundle.js";
import { canonicalJson, ComplianceError, createBundle, fnv1a64, verifyBundle } from "../src/bundle.js";
import { ReservingError } from "@actuarial-ts/core";

function expectComplianceError(fn: () => unknown, code: string): ComplianceError {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ComplianceError);
  const complianceError = thrown as ComplianceError;
  expect(complianceError.code).toBe(code);
  return complianceError;
}

// canonicalJson relocated to @actuarial-ts/core in 0.2.0; invalid input now
// throws core's ReservingError with the same UNSUPPORTED_VALUE code.
function expectCanonicalError(fn: () => unknown, code: string): ReservingError {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  const err = thrown as ReservingError;
  expect(err.code).toBe(code);
  return err;
}

describe("canonicalJson", () => {
  it("serializes primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson('he said "hi"\n')).toBe(JSON.stringify('he said "hi"\n'));
  });

  it("normalizes -0 to 0", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson({ x: -0 })).toBe(canonicalJson({ x: 0 }));
  });

  it("sorts object keys recursively and keeps array order", () => {
    const a = { b: 1, a: { d: [1, 2], c: 3 } };
    const b = { a: { c: 3, d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"c":3,"d":[1,2]},"b":1}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("emits no whitespace", () => {
    expect(canonicalJson({ a: [1, { b: "c" }] })).not.toMatch(/\s/);
  });

  it.each([
    [Number.NaN, "non-finite"],
    [Number.POSITIVE_INFINITY, "non-finite"],
    [undefined, "undefined"],
    [() => 1, "function"],
    [10n, "bigint"],
  ])("throws UNSUPPORTED_VALUE for %s", (bad, fragment) => {
    const err = expectCanonicalError(() => canonicalJson({ x: bad }), "UNSUPPORTED_VALUE");
    expect(err.message).toContain(fragment);
    expect(err.message).toContain("$.x");
  });

  it("reports the full offending path, including array indices", () => {
    const err = expectCanonicalError(
      () => canonicalJson({ results: { rows: [{ x: 1 }, { x: Number.NaN }] } }),
      "UNSUPPORTED_VALUE",
    );
    expect(err.message).toContain("$.results.rows[1].x");
  });

  it("rejects non-plain objects rather than silently mis-serializing them", () => {
    const err = expectCanonicalError(() => canonicalJson({ at: new Date(0) }), "UNSUPPORTED_VALUE");
    expect(err.message).toContain("Date");
    expect(err.message).toContain("$.at");
    expectCanonicalError(() => canonicalJson(new Map()), "UNSUPPORTED_VALUE");
  });

  it("rejects circular references instead of recursing forever", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const err = expectCanonicalError(() => canonicalJson(cyclic), "UNSUPPORTED_VALUE");
    expect(err.message).toContain("circular");
  });

  it("allows the same (acyclic) object to appear twice", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});

describe("fnv1a64", () => {
  it("matches the published FNV-1a 64-bit test vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });

  it("returns 16 lowercase hex chars and hashes UTF-8 bytes deterministically", () => {
    const hash = fnv1a64("héllo ✓");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64("héllo ✓")).toBe(hash);
    expect(fnv1a64("hello")).not.toBe(fnv1a64("héllo ✓"));
  });
});

function bundleInput(overrides: Partial<CreateBundleInput> = {}): CreateBundleInput {
  return {
    inputs: { triangle: { kind: "paid", origins: ["2021", "2022"], ages: [12, 24], values: [[100, 180], [120, null]] } },
    parameters: { selections: [1.8, 1.0], tailFactor: 1.05 },
    results: { rows: [{ origin: "2021", ultimate: 189 }, { origin: "2022", ultimate: 226.8 }], total: 415.8 },
    sdkVersions: { "@actuarial-ts/core": "0.1.0", "@actuarial-ts/compliance": "0.1.0" },
    createdAt: "2026-07-17T09:00:00Z",
    ...overrides,
  };
}

describe("createBundle", () => {
  it("is key-order independent: reordered inputs yield identical payload and hash", () => {
    const a = createBundle(bundleInput({ parameters: { selections: [1.8, 1.0], tailFactor: 1.05 } }));
    const b = createBundle(bundleInput({ parameters: { tailFactor: 1.05, selections: [1.8, 1.0] } }));
    expect(a.payload).toBe(b.payload);
    expect(a.hash).toBe(b.hash);
  });

  it("hash is fnv1a64 of the payload", () => {
    const bundle = createBundle(bundleInput());
    expect(bundle.hash).toBe(fnv1a64(bundle.payload));
  });

  it("includes seeds only when provided", () => {
    const without = createBundle(bundleInput());
    const withSeeds = createBundle(bundleInput({ seeds: { bootstrap: 12345 } }));
    expect(without.payload).not.toContain("seeds");
    expect(withSeeds.payload).toContain('"seeds":{"bootstrap":12345}');
    expect(withSeeds.hash).not.toBe(without.hash);
  });

  it("propagates canonicalization failures with the offending path", () => {
    const err = expectCanonicalError(
      () => createBundle(bundleInput({ results: { total: Number.NaN } })),
      "UNSUPPORTED_VALUE",
    );
    expect(err.message).toContain("$.results.total");
  });
});

describe("verifyBundle rejects a bundle whose own hash does not match its payload", () => {
  it("returns reproduced: false with mismatchPath $.hash before comparing results", () => {
    // The unwrapped path compared re-run results against stored results and
    // never recomputed fnv1a64(payload) against bundle.hash — so a bundle with
    // rewritten inputs, parameters and sdkVersions and hash "deadbeef" still
    // verified. The header's claim ("these results came from exactly these
    // inputs...") depends on this check; the wrapped path always had it.
    const bundle = createBundle({
      inputs: { a: 1 },
      parameters: { b: 2 },
      results: { total: 42 },
      sdkVersions: { "@actuarial-ts/core": "0.2.0" },
      createdAt: "2026-07-18T00:00:00Z",
    });
    const tampered = { ...bundle, hash: "deadbeefdeadbeef" };
    const verdict = verifyBundle(tampered, { total: 42 });
    expect(verdict.reproduced).toBe(false);
    expect(verdict.mismatchPath).toBe("$.hash");

    // And the untampered bundle still verifies.
    expect(verifyBundle(bundle, { total: 42 }).reproduced).toBe(true);
  });
});

describe("verifyBundle", () => {
  it("round-trips: a re-run with structurally equal results is reproduced", () => {
    const input = bundleInput();
    const bundle = createBundle(input);
    const result = verifyBundle(bundle, input.results);
    expect(result).toEqual({ reproduced: true });
    expect(result.mismatchPath).toBeUndefined();
  });

  it("is key-order independent on the re-run side", () => {
    const bundle = createBundle(bundleInput({ results: { total: 415.8, rows: [{ origin: "2021" }] } }));
    expect(verifyBundle(bundle, { rows: [{ origin: "2021" }], total: 415.8 }).reproduced).toBe(true);
  });

  it("reports the first differing path for a nested value change", () => {
    const input = bundleInput();
    const bundle = createBundle(input);
    const rerun = {
      rows: [{ origin: "2021", ultimate: 189 }, { origin: "2022", ultimate: 230 }],
      total: 419,
    };
    const result = verifyBundle(bundle, rerun);
    expect(result.reproduced).toBe(false);
    // Depth-first with sorted keys: "rows" precedes "total".
    expect(result.mismatchPath).toBe("$.rows[1].ultimate");
  });

  it("reports a missing or extra key at the key's path", () => {
    const bundle = createBundle(bundleInput({ results: { a: 1, b: 2 } }));
    expect(verifyBundle(bundle, { a: 1 }).mismatchPath).toBe("$.b");
    expect(verifyBundle(bundle, { a: 1, b: 2, c: 3 }).mismatchPath).toBe("$.c");
  });

  it("reports an array length mismatch at the first index past the shared prefix", () => {
    const bundle = createBundle(bundleInput({ results: { rows: [1, 2, 3] } }));
    expect(verifyBundle(bundle, { rows: [1, 2] }).mismatchPath).toBe("$.rows[2]");
    expect(verifyBundle(bundle, { rows: [1, 2, 3, 4] }).mismatchPath).toBe("$.rows[3]");
  });

  it("reports a type mismatch at the node itself", () => {
    const bundle = createBundle(bundleInput({ results: { total: 415.8 } }));
    expect(verifyBundle(bundle, { total: [415.8] }).mismatchPath).toBe("$.total");
    const rootMismatch = createBundle(bundleInput({ results: { a: 1 } }));
    expect(verifyBundle(rootMismatch, [1]).mismatchPath).toBe("$");
  });

  it("walks sorted keys depth-first, so the first difference is deterministic", () => {
    const bundle = createBundle(bundleInput({ results: { alpha: 1, zeta: 1 } }));
    expect(verifyBundle(bundle, { alpha: 2, zeta: 2 }).mismatchPath).toBe("$.alpha");
  });

  it("reports a payload/hash mismatch as $.hash, and still throws BAD_BUNDLE past it", () => {
    // The hash check now runs FIRST (a corrupted payload cannot hash to its
    // stored tag), so these fabricated hashes surface as $.hash rather than
    // reaching the parser.
    expect(verifyBundle({ payload: "not json", hash: "0".repeat(16) }, {})).toEqual({
      reproduced: false,
      mismatchPath: "$.hash",
    });

    // BAD_BUNDLE is still the verdict for structurally bad payloads whose
    // hash IS consistent — i.e. a bundle that was AUTHORED wrong, not altered.
    expectComplianceError(
      () => verifyBundle({ payload: "not json", hash: fnv1a64("not json") }, {}),
      "BAD_BUNDLE",
    );
    expectComplianceError(
      () =>
        verifyBundle({ payload: '{"no":"results"}', hash: fnv1a64('{"no":"results"}') }, {}),
      "BAD_BUNDLE",
    );
  });
});
