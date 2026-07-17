import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type LdfSelections,
  canonicalJson,
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
} from "@actuarial-ts/core";
import {
  parseDocument,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
  verifyIntegrity,
} from "@actuarial-ts/interchange";
import {
  COMPLIANCE_PACKAGE_VERSION,
  ComplianceError,
  type BundleWrapInput,
  type CreateBundleInput,
  type WrappedBundleDoc,
  createBundle,
  verifyBundle,
} from "../src/bundle.js";

/**
 * Wrapped reproducibility bundles (interchange spec 3.2): createBundle's
 * `wrap` option and verifyBundle's wrapped mode. The interchange documents
 * are authored with the REAL @actuarial-ts/interchange converters and the
 * emitted wrapped doc is parsed with the REAL interchange parser, so
 * compliance's hand-computed outer tag can never drift from interchange's
 * semanticBodyOf definition without this suite going red.
 */

const CREATED_AT = "2026-07-17T00:00:00Z";

const triangle = triangleFromGrid(
  "paid",
  ["2021", "2022", "2023"],
  [12, 24, 36],
  [
    [100, 160, 200],
    [110, 170, null],
    [120, null, null],
  ],
);

function authorWrapDocs() {
  const triangleDoc = triangleToDoc(triangle, { createdAt: CREATED_AT, valuationDate: "2023-12-31" });
  const allWtd = computeDevelopmentFactors(triangle).averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("computeDevelopmentFactors did not produce the all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;
  const resultDoc = resultToDoc(runChainLadder(triangle, selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period factors", tailFactor: 1 },
  });
  return { triangleDoc, selectionDoc, resultDoc };
}

function wrappedInput(): CreateBundleInput & { wrap: BundleWrapInput } {
  const docs = authorWrapDocs();
  return {
    inputs: { triangleIntegrity: docs.triangleDoc.integrity },
    parameters: { selectionIntegrity: docs.selectionDoc.integrity, tailFactor: 1 },
    results: { totals: { ...docs.resultDoc.result.totals } },
    sdkVersions: { "@actuarial-ts/core": "0.1.0", "@actuarial-ts/compliance": COMPLIANCE_PACKAGE_VERSION },
    createdAt: CREATED_AT,
    wrap: {
      triangles: [docs.triangleDoc],
      selections: [docs.selectionDoc],
      results: [docs.resultDoc],
    },
  };
}

describe("createBundle with wrap (spec 3.2)", () => {
  it("round-trips: the wrapped doc parses under the real interchange parser and wrapped verify reproduces", () => {
    const input = wrappedInput();
    const { wrapped } = createBundle(input);

    expect(wrapped.kind).toBe("bundle");
    expect(wrapped.interchangeVersion).toBe("1.0.0");
    expect(wrapped.createdAt).toBe(CREATED_AT);
    expect(wrapped.interchange.triangles).toHaveLength(1);
    expect(wrapped.interchange.selections).toHaveLength(1);
    // Results are INCLUDED in the mirror (spec 3.2): load_bundle must never
    // need the TS-native blob.
    expect(wrapped.interchange.results).toHaveLength(1);

    // The REAL interchange parser accepts it with an intact tag, no warnings
    // (default strictness "refuse" throws on a stale tag).
    const { warnings } = parseDocument(JSON.parse(JSON.stringify(wrapped)) as unknown);
    expect(warnings).toEqual([]);
    // Interchange's own semanticBodyOf-based check agrees with compliance's
    // hand-computed outer tag.
    expect(verifyIntegrity(wrapped).ok).toBe(true);

    const verdict = verifyBundle(wrapped, input.results);
    expect(verdict.reproduced).toBe(true);
    expect(verdict.mismatchPath).toBeUndefined();
    expect(verdict.outerIntegrity).toEqual({ ok: true, expected: wrapped.integrity, actual: wrapped.integrity });
  });

  it("keeps the unwrapped path byte-identical: wrap never enters the inner payload", () => {
    const input = wrappedInput();
    const { wrap: _wrap, ...bare } = input;
    const wrappedRun = createBundle(input);
    const unwrappedRun = createBundle(bare);
    expect(wrappedRun.payload).toBe(unwrappedRun.payload);
    expect(wrappedRun.hash).toBe(unwrappedRun.hash);
    expect(wrappedRun.payload).not.toContain("interchangeVersion");
    expect((unwrappedRun as Partial<typeof wrappedRun>).wrapped).toBeUndefined();
    // The inner record carried in the wrapped doc is the same artifact.
    expect(wrappedRun.wrapped.bundle).toEqual({ payload: unwrappedRun.payload, hash: unwrappedRun.hash });
  });

  it("stamps generator with this package's name and package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
    ) as { version: string };
    expect(COMPLIANCE_PACKAGE_VERSION).toBe(pkg.version);
    const { wrapped } = createBundle(wrappedInput());
    expect(wrapped.generator).toEqual({ name: "@actuarial-ts/compliance", version: pkg.version });
  });
});

