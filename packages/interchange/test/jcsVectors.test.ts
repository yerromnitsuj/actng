import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@actuarial-ts/core";

/**
 * The shared cross-language contract (spec 3.1): the canonicalJson this
 * package hashes with must reproduce every committed JCS vector
 * byte-for-byte — the same suite every non-TS adapter must pass. Never
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

describe("interchange canonicalization vs the committed JCS vector suite", () => {
  it("ships a meaningful suite", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });
  for (const v of vectors) {
    it(`reproduces vector: ${v.name}`, () => {
      expect(canonicalJson(v.value)).toBe(v.canonical);
    });
  }
});
