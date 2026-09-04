import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "@actuarial-ts/core";
import {
  runRealWorldDiagnosticReview,
  runRealWorldLossRunReview,
} from "../src/main.js";

const net = runRealWorldLossRunReview();
const gross = runRealWorldLossRunReview({ basis: "gross" });

describe("the real-world loss-run and exposure example", () => {
  it("is pinned to the complete source rather than a hand-picked sample", () => {
    expect(net.quality.source_claim_rows).toBe(1_012_839);
    expect(net.quality.distinct_claim_ids).toBe(750_043);
    expect(net.quality.source_first_development_claim_count).toBe(735_079);
    expect(net.source.sourceSha256).toBe(
      "4409adb022d18e24a3a0e724523706616e707c53e55f8625ce9fc122a20185d6",
    );
  });

  it("loads all 20 exposure years without calling GWP earned premium", () => {
    expect(net.exposureYears).toBe(20);
    expect(net.totalExposureUnits).toBe(4_642_000);
    expect(net.earnedPremiumRows).toBe(0);
  });

  it("assembles complete 20-by-20 cumulative triangle diagonals", () => {
    expect(net.triangleCellsPerBasis).toBe(210);
    expect(net.selectedLdfs).toBe(38);
  });

  it("pins the latest net diagonals derived from the full claim histories", () => {
    expect(net.paid.latest).toBe(858_912_975);
    expect(net.incurred.latest).toBe(860_950_725);
  });

  it("makes gross-versus-net basis an explicit and consequential selection", () => {
    expect(gross.basis).toBe("gross");
    expect(net.basis).toBe("net");
    expect(gross.paid.latest).toBeGreaterThan(net.paid.latest);
    expect(gross.incurred.latest).toBeGreaterThan(net.incurred.latest);
  });

  it("uses insurance-year exposure as a pure-premium Cape Cod base", () => {
    expect(net.capeCod.expectedPurePremium).toBeGreaterThan(0);
    expect(Number.isFinite(net.capeCod.ultimate)).toBe(true);
  });

  it("reports real data issues rather than presenting a falsely clean fixture", () => {
    expect(net.quality.duplicate_claim_year_groups).toBe(438);
    expect(net.quality.paid_decrease_transitions).toBe(1_797);
    expect(net.quality.negative_net_case_records).toBe(27_001);
    expect(net.dataReview.summary.warning).toBeGreaterThan(0);
    expect(net.dataReview.summary.fail).toBe(1);
  });

  it("renders source interpretations, limitations, and selections into the disclosure", () => {
    expect(net.disclosure).toContain("source.expectChargeInterpretation");
    expect(net.disclosure).toContain("annual precision only");
    expect(net.disclosure).toContain(
      "Gross written premium is retained but is not used as earned premium",
    );
    expect(net.disclosure).toContain("all-wtd");
  });
});

describe("the generalized diagnostic vertical slice", () => {
  it("runs all 22 selections and seals the exact definition, review, result, and bundle", async () => {
    const outcome = await runRealWorldDiagnosticReview();
    expect(outcome.completed.result.emergence).toHaveLength(210);
    expect(
      outcome.completed.prepared.definition.definition.formulas,
    ).toHaveLength(6);
    expect(
      outcome.completed.prepared.definition.definition.instances,
    ).toHaveLength(22);
    expect(outcome.provenance.definition.identities.definition).toBe(
      outcome.parsedDefinitionIntegrity,
    );
    expect(outcome.provenance.manifest.runPresetId).toBe(
      "freclaimset2motor-all-annual-v1",
    );
    expect(
      outcome.provenance.manifest.inputArtifacts.map((artifact) => artifact.id),
    ).toEqual(["diagnostic-snapshots", "exposures", "source-archive"]);
    expect(
      outcome.provenance.manifest.preparationArtifacts.map(
        (artifact) => artifact.id,
      ),
    ).toEqual(["source-manifest", "transform-script"]);
    expect(outcome.provenance.manifest.preparationLineage).toEqual([
      {
        outputArtifactId: "diagnostic-snapshots",
        inputArtifactIds: ["source-archive"],
        transformationArtifactIds: ["source-manifest", "transform-script"],
      },
      {
        outputArtifactId: "exposures",
        inputArtifactIds: ["source-archive"],
        transformationArtifactIds: ["source-manifest", "transform-script"],
      },
    ]);
    expect(outcome.completed.gate).toMatchObject({
      reviewGate: "passed",
      metricGate: "passed",
    });
    const triggered = outcome.completed.review.evaluations.filter(
      (evaluation) => evaluation.status === "triggered",
    );
    expect(
      Object.fromEntries(
        [...new Set(triggered.map((evaluation) => evaluation.ruleId))].map(
          (id) => [
            id,
            triggered.filter((evaluation) => evaluation.ruleId === id).length,
          ],
        ),
      ),
    ).toEqual({
      "casualty/review/closed-reopen-signal": 8,
      "casualty/review/gross-incurred-monotonic": 38,
      "casualty/review/net-incurred-monotonic": 27,
    });
    const exactFindingEvidence = triggered.map((evaluation) => ({
      ruleId: evaluation.ruleId,
      scope: evaluation.scope,
      sources: evaluation.scope.sources,
    }));
    expect(
      createHash("sha256")
        .update(canonicalJson(exactFindingEvidence))
        .digest("hex"),
    ).toBe("efa7d1c262717c2ddbc61cfa9982f8fa2c807fc51d9b1908af804c3a1a489acc");
    for (const id of [
      "casualty/review/count-reconciliation",
      "casualty/review/closed-no-pay-bound",
      "casualty/review/positive-exposure",
      "casualty/review/net-paid-not-above-gross",
      "casualty/review/net-incurred-not-above-gross",
      "casualty/review/gross-paid-latest-control",
      "casualty/review/gross-incurred-latest-control",
      "casualty/review/net-paid-latest-control",
      "casualty/review/net-incurred-latest-control",
      "casualty/review/exposure-control",
    ]) {
      const evaluations = outcome.completed.review.evaluations.filter(
        (evaluation) => evaluation.ruleId === id,
      );
      expect(evaluations.length).toBeGreaterThan(0);
      expect(
        evaluations.every((evaluation) => evaluation.status === "pass"),
      ).toBe(true);
    }
    expect("wrapped" in outcome.bundle).toBe(true);
    const gross =
      outcome.completed.prepared.definition.definition.instances.find((item) =>
        item.id.includes("/gross/paid-to-incurred"),
      )!;
    const net = outcome.completed.prepared.definition.definition.instances.find(
      (item) => item.id.includes("/net/paid-to-incurred"),
    )!;
    expect(
      outcome.completed.prepared.definition.formulaFingerprints[
        gross.formulaId
      ],
    ).toBe(
      outcome.completed.prepared.definition.formulaFingerprints[net.formulaId],
    );
    expect(
      outcome.completed.prepared.definition.calculationFingerprints[gross.id],
    ).not.toBe(
      outcome.completed.prepared.definition.calculationFingerprints[net.id],
    );
  }, 30_000);
});
