import { describe, expect, it } from "vitest";
import {
  ComplianceError,
  createBundle,
  createDiagnosticRunIdentity,
  verifyBundle,
  type CreateBundleInput,
} from "../src/index.js";
import { evidence } from "./fixtures/diagnosticIdentityRun.js";

describe("diagnostic bundle SDK-version boundary", () => {
  it.each(
    [undefined, null, 42, [], "0.6.1"].map((sdkVersions) => ({ sdkVersions })),
  )(
    "rejects malformed SDK-version maps %# with an exact controlled error",
    async ({ sdkVersions }) => {
      const provenance = await createDiagnosticRunIdentity(evidence());
      const input = {
        inputs: {},
        parameters: {},
        results: provenance.result,
        createdAt: "2026-09-04T00:00:00Z",
        diagnosticRuns: [provenance],
        ...(sdkVersions === undefined ? {} : { sdkVersions }),
      };
      const malformed = input as unknown as CreateBundleInput;
      expect(() => createBundle(malformed)).toThrowError(ComplianceError);
      expect(() => createBundle(malformed)).toThrowError(
        expect.objectContaining({
          name: "ComplianceError",
          code: "BAD_DIAGNOSTIC_RUN",
          path: "$.sdkVersions",
          message: "Diagnostic bundles require a plain SDK-version map",
        }),
      );
    },
  );

  it("accepts a complete SDK-version map and reproduces the bundle", async () => {
    const provenance = await createDiagnosticRunIdentity(evidence());
    const packages = provenance.manifest.engine.packages;
    const bundle = createBundle({
      inputs: {},
      parameters: {},
      results: provenance.result,
      createdAt: "2026-09-04T00:00:00Z",
      sdkVersions: {
        "@actuarial-ts/core": packages.core,
        "@actuarial-ts/data": packages.data,
        "@actuarial-ts/compliance": packages.compliance,
      },
      diagnosticRuns: [provenance],
    });
    expect(verifyBundle(bundle, provenance.result).reproduced).toBe(true);
  });
});
