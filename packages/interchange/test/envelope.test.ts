import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReservingError, canonicalJson, fnv1a64 } from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_PACKAGE_VERSION,
  INTERCHANGE_SPEC_VERSION,
  acceptVersion,
  computeIntegrity,
  parseDocument,
  semanticBodyOf,
  stampIntegrity,
  verifyIntegrity,
  type TriangleDoc,
} from "../src/index.js";
import { CREATED_AT, annualPaidDoc } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));

/** A study envelope wrapping a single embedded triangle document. */
function studyContaining(triangle: TriangleDoc): unknown {
  return stampIntegrity({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "study",
    generator: { name: "test", version: "0" },
    createdAt: CREATED_AT,
    extensions: {},
    study: {
      title: "study with an embedded triangle",
      narrative: { summary: "s" },
      triangles: [triangle],
      selections: [],
    },
  } as never);
}

/** A bundle envelope mirroring a single embedded triangle document. */
function bundleContaining(triangle: TriangleDoc): unknown {
  return stampIntegrity({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "bundle",
    generator: { name: "test", version: "0" },
    createdAt: CREATED_AT,
    extensions: {},
    bundle: { payload: "opaque" },
    interchange: { triangles: [triangle], selections: [], results: [] },
  } as never);
}

describe("integrity covers the semantic body only (spec 3.1)", () => {
  it("changing generator/createdAt does NOT change the tag", () => {
    const doc = annualPaidDoc();
    const rehop = {
      ...doc,
      generator: { name: "actuarial-interchange (python)", version: "9.9.9" },
      createdAt: "2031-01-01T12:34:56Z",
    };
    expect(computeIntegrity(rehop)).toBe(doc.integrity);
    expect(verifyIntegrity(rehop).ok).toBe(true);
  });

  it("changing extensions does NOT change the tag (envelope field)", () => {
    const doc = annualPaidDoc();
    expect(computeIntegrity({ ...doc, extensions: { note: "hop" } })).toBe(doc.integrity);
  });

  it("changing a value inside the semantic body DOES change the tag", () => {
    const doc = annualPaidDoc();
    const tampered = {
      ...doc,
      triangle: {
        ...doc.triangle,
        values: doc.triangle.values!.map((row, i) =>
          i === 0 ? [row[0]! + 1, ...row.slice(1)] : [...row],
        ),
      },
    };
    expect(computeIntegrity(tampered)).not.toBe(doc.integrity);
    expect(verifyIntegrity(tampered).ok).toBe(false);
  });

  it("is exactly fnv1a64(canonicalJson(kind-named object))", () => {
    const doc = annualPaidDoc();
    expect(doc.integrity).toBe(fnv1a64(canonicalJson(doc.triangle)));
    expect(semanticBodyOf(doc)).toBe(doc.triangle);
  });

  it("for bundles the tag covers { bundle, interchange } (spec 3.2)", () => {
    const bundleDoc = stampIntegrity<{
      kind: string;
      bundle: Record<string, unknown>;
      interchange: Record<string, unknown>;
      integrity: string;
    }>({
      kind: "bundle",
      bundle: { payload: "opaque" },
      interchange: { triangles: [], selections: [], results: [] },
    });
    expect(bundleDoc.integrity).toBe(
      fnv1a64(
        canonicalJson({
          bundle: { payload: "opaque" },
          interchange: { triangles: [], selections: [], results: [] },
        }),
      ),
    );
  });
});