describe("verifyBundle wrapped mode (spec 3.2)", () => {
  it("detects interchange-mirror tampering via the outer tag, naming it; the untouched inner still passes inner-only", () => {
    const input = wrappedInput();
    const { wrapped } = createBundle(input);
    const tampered = structuredClone(wrapped) as WrappedBundleDoc;
    const tamperedTriangle = tampered.interchange.triangles[0]?.triangle as { values: (number | null)[][] };
    const firstRow = tamperedTriangle.values[0];
    if (firstRow === undefined) throw new Error("fixture triangle has no rows");
    firstRow[0] = 999_999;

    const verdict = verifyBundle(tampered, input.results);
    expect(verdict.reproduced).toBe(false);
    // Outer-tag failures report the divergent tag itself, firstDifference-style.
    expect(verdict.mismatchPath).toBe("$.integrity");
    expect(verdict.outerIntegrity?.ok).toBe(false);
    expect(verdict.outerIntegrity?.actual).toBe(wrapped.integrity);
    expect(verdict.outerIntegrity?.expected).toMatch(/^[0-9a-f]{16}$/);
    expect(verdict.outerIntegrity?.expected).not.toBe(wrapped.integrity);

    // The inner bundle was NOT touched: inner-only verification still passes.
    const inner = tampered.bundle as { payload: string; hash: string };
    expect(verifyBundle(inner, input.results)).toEqual({ reproduced: true });
  });

  it("fails the outer tag when the inner bundle segment is swapped out from under the mirror", () => {
    const input = wrappedInput();
    const { wrapped } = createBundle(input);
    const forged = structuredClone(wrapped) as WrappedBundleDoc;
    const other = createBundle({ ...input, results: { totals: { ultimate: 1 } } });
    forged.bundle = { payload: other.payload, hash: other.hash };

    const verdict = verifyBundle(forged, { totals: { ultimate: 1 } });
    expect(verdict.reproduced).toBe(false);
    expect(verdict.mismatchPath).toBe("$.integrity");
    expect(verdict.outerIntegrity?.ok).toBe(false);
  });

  it("passes on a fresh build: independent authoring runs produce identical wrapped docs that verify", () => {
    const first = createBundle(wrappedInput());
    const second = createBundle(wrappedInput());
    expect(second.wrapped).toEqual(first.wrapped);
    expect(canonicalJson(second.wrapped)).toBe(canonicalJson(first.wrapped));
    const verdict = verifyBundle(second.wrapped, wrappedInput().results);
    expect(verdict.reproduced).toBe(true);
    expect(verdict.outerIntegrity?.ok).toBe(true);
  });

  it("reports mismatched rerun results through the inner check exactly as unwrapped mode does", () => {
    const input = wrappedInput();
    const { wrapped } = createBundle(input);
    const results = input.results as { totals: { ultimate: number } };
    const drifted = { totals: { ...results.totals, ultimate: results.totals.ultimate + 1 } };
    const verdict = verifyBundle(wrapped, drifted);
    expect(verdict.reproduced).toBe(false);
    expect(verdict.mismatchPath).toBe("$.totals.ultimate");
    // Outer tag was fine — the failure is the inner reproduction.
    expect(verdict.outerIntegrity?.ok).toBe(true);
  });

  it("throws BAD_BUNDLE when the wrapped doc's inner segment or mirror is malformed", () => {
    const { wrapped } = createBundle(wrappedInput());

    const noPayload = structuredClone(wrapped) as WrappedBundleDoc;
    noPayload.bundle = { hash: "0".repeat(16) };
    expect(() => verifyBundle(noPayload, {})).toThrowError(ComplianceError);
    try {
      verifyBundle(noPayload, {});
    } catch (err) {
      expect((err as ComplianceError).code).toBe("BAD_BUNDLE");
    }

    const noMirror = structuredClone(wrapped) as Record<string, unknown>;
    delete noMirror["interchange"];
    expect(() => verifyBundle(noMirror as unknown as WrappedBundleDoc, {})).toThrowError(ComplianceError);
  });
});
