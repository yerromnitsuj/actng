import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyBundle, type ReproducibilityBundle } from "../src/bundle.js";
import { canonicalJson, fnv1a64 } from "@actuarial-ts/core";

/**
 * Backward-compatibility contract for the 0.2.0 canonicalJson/fnv1a64
 * relocation: a bundle produced by the v0.1.x compliance package (fixture
 * generated BEFORE the move, hash f85f66c03334f418) must still verify and
 * re-hash identically. If this test ever fails, canonical serialization
 * changed and every existing bundle in the wild silently broke - do not
 * "fix" the fixture; fix the regression.
 */
describe("v0.1.x bundle compatibility", () => {
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "v0_1_bundle.json");
  const bundle = JSON.parse(readFileSync(fixturePath, "utf8")) as ReproducibilityBundle;

  it("still verifies after the relocation", () => {
    const parsed = JSON.parse(bundle.payload) as { results: unknown };
    const verdict = verifyBundle(bundle, parsed.results);
    expect(verdict.reproduced).toBe(true);
  });

  it("re-hashes to the pre-relocation value", () => {
    expect(fnv1a64(bundle.payload)).toBe(bundle.hash);
    expect(bundle.hash).toBe("f85f66c03334f418");
  });

  it("re-canonicalizes byte-identically", () => {
    expect(canonicalJson(JSON.parse(bundle.payload))).toBe(bundle.payload);
  });
});