describe("version handling (spec 3.5)", () => {
  it("accepts the current spec version", () => {
    expect(acceptVersion(INTERCHANGE_SPEC_VERSION)).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("refuses a wrong major with UNSUPPORTED_VERSION", () => {
    const doc = { ...annualPaidDoc(), interchangeVersion: "2.0.0" };
    let thrown: unknown;
    try {
      parseDocument(doc);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("UNSUPPORTED_VERSION");
  });

  it("refuses a malformed version with BAD_INTERCHANGE", () => {
    expect(() => parseDocument({ ...annualPaidDoc(), interchangeVersion: "one" })).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
  });

  it("accepts a same-major unknown minor and preserves unknown fields through a round-trip", () => {
    const doc = annualPaidDoc();
    const future = {
      ...doc,
      interchangeVersion: "1.7.0",
      extensions: { "vendor:futureFeature": { enabled: true, weights: [1, 2, 3] } },
      triangle: { ...doc.triangle, futureOptionalField: "kept" },
    };
    const stamped = { ...future, integrity: computeIntegrity(future) };
    const { doc: parsed } = parseDocument(JSON.parse(JSON.stringify(stamped)));
    // Unknown minor fields inside the semantic body are preserved
    // (passthrough), so the integrity tag survives a parse → re-serialize hop.
    expect((parsed as Record<string, unknown> & { triangle: Record<string, unknown> }).triangle["futureOptionalField"]).toBe("kept");
    expect(parsed.extensions).toEqual({
      "vendor:futureFeature": { enabled: true, weights: [1, 2, 3] },
    });
    expect(verifyIntegrity(parsed).ok).toBe(true);
    expect(computeIntegrity(parsed)).toBe(stamped.integrity);
  });
});

describe("parseDocument (spec 4.1)", () => {
  it("round-trips a valid document and channels no warnings on clean input", () => {
    const doc = annualPaidDoc();
    const { doc: parsed, warnings } = parseDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
    expect(warnings).toEqual([]);
  });

  it("refuses unknown kinds with BAD_INTERCHANGE", () => {
    expect(() =>
      parseDocument({ interchangeVersion: "1.0.0", kind: "hologram" }),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
  });

  it("refuses a broken integrity tag by default and warns in warn mode", () => {
    const doc = { ...annualPaidDoc(), integrity: "0000000000000000" };
    expect(() => parseDocument(doc)).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
    const { warnings } = parseDocument(doc, { strictness: "warn" });
    expect(warnings.some((w) => w.includes("Integrity tag mismatch"))).toBe(true);
  });

  it("warns (reader capability, not a format error) on 1-/6-month cadences", () => {
    const doc = annualPaidDoc();
    const semiannual = {
      ...doc,
      triangle: {
        ...doc.triangle,
        originLengthMonths: 6,
        origins: doc.triangle.origins.map((o, i) => ({
          ...o,
          start: `202${i}-07-01`,
        })),
      },
    };
    const stamped = { ...semiannual, integrity: computeIntegrity(semiannual) };
    const { warnings } = parseDocument(stamped);
    expect(warnings.some((w) => w.includes("computation support"))).toBe(true);
  });
});

describe("package metadata sync", () => {
  it("INTERCHANGE_PACKAGE_VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
      version: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(INTERCHANGE_PACKAGE_VERSION).toBe(pkg.version);
    expect(DEFAULT_GENERATOR.version).toBe(pkg.version);
  });

  it("runtime dependencies are core + zod only (spec 4.1)", () => {
    const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@actuarial-ts/core", "zod"]);
  });
});

describe("nested documents carry their own integrity (spec 3.1)", () => {
  /** A triangle doc whose stated tag no longer matches its own body. */
  function selfContradictingTriangle(): TriangleDoc {
    const good = annualPaidDoc();
    const broken = JSON.parse(JSON.stringify(good)) as TriangleDoc;
    (broken.triangle as { values: (number | null)[][] }).values[0]![0] = 999_999;
    return broken; // integrity tag left untouched, so it now lies about the body
  }

  it("refuses a study whose embedded triangle contradicts its own tag", () => {
    // appliesTo.triangleIntegrity is the linkage primitive the whole referee
    // relies on. If an embedded document's tag does not match its own body, a
    // result claiming to apply to that tag is pointing at something else.
    expect(() => parseDocument(studyContaining(selfContradictingTriangle()))).toThrow(
      /embedded "triangle" document at \$\.study\.triangles\[0\]/i,
    );
  });

  it("warns rather than throwing under strictness 'warn'", () => {
    const { warnings } = parseDocument(studyContaining(selfContradictingTriangle()), {
      strictness: "warn",
    });
    expect(warnings.join(" ")).toMatch(/embedded "triangle" document at \$\.study\.triangles\[0\]/i);
  });

  it("accepts a study whose embedded documents are self-consistent", () => {
    const { warnings } = parseDocument(studyContaining(annualPaidDoc()));
    expect(warnings).toEqual([]);
  });
});

describe("embedded documents carry their own version (spec 3.5)", () => {
  const wrongMajor = (): TriangleDoc => ({ ...annualPaidDoc(), interchangeVersion: "2.0.0" }); // envelope field: integrity tag stays valid

  it("refuses a study whose embedded triangle declares a wrong major", () => {
    let thrown: unknown;
    try {
      parseDocument(studyContaining(wrongMajor()));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("UNSUPPORTED_VERSION");
    expect((thrown as ReservingError).message).toMatch(/\$\.study\.triangles\[0\]/);
  });

  it("refuses a bundle whose mirrored triangle declares a wrong major", () => {
    let thrown: unknown;
    try {
      parseDocument(bundleContaining(wrongMajor()));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("UNSUPPORTED_VERSION");
    expect((thrown as ReservingError).message).toMatch(/\$\.interchange\.triangles\[0\]/);
  });

  it("refuses even under strictness 'warn' (version acceptance is not strictness-governed)", () => {
    expect(() =>
      parseDocument(studyContaining(wrongMajor()), { strictness: "warn" }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }));
  });

  it("accepts an embedded same-major unknown minor with no warnings", () => {
    const { warnings } = parseDocument(
      studyContaining({ ...annualPaidDoc(), interchangeVersion: "1.7.0" }),
    );
    expect(warnings).toEqual([]);
  });
});
