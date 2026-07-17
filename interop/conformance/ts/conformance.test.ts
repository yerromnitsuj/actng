import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type MethodResultDoc,
  type SelectionDoc,
  type TriangleDoc,
  crosscheck,
  docToSelections,
  docToTriangle,
  parseDocument,
  triangleToDoc,
} from "../../../packages/interchange/src/index.js";
import { verifyBundle } from "../../../packages/compliance/src/index.js";
import type { BundleDoc } from "../../../packages/interchange/src/index.js";
import {
  CONFORMANCE_FIXTURES,
  CREATED_AT,
  allWtdSelections,
  authorClResultDoc,
  authorFixture,
  authorMackResultDoc,
  authorWrappedBundleDoc,
} from "./fixtures.js";

/**
 * The TS shore of the Phase A cross-engine conformance suite (spec 10 /
 * 13). Runs against the COMMITTED fixture documents — the frozen public
 * compatibility statement — and asserts:
 *
 * 1. every committed document parses with an intact integrity tag;
 * 2. the committed bytes still equal a fresh authoring run (freeze check:
 *    regeneration must be deliberate, never drift);
 * 3. docToTriangle round-trips null-for-null against the core fixture and
 *    re-authoring reproduces the committed integrity tag;
 * 4. the volume-weighted selection intent replays coherently and
 *    recomputing the chain ladder from the REPLAYED selections reproduces
 *    the committed result document exactly;
 * 5. the referee returns verdict "agree" on TS-vs-TS for both profiles;
 * 6. the referee returns verdict "disagree" against the committed
 *    Python-authored log-linear-sigma Mack run on Taylor/Ashe (spec 13
 *    Phase A acceptance 3) — central estimates agree, the SEs betray the
 *    sigma misalignment.
 *
 * The Python shore (../py/test_conformance.py) parses the SAME files.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function readJson(fixtureName: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fixtureName, file), "utf8"));
}

function readText(fixtureName: string, file: string): string {
  return readFileSync(path.join(FIXTURES_DIR, fixtureName, file), "utf8");
}

for (const fixture of CONFORMANCE_FIXTURES) {
  describe(`conformance fixture ${fixture.name}`, () => {
    const triangleRaw = readJson(fixture.name, "triangle.json");
    const selectionRaw = readJson(fixture.name, "selection.json");
    const clResultRaw = readJson(fixture.name, "deterministic-cl.json");
    const mackResultRaw = readJson(fixture.name, "mack1993-vw.json");
    const expectations = readJson(fixture.name, "expectations.json") as {
      integrity: Record<string, string>;
    };

    it("parses every committed document with an intact integrity tag and no warnings", () => {
      for (const raw of [triangleRaw, selectionRaw, clResultRaw, mackResultRaw]) {
        // default strictness "refuse": a stale tag throws BAD_INTERCHANGE.
        const { warnings } = parseDocument(raw);
        expect(warnings).toEqual([]);
      }
    });

    it("committed documents are byte-frozen: a fresh authoring run reproduces the files exactly", () => {
      // TRUE byte freeze (not just structural equality): the committed file
      // text must equal the generator's serialization of a fresh authoring
      // run. Regeneration requires a documented convention change.
      const authored = authorFixture(fixture);
      const asFile = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
      expect(readText(fixture.name, "triangle.json")).toBe(asFile(authored.triangleDoc));
      expect(readText(fixture.name, "selection.json")).toBe(asFile(authored.selectionDoc));
      expect(readText(fixture.name, "deterministic-cl.json")).toBe(asFile(authored.clResultDoc));
      expect(readText(fixture.name, "mack1993-vw.json")).toBe(asFile(authored.mackResultDoc));
      expect(readText(fixture.name, "expectations.json")).toBe(asFile(authored.expectations));
    });

    it("expectations.json records the committed documents' integrity tags", () => {
      expect(expectations.integrity["triangle"]).toBe((triangleRaw as TriangleDoc).integrity);
      expect(expectations.integrity["selection"]).toBe((selectionRaw as SelectionDoc).integrity);
      expect(expectations.integrity["deterministic-cl"]).toBe(
        (clResultRaw as MethodResultDoc).integrity,
      );
      expect(expectations.integrity["mack1993-vw"]).toBe(
        (mackResultRaw as MethodResultDoc).integrity,
      );
    });

    it("docToTriangle round-trips null-for-null against the core fixture", () => {
      const triangleDoc = parseDocument(triangleRaw).doc as TriangleDoc;
      const { triangle, warnings } = docToTriangle(triangleDoc);
      expect(warnings).toEqual([]);
      expect(triangle.kind).toBe(fixture.triangle.kind);
      expect(triangle.origins).toEqual(fixture.triangle.origins);
      expect(triangle.ages).toEqual(fixture.triangle.ages);
      // toEqual distinguishes null from 0 and from undefined: every
      // unobserved cell must come back as exactly null (spec 3.1).
      expect(triangle.values).toEqual(fixture.triangle.values);

      // Re-authoring the round-tripped triangle reproduces the committed tag.
      const reauthored = triangleToDoc(triangle, {
        createdAt: CREATED_AT,
        valuationDate: fixture.valuationDate,
      });
      expect(reauthored.integrity).toBe(triangleDoc.integrity);
    });

    it("replays the volume-weighted intent coherently and reproduces the committed CL result", () => {
      const triangleDoc = parseDocument(triangleRaw).doc as TriangleDoc;
      const selectionDoc = parseDocument(selectionRaw).doc as SelectionDoc;

      const replay = docToSelections(selectionDoc, { triangleDoc, strictness: "refuse" });
      expect(replay.coherence.coherent).toBe(true);
      expect(replay.warnings).toEqual([]);
      // Every column replays EXACTLY on this shore as the all-wtd menu key.
      expect(replay.averageKeys).toEqual(replay.averageKeys.map(() => "all-wtd"));
      expect(replay.selections.tailFactor).toBe(1);
      expect(replay.selections.selected).toEqual(allWtdSelections(fixture.triangle).selected);

      // Chain ladder recomputed from the REPLAYED selections reproduces the
      // committed result document — same semantic body, same tag.
      const recomputed = authorClResultDoc(
        fixture,
        triangleDoc,
        selectionDoc,
        replay.selections,
      );
      expect(recomputed).toEqual(clResultRaw);
    });

    it("referee: TS-vs-TS agrees on both profiles", () => {
      const selectionDoc = parseDocument(selectionRaw).doc as SelectionDoc;
      const triangleDoc = parseDocument(triangleRaw).doc as TriangleDoc;

      const clReport = crosscheck({
        a: clResultRaw as MethodResultDoc,
        b: authorClResultDoc(fixture, triangleDoc, selectionDoc, allWtdSelections(fixture.triangle)),
        selection: selectionDoc,
        createdAt: CREATED_AT,
      });
      expect(clReport.report.verdict).toBe("agree");
      expect(clReport.report.deviations.totals.ultimate).toBe(0);
      expect(clReport.report.deviations.totals.unpaid).toBe(0);

      const mackReport = crosscheck({
        a: mackResultRaw as MethodResultDoc,
        b: authorMackResultDoc(fixture, triangleDoc),
        createdAt: CREATED_AT,
      });
      expect(mackReport.report.verdict).toBe("agree");
      expect(mackReport.report.deviations.totals.standardError).toBe(0);
    });
  });
}

describe("conformance: deliberately misaligned run (spec 13 Phase A acceptance 3)", () => {
  const misalignedPath = path.join(FIXTURES_DIR, "taylor-ashe", "misaligned-mack-loglinear.json");

  it("referees the Python log-linear-sigma Mack run to verdict disagree", () => {
    // The committed misaligned document is authored by the Python runner
    // (interop/conformance/py/test_conformance.py): chainladder-python
    // MackChainladder on Taylor/Ashe with the DEFAULT log-linear sigma,
    // deliberately CLAIMING the mack1993-vw profile it does not satisfy.
    expect(
      existsSync(misalignedPath),
      "misaligned-mack-loglinear.json is missing — run the Python conformance suite once " +
        "(npm run test:py) to author it, then commit it",
    ).toBe(true);
    const misalignedRaw = JSON.parse(readFileSync(misalignedPath, "utf8"));

    // The Python-authored document parses on this shore with its tag intact
    // (cross-language JCS/FNV agreement in action).
    const misaligned = parseDocument(misalignedRaw).doc as MethodResultDoc;
    expect(misaligned.result.engine.name).toBe("chainladder-python");
    expect(misaligned.result.engine.conventionProfile).toBe("mack1993-vw");
    expect(misaligned.result.parameters["sigma_interpolation"]).toBe("log-linear");

    const tsMack = JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, "taylor-ashe", "mack1993-vw.json"), "utf8"),
    ) as MethodResultDoc;
    const report = crosscheck({ a: tsMack, b: misaligned, createdAt: CREATED_AT });

    expect(report.report.verdict).toBe("disagree");
    // The misalignment is the SIGMA, not the projection: central estimates
    // agree at the deterministic tolerance; the standard errors do not.
    expect(report.report.deviations.totals.ultimate).toBeLessThanOrEqual(1e-6);
    expect(report.report.deviations.totals.unpaid).toBeLessThanOrEqual(1e-6);
    const seDeviations = [
      ...report.report.deviations.perOrigin.map((d) => d.standardError ?? 0),
      report.report.deviations.totals.standardError ?? 0,
    ];
    expect(Math.max(...seDeviations)).toBeGreaterThan(0.005);
  });
});

describe("conformance: cross-engine ALIGNED runs referee to agree (both directions closed)", () => {
  // The two clpy-*.json docs are authored by the Python runner under the
  // same author-once-then-freeze policy as the misaligned one: chainladder
  // replaying the SAME committed selection on the SAME committed triangle,
  // profile requirements satisfied (sigma_interpolation="mack" for the
  // Mack profile). The TS referee must call the agreement.
  const cases = [
    { profile: "deterministic-cl", clpyFile: "clpy-deterministic-cl.json", tsFile: "deterministic-cl.json" },
    { profile: "mack1993-vw", clpyFile: "clpy-mack1993-vw.json", tsFile: "mack1993-vw.json" },
  ] as const;

  for (const c of cases) {
    it(`taylor-ashe ${c.profile}: TS vs chainladder-python -> verdict agree`, () => {
      const clpyPath = path.join(FIXTURES_DIR, "taylor-ashe", c.clpyFile);
      expect(
        existsSync(clpyPath),
        `${c.clpyFile} is missing - run the Python conformance suite once (npm run test:py) to author it`,
      ).toBe(true);
      const clpy = parseDocument(JSON.parse(readFileSync(clpyPath, "utf8"))).doc as MethodResultDoc;
      const ts = parseDocument(
        JSON.parse(readFileSync(path.join(FIXTURES_DIR, "taylor-ashe", c.tsFile), "utf8")),
      ).doc as MethodResultDoc;
      expect(clpy.result.engine.name).toBe("chainladder-python");
      const report = crosscheck({ a: ts, b: clpy, createdAt: "2026-07-17T00:00:00Z" });
      expect(report.report.verdict).toBe("agree");
      expect(report.report.warnings.join("\n")).not.toContain("effective");
    });
  }
});

describe("conformance: wrapped reproducibility bundle (Phase B, spec 3.2)", () => {
  // ONE wrapped bundle is committed, on Taylor/Ashe: the proof document the
  // Python shore's load_bundle (Task B3) parses. Same freeze policy as every
  // other fixture file.
  const fixture = CONFORMANCE_FIXTURES.find((f) => f.name === "taylor-ashe");
  if (fixture === undefined) throw new Error("taylor-ashe fixture is missing");

  it("wrapped-bundle.json is byte-frozen: a fresh authoring run reproduces the file exactly", () => {
    const authored = authorWrappedBundleDoc(fixture, authorFixture(fixture));
    expect(readText("taylor-ashe", "wrapped-bundle.json")).toBe(`${JSON.stringify(authored, null, 2)}\n`);
  });

  it("parses with an intact outer tag and wrapped verify reproduces inner AND outer", () => {
    const raw = readJson("taylor-ashe", "wrapped-bundle.json");
    const { warnings, doc } = parseDocument(raw);
    expect(warnings).toEqual([]);
    const wrapped = doc as BundleDoc;

    // Wrapped verify: the inner results segment re-verifies exactly as an
    // unwrapped bundle, and the outer tag over { bundle, interchange } holds.
    const innerBody = JSON.parse((wrapped.bundle as { payload: string }).payload) as { results: unknown };
    const verdict = verifyBundle(wrapped, innerBody.results);
    expect(verdict.reproduced).toBe(true);
    expect(verdict.outerIntegrity?.ok).toBe(true);
    expect(verdict.outerIntegrity?.expected).toBe(wrapped.integrity);
  });

  it("mirrors the committed fixture documents byte-for-byte (results INCLUDED, spec 3.2)", () => {
    const wrapped = readJson("taylor-ashe", "wrapped-bundle.json") as BundleDoc;
    expect(wrapped.createdAt).toBe(CREATED_AT);
    expect(wrapped.interchange.triangles).toEqual([readJson("taylor-ashe", "triangle.json")]);
    expect(wrapped.interchange.selections).toEqual([readJson("taylor-ashe", "selection.json")]);
    expect(wrapped.interchange.results).toEqual([
      readJson("taylor-ashe", "deterministic-cl.json"),
      readJson("taylor-ashe", "mack1993-vw.json"),
    ]);
  });
});
