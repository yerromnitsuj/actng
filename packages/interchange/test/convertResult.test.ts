import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExposureRecord,
  runBenktander,
  runBornhuetterFerguson,
  runChainLadder,
  runMack,
} from "@actuarial-ts/core";
import {
  CREATED_AT,
  allWtdSelections,
  annualPaidDoc,
  annualPaidTriangle,
} from "./helpers.js";
import { CORE_ENGINE, resultToDoc, selectionsToDoc, verifyIntegrity } from "../src/index.js";

const tri = annualPaidTriangle();
const triangleDoc = annualPaidDoc();
const selections = allWtdSelections(tri);
const { doc: selectionDoc } = selectionsToDoc(selections, {
  triangleDoc,
  createdAt: CREATED_AT,
  intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
});
const clResult = runChainLadder(tri, selections);
const exposures: ExposureRecord[] = tri.origins.map((origin) => ({
  origin,
  earnedPremium: 5200,
  exposureUnits: null,
}));
const bfResult = runBornhuetterFerguson(tri, clResult, exposures, { aprioriLossRatio: 0.65 });

describe("resultToDoc stamps appliesTo and maps rows per the spec vocabulary", () => {
  it("chainLadder with a selection document", () => {
    const doc = resultToDoc(clResult, {
      triangleDoc,
      selectionDoc,
      createdAt: CREATED_AT,
      conventionProfile: "deterministic-cl",
    });
    expect(doc.kind).toBe("method-result");
    expect(doc.result.method).toBe("chainLadder");
    expect(doc.result.appliesTo).toEqual({
      triangleIntegrity: triangleDoc.integrity,
      selectionIntegrity: selectionDoc.integrity,
    });
    expect(doc.result.engine).toEqual({ ...CORE_ENGINE, conventionProfile: "deterministic-cl" });
    expect(doc.result.rows.map((r) => r.origin)).toEqual(tri.origins);
    expect(doc.result.rows[0]!.ultimate).toBeCloseTo(clResult.rows[0]!.ultimate, 10);
    expect(doc.result.totals.unpaid).toBeCloseTo(clResult.totals.unpaid, 10);
    expect(verifyIntegrity(doc).ok).toBe(true);
  });

  it("mack: reserve travels as the spec's `unpaid`, SEs carried", () => {
    const mack = runMack(tri);
    const doc = resultToDoc(mack, {
      triangleDoc,
      createdAt: CREATED_AT,
      conventionProfile: "mack1993-vw",
    });
    expect(doc.result.method).toBe("mack");
    expect(doc.result.appliesTo.selectionIntegrity).toBeNull();
    mack.rows.forEach((row, i) => {
      expect(doc.result.rows[i]!.unpaid).toBe(row.reserve);
      expect(doc.result.rows[i]!.standardError).toBe(row.standardError);
    });
    expect(doc.result.totals.standardError).toBe(mack.totals.standardError);
  });

  it("bornhuetterFerguson and benktander", () => {
    const bfDoc = resultToDoc(bfResult, { triangleDoc, selectionDoc, createdAt: CREATED_AT });
    expect(bfDoc.result.method).toBe("bornhuetterFerguson");
    expect(bfDoc.result.totals.ultimate).toBeCloseTo(bfResult.totals.ultimate, 10);

    const gb = runBenktander(clResult, bfResult);
    const gbDoc = resultToDoc(gb, { triangleDoc, selectionDoc, createdAt: CREATED_AT });
    expect(gbDoc.result.method).toBe("benktander");
    expect(gbDoc.result.rows.length).toBe(gb.rows.length);
  });

  it("refuses unsupported result shapes with a later-phases message", () => {
    const alien = { method: "merzWuthrich" } as never;
    expect(() => resultToDoc(alien, { triangleDoc, createdAt: CREATED_AT })).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
  });

  it("refuses a basis/measure mismatch", () => {
    const incurredDoc = {
      ...triangleDoc,
      triangle: { ...triangleDoc.triangle, measure: "incurred" as const },
    };
    expect(() =>
      resultToDoc(clResult, { triangleDoc: incurredDoc, createdAt: CREATED_AT }),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
  });

  it("refuses a selection that applies to a different triangle", () => {
    const otherTriangleDoc = { ...triangleDoc, integrity: "fedcba9876543210" };
    expect(() =>
      resultToDoc(clResult, { triangleDoc: otherTriangleDoc, selectionDoc, createdAt: CREATED_AT }),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
  });

  it("CORE_ENGINE version matches the installed @actuarial-ts/core", () => {
    const corePkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../core/package.json",
    );
    const corePkg = JSON.parse(readFileSync(corePkgPath, "utf8")) as { version: string };
    expect(CORE_ENGINE.version).toBe(corePkg.version);
  });
});
