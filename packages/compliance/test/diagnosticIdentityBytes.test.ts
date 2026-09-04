import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a64 } from "@actuarial-ts/core";
import { diagnosticIdentityVectors } from "./fixtures/diagnosticIdentityRun.js";

const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/diagnosticIdentityBytes.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { canonicalJson: string; tag: string }>;

describe("reviewed canonical identity bytes", () => {
  it("pins exact JSON bytes and independent existing tags at every identity layer", async () => {
    const actual = await diagnosticIdentityVectors();
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [layer, { payload, tag }] of Object.entries(actual)) {
      const vector = expected[layer]!;
      const bytes = canonicalJson(payload);
      expect(bytes, `${layer} exact canonical bytes`).toBe(
        vector.canonicalJson,
      );
      expect(
        canonicalJson(JSON.parse(vector.canonicalJson)),
        `${layer} fixture is canonical`,
      ).toBe(vector.canonicalJson);
      expect(tag, `${layer} existing tag`).toBe(vector.tag);
      expect(
        `fnv1a64-jcs-v1:${fnv1a64(bytes)}`,
        `${layer} byte-to-tag contract`,
      ).toBe(vector.tag);
    }
  });
});
