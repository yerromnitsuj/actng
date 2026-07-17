import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a64 } from "../src/canonical.js";
import { ReservingError } from "../src/types.js";

/**
 * The committed vector suite is the cross-language canonicalization
 * contract (spec 3.1): every adapter in every language must reproduce
 * every vector byte-for-byte. This test pins the TS reference. Never
 * regenerate the vectors to make a failing implementation pass.
 */
const vectorsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "schema/interchange/1.0/jcs-vectors.json",
);
const { vectors } = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  vectors: { name: string; value: unknown; canonical: string }[];
};

describe("canonicalJson vs the committed JCS vector suite", () => {
  it("ships a meaningful suite", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });
  for (const v of vectors) {
    it(`reproduces vector: ${v.name}`, () => {
      expect(canonicalJson(v.value)).toBe(v.canonical);
    });
  }
});

describe("canonical relocation behavior (moved from compliance in 0.2.0)", () => {
  it("sorts keys recursively and preserves array order", () => {
    expect(canonicalJson({ b: [2, 1], a: { z: 0, y: 1 } })).toBe('{"a":{"y":1,"z":0},"b":[2,1]}');
  });
  it("throws ReservingError UNSUPPORTED_VALUE with the offending path", () => {
    let thrown: unknown;
    try {
      canonicalJson({ rows: [{ ultimate: Number.NaN }] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("UNSUPPORTED_VALUE");
    expect((thrown as ReservingError).message).toContain("$.rows[0].ultimate");
  });
  it("fnv1a64 matches its published test vectors", () => {
    // Standard FNV-1a 64 vectors: empty string and "a".
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
  });
});
