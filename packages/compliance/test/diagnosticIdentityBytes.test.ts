import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a64, CORE_PACKAGE_VERSION } from "@actuarial-ts/core";
import { DATA_PACKAGE_VERSION } from "@actuarial-ts/data";
import { COMPLIANCE_PACKAGE_VERSION } from "../src/version.js";
import { diagnosticIdentityVectors } from "./fixtures/diagnosticIdentityRun.js";
import { emptyGridReleaseTags } from "./diagnosticReleaseTags.js";

const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/diagnosticIdentityBytes.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { canonicalJson: string; tag: string }>;

describe("reviewed canonical identity bytes", () => {
  it.each(Object.entries(emptyGridReleaseTags))(
    "derives reviewed %s release tags by changing only historical package stamps",
    (version, tags) => {
      const run = JSON.parse(expected.run!.canonicalJson);
      run.manifest.engine.packages = {
        core: version,
        data: version,
        compliance: version,
      };
      const stamp = (payload: unknown) =>
        `fnv1a64-jcs-v1:${fnv1a64(canonicalJson(payload))}`;
      expect(stamp(run)).toBe(tags.run);
      expect(expected.result!.tag).toBe(tags.result);
      const binding = JSON.parse(expected.binding!.canonicalJson);
      binding.runFingerprint = tags.run;
      expect(stamp(binding)).toBe(tags.binding);
    },
  );

  it("pins exact JSON bytes and independent existing tags at every identity layer", async () => {
    const actual = await diagnosticIdentityVectors();
    expect(actual.run.payload.manifest.engine.packages).toEqual({
      core: CORE_PACKAGE_VERSION,
      data: DATA_PACKAGE_VERSION,
      compliance: COMPLIANCE_PACKAGE_VERSION,
    });
    // The reviewed fixture is historical 0.6.1 evidence: never regenerate it
    // for a package-version bump. First check every current tag against its
    // current bytes, then project only the recorded package stamps and their
    // dependent run/binding tags back to that frozen version. All other bytes,
    // including algorithm version, preparation, review and result, stay exact.
    const stamp = (payload: unknown) =>
      `fnv1a64-jcs-v1:${fnv1a64(canonicalJson(payload))}`;
    for (const [layer, vector] of Object.entries(actual))
      expect(vector.tag, `${layer} current byte-to-tag contract`).toBe(
        stamp(vector.payload),
      );
    const recordedPackages = JSON.parse(expected.run!.canonicalJson)
      .manifest.engine.packages;
    const runPayload = {
      ...actual.run.payload,
      manifest: {
        ...actual.run.payload.manifest,
        engine: {
          ...actual.run.payload.manifest.engine,
          packages: recordedPackages,
        },
      },
    };
    const runTag = stamp(runPayload);
    const bindingPayload = {
      ...actual.binding.payload,
      runFingerprint: runTag,
    };
    const historical = {
      ...actual,
      run: { payload: runPayload, tag: runTag },
      binding: { payload: bindingPayload, tag: stamp(bindingPayload) },
    };
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [layer, { payload, tag }] of Object.entries(historical)) {
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
