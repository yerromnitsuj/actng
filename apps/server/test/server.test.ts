import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Server integration tests against a throwaway data directory. The env
 * module resolves paths at import time, so ACTNG_DATA_DIR is set before any
 * server module is imported (hence the dynamic imports).
 */

process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-test-"));

type Repo = typeof import("../src/db/repo.js");
type WorkspaceService = typeof import("../src/services/workspaceService.js");
type ImportService = typeof import("../src/services/importService.js");
type Synthetic = typeof import("../src/seed/synthetic.js");

let repo: Repo;
let ws: WorkspaceService;
let importService: ImportService;
let synthetic: Synthetic;

beforeAll(async () => {
  repo = await import("../src/db/repo.js");
  ws = await import("../src/services/workspaceService.js");
  importService = await import("../src/services/importService.js");
  synthetic = await import("../src/seed/synthetic.js");
});

describe("import validation", () => {
  const header =
    "claim_id,accident_date,report_date,evaluation_date,paid_to_date,case_reserve,status";

  it("parses a valid claims CSV", async () => {
    const csv = `${header}\nC1,2022-01-15,2022-02-01,2022-12-31,1000,500,open\n`;
    const claims = await importService.parseClaimsUpload("x.csv", Buffer.from(csv));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ claimId: "C1", paidToDate: 1000, status: "open" });
  });

  it("rejects files with missing columns, naming them", async () => {
    const csv = "claim_id,accident_date\nC1,2022-01-15\n";
    await expect(importService.parseClaimsUpload("x.csv", Buffer.from(csv))).rejects.toThrow(
      /Missing required column/,
    );
  });

  it("rejects bad rows with row numbers and imports nothing", async () => {
    const csv = `${header}\nC1,2022-01-15,2022-02-01,2022-12-31,not-a-number,500,open\n`;
    await expect(importService.parseClaimsUpload("x.csv", Buffer.from(csv))).rejects.toThrow(
      /row 2/,
    );
  });

  it("rejects date-order violations", async () => {
    const csv = `${header}\nC1,2022-05-15,2022-02-01,2022-12-31,100,0,open\n`;
    await expect(importService.parseClaimsUpload("x.csv", Buffer.from(csv))).rejects.toThrow(
      /report_date precedes accident_date/,
    );
  });

  it("rejects duplicate exposure origins", async () => {
    const csv = "origin,earned_premium\n2022,100\n2022,200\n";
    await expect(importService.parseExposuresUpload("x.csv", Buffer.from(csv))).rejects.toThrow(
      /Duplicate origin/,
    );
  });
});

describe("synthetic generator", () => {
  it("is deterministic for a fixed seed", () => {
    const a = synthetic.generateSyntheticLossRun({ seed: 42, nYears: 3, startYear: 2021, asOfDate: "2023-12-31" });
    const b = synthetic.generateSyntheticLossRun({ seed: 42, nYears: 3, startYear: 2021, asOfDate: "2023-12-31" });
    expect(a.claims.length).toBe(b.claims.length);
    expect(a.claims[0]).toEqual(b.claims[0]);
    expect(a.claims[a.claims.length - 1]).toEqual(b.claims[b.claims.length - 1]);
  });

  it("never emits snapshots beyond the as-of date and keeps dates ordered", () => {
    const { claims } = synthetic.generateSyntheticLossRun({ seed: 7, nYears: 4, startYear: 2020, asOfDate: "2023-12-31" });
    expect(claims.length).toBeGreaterThan(100);
    for (const c of claims) {
      expect(c.evaluationDate <= "2023-12-31").toBe(true);
      expect(c.reportDate >= c.accidentDate).toBe(true);
      expect(c.evaluationDate >= c.reportDate).toBe(true);
      expect(c.paidToDate).toBeGreaterThanOrEqual(0);
      expect(c.caseReserve).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("workspace service end to end", () => {
  let projectId: string;

  it("builds a workspace view from generated claims", () => {
    const project = repo.createProject("Test project", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 11,
      nYears: 5,
      startYear: 2021,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);

    const view = ws.getWorkspaceView(projectId);
    expect(view.triangles.paid.origins).toEqual(["2021", "2022", "2023", "2024", "2025"]);
    expect(view.triangles.paid.ages).toEqual([12, 24, 36, 48, 60]);
    // The last origin has exactly one observable cell.
    expect(view.triangles.paid.values[4]!.filter((v) => v !== null)).toHaveLength(1);
    expect(view.factors.paid.averages.length).toBeGreaterThan(4);
    expect(view.diagnostics.findings.length).toBeGreaterThan(0);
  });

  it("rejects selection vectors of the wrong shape with a 422", () => {
    expect(() =>
      ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: [1.5] } }),
    ).toThrowError(/Expected 4 LDF selections/);
  });

  it("refuses to run the analysis while selections are empty, naming the basis", () => {
    expect(() => ws.runFullAnalysis(projectId)).toThrowError(/paid basis/);
  });

  it("runs the full analysis once selections exist and keeps totals consistent", () => {
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });

    const record = ws.runFullAnalysis(projectId, "test run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;

    // Chain ladder internal consistency: ultimate = latest x CDF per row.
    for (const row of results.chainLadder.paid.rows) {
      expect(row.ultimate).toBeCloseTo(row.latestValue * row.cdf, 6);
      expect(row.unpaid).toBeCloseTo(row.ultimate - row.latestValue, 6);
    }
    const totalUlt = results.chainLadder.paid.rows.reduce((a, r) => a + r.ultimate, 0);
    expect(results.chainLadder.paid.totals.ultimate).toBeCloseTo(totalUlt, 6);

    // All six method rows are present (BF requires the exposures we imported).
    expect(results.summary.map((s) => s.method)).toEqual(
      expect.arrayContaining([
        "Chain Ladder",
        "Bornhuetter-Ferguson",
        "Berquist-Sherman (case adequacy)",
        "Berquist-Sherman (settlement rate)",
      ]),
    );
    // Mack ran on both bases.
    expect(results.mack.paid).not.toBeNull();
    expect(results.mack.incurred).not.toBeNull();
    expect(results.mack.paid!.totals.standardError).toBeGreaterThan(0);

    // The persisted record is retrievable.
    expect(repo.getAnalysis(record.id)?.id).toBe(record.id);
  });

  it("computes the selection-of-ultimates exhibit with renormalized weights and overrides", () => {
    // Default weights: CL paid 1, CL incurred 1 -> weighted = mean of the two.
    let view = ws.getWorkspaceView(projectId);
    expect(view.ultimateSelection).not.toBeNull();
    let sel = view.ultimateSelection!;
    const firstRow = sel.rows[0]!;
    const clP = firstRow.ultimates.clPaid!;
    const clI = firstRow.ultimates.clIncurred!;
    expect(firstRow.weighted).toBeCloseTo((clP + clI) / 2, 6);
    expect(firstRow.selected).toBeCloseTo(firstRow.weighted!, 6);
    expect(firstRow.ibnr).toBeCloseTo(firstRow.selected! - firstRow.latestIncurred, 6);
    expect(firstRow.unpaid).toBeCloseTo(firstRow.selected! - firstRow.latestPaid, 6);

    // Reweight: only B-S settlement -> weighted equals that method exactly.
    view = ws.patchWorkspace(projectId, {
      ultimateSelection: {
        weights: {
          clPaid: 0,
          clIncurred: 0,
          bfPaid: 0,
          bfIncurred: 0,
          bsCase: 0,
          bsSettlement: 2,
        },
      },
    });
    sel = view.ultimateSelection!;
    for (const row of sel.rows) {
      if (row.ultimates.bsSettlement !== null) {
        expect(row.weighted).toBeCloseTo(row.ultimates.bsSettlement, 6);
      }
    }

    // Override one origin: it wins over the weighted value and drives IBNR/unpaid.
    const origin = sel.rows[1]!.origin;
    view = ws.patchWorkspace(projectId, {
      ultimateSelection: { overrides: { [origin]: 1_234_567 } },
    });
    sel = view.ultimateSelection!;
    const overridden = sel.rows.find((r) => r.origin === origin)!;
    expect(overridden.override).toBe(1_234_567);
    expect(overridden.selected).toBe(1_234_567);
    expect(overridden.ibnr).toBeCloseTo(1_234_567 - overridden.latestIncurred, 6);
    // Totals reflect the override.
    const manualTotal = sel.rows.reduce((a, r) => a + (r.selected ?? 0), 0);
    expect(sel.totals.selected).toBeCloseTo(manualTotal, 6);

    // Clearing the override returns to the weighted value.
    view = ws.patchWorkspace(projectId, {
      ultimateSelection: { overrides: { [origin]: null } },
    });
    sel = view.ultimateSelection!;
    const cleared = sel.rows.find((r) => r.origin === origin)!;
    expect(cleared.override).toBeNull();
    expect(cleared.selected).toBeCloseTo(cleared.weighted!, 6);

    // Invalid inputs are rejected without mutating state.
    expect(() =>
      ws.patchWorkspace(projectId, { ultimateSelection: { weights: { clPaid: -1 } } }),
    ).toThrowError(/non-negative/);
    expect(() =>
      ws.patchWorkspace(projectId, { ultimateSelection: { overrides: { "2021": -5 } } }),
    ).toThrowError(/positive number/);
  });

  it("supports per-origin-period weights that renormalize within their own period", () => {
    // Reset all-periods weights to the CL pair.
    let view = ws.patchWorkspace(projectId, {
      ultimateSelection: {
        weights: {
          clPaid: 1,
          clIncurred: 1,
          bfPaid: 0,
          bfIncurred: 0,
          bsCase: 0,
          bsSettlement: 0,
        },
      },
    });
    let sel = view.ultimateSelection!;
    const target = sel.rows[sel.rows.length - 1]!.origin; // greenest period
    const other = sel.rows[0]!.origin;

    // Give ONLY the greenest period full BF-incurred credibility.
    view = ws.patchWorkspace(projectId, {
      ultimateSelection: {
        weightsByOrigin: {
          [target]: { clPaid: 0, clIncurred: 0, bfIncurred: 1 },
        },
      },
    });
    sel = view.ultimateSelection!;
    const custom = sel.rows.find((r) => r.origin === target)!;
    const untouched = sel.rows.find((r) => r.origin === other)!;
    expect(custom.customWeights).toBe(true);
    expect(custom.weights.bfIncurred).toBe(1);
    expect(custom.weighted).toBeCloseTo(custom.ultimates.bfIncurred!, 6);
    // Other periods still blend the CL pair from the defaults.
    expect(untouched.customWeights).toBe(false);
    expect(untouched.weighted).toBeCloseTo(
      (untouched.ultimates.clPaid! + untouched.ultimates.clIncurred!) / 2,
      6,
    );

    // An all-periods weight change overwrites the per-period tweak.
    view = ws.patchWorkspace(projectId, {
      ultimateSelection: { weights: { clPaid: 1, clIncurred: 1, bfIncurred: 0 } },
    });
    sel = view.ultimateSelection!;
    const flattened = sel.rows.find((r) => r.origin === target)!;
    expect(flattened.customWeights).toBe(false);
    expect(flattened.weighted).toBeCloseTo(
      (flattened.ultimates.clPaid! + flattened.ultimates.clIncurred!) / 2,
      6,
    );
  });

  it("runs sensitivities without mutating the workspace", () => {
    const before = ws.getWorkspaceView(projectId).state.selections.unlimited.paid;
    const result = ws.runSensitivity(projectId, {
      basis: "paid",
      tailFactor: 1.1,
    });
    expect(result.deltaUltimate).toBeGreaterThan(0);
    const after = ws.getWorkspaceView(projectId).state.selections.unlimited.paid;
    expect(after).toEqual(before);
  });
});

describe("selected-basis Mack and default fitted tails", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("Mack basis test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 23,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
  });

  it("auto-fits a default tail per basis from the data", () => {
    const result = ws.autoFitTailsFromData(projectId);
    const state = ws.ensureWorkspaceState(projectId);
    for (const basis of ["paid", "incurred"] as const) {
      if (result.applied.unlimited?.[basis]) {
        expect(state.tail.unlimited[basis].source).not.toBe("manual");
        expect(state.tail.unlimited[basis].value).toBeGreaterThan(1);
      } else {
        // No valid fit: honest fallback to a unit tail, with a warning.
        expect(state.tail.unlimited[basis].value).toBe(1);
        expect(result.warnings.some((w) => w.includes(basis))).toBe(true);
      }
    }
    // The synthetic paid triangle develops steadily; its fit must succeed.
    expect(result.applied.unlimited?.paid).toBeDefined();
  });

  it("Mack runs on the selected basis: central reserve ties to the chain ladder", () => {
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    // Perturb one selection so the basis genuinely differs from volume-weighted.
    const paidSel = allWtd("paid").map((v, i) => (v !== null && i === 0 ? v * 1.02 : v));
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: paidSel } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });

    const record = ws.runFullAnalysis(projectId, "mack basis run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.mack.paid).not.toBeNull();
    expect(results.mack.paid!.totals.ultimate).toBeCloseTo(
      results.chainLadder.paid.totals.ultimate,
      4,
    );
    expect(results.mack.incurred!.totals.ultimate).toBeCloseTo(
      results.chainLadder.incurred.totals.ultimate,
      4,
    );
    // The state's fitted tail flowed into both.
    const state = ws.ensureWorkspaceState(projectId);
    expect(results.mack.paid!.tailFactor).toBeCloseTo(state.tail.unlimited.paid.value, 9);
  });
});

describe("capped development layer", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("Layer test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 31,
      nYears: 5,
      startYear: 2021,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
  });

  it("migrates a pre-layer flat workspace state in place", () => {
    const state = ws.ensureWorkspaceState(projectId);
    // Regress the stored state to the pre-layer flat shape.
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete legacy.layer;
    legacy.selections = { paid: [1.5, null, null, null], incurred: [1.4, null, null, null] };
    legacy.tail = {
      paid: { source: "manual", value: 1.02 },
      incurred: { source: "manual", value: 1 },
    };
    repo.saveWorkspaceState(projectId, legacy as never);

    const migrated = repo.getWorkspaceState(projectId)!;
    expect(migrated.layer).toEqual({
      active: "unlimited",
      cap: null,
      indexRate: 0,
      baseYear: null,
    });
    expect(migrated.selections.unlimited.paid).toEqual([1.5, null, null, null]);
    expect(migrated.selections.capped.paid).toEqual([]);
    expect(migrated.tail.unlimited.paid.value).toBe(1.02);
    expect(migrated.tail.capped.incurred).toEqual({ source: "manual", value: 1 });
    // Restore a clean default state for the rest of the suite.
    repo.saveWorkspaceState(projectId, repo.defaultWorkspaceState(migrated.asOfDate));
  });

  it("refuses to activate the capped layer without a cap", () => {
    expect(() =>
      ws.patchWorkspace(projectId, { layer: { active: "capped" } }),
    ).toThrowError(/cap/i);
  });

  it("rejects nonsense cap settings", () => {
    expect(() => ws.patchWorkspace(projectId, { layer: { cap: -5 } })).toThrowError(/positive/);
    expect(() =>
      ws.patchWorkspace(projectId, { layer: { indexRate: -1.5 } }),
    ).toThrowError(/-100%/);
  });

  it("capped triangles are cell-wise <= unlimited with identical shape and counts", () => {
    const unlimited = ws.getWorkspaceView(projectId);
    ws.patchWorkspace(projectId, {
      layer: { cap: 100_000, indexRate: 0.05, active: "capped" },
    });
    const capped = ws.getWorkspaceView(projectId);
    expect(capped.triangles.paid.origins).toEqual(unlimited.triangles.paid.origins);
    expect(capped.triangles.paid.ages).toEqual(unlimited.triangles.paid.ages);
    let strictlySmaller = 0;
    for (const basis of ["paid", "incurred"] as const) {
      unlimited.triangles[basis].values.forEach((row, i) =>
        row.forEach((v, j) => {
          const c = capped.triangles[basis].values[i]![j];
          if (v === null) {
            expect(c).toBeNull();
          } else {
            expect(c!).toBeLessThanOrEqual(v + 1e-9);
            if (c! < v - 1e-9) strictlySmaller++;
          }
        }),
      );
    }
    expect(strictlySmaller).toBeGreaterThan(0); // the cap actually bites
    expect(capped.triangles.reportedCount.values).toEqual(
      unlimited.triangles.reportedCount.values,
    );
    // The layer review now carries the capped volatility comparison.
    expect(capped.layerReview.volatility.capped).not.toBeNull();
    expect(capped.layerReview.diagnostics.candidates.some((c) => c.cap === 100_000)).toBe(true);
  });

  it("capped layer has independent selections and runs its own analysis", () => {
    const view = ws.getWorkspaceView(projectId);
    expect(view.state.layer.active).toBe("capped");
    // Unlimited selections (none applied) must not leak into the capped layer.
    expect(view.state.selections.capped.paid.every((v) => v === null)).toBe(true);

    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    const after = ws.ensureWorkspaceState(projectId);
    expect(after.selections.capped.paid.some((v) => v !== null)).toBe(true);
    expect(after.selections.unlimited.paid.every((v) => v === null)).toBe(true);

    const record = ws.runFullAnalysis(projectId, "capped run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    const inputs = record.inputs as { layer: { active: string; cap: number } };
    expect(inputs.layer.active).toBe("capped");
    expect(inputs.layer.cap).toBe(100_000);
    expect(results.chainLadder.paid.totals.ultimate).toBeGreaterThan(0);
    // Mack ties to CL on the capped layer too.
    expect(results.mack.paid!.totals.ultimate).toBeCloseTo(
      results.chainLadder.paid.totals.ultimate,
      4,
    );
  });

  it("capped ultimate is below the unlimited ultimate on the same book", () => {
    // Switch back to unlimited, select the same-style factors, run, compare.
    ws.patchWorkspace(projectId, { layer: { active: "unlimited" } });
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    const unlimitedRun = ws.runFullAnalysis(projectId, "unlimited run");
    const unlimitedResults =
      unlimitedRun.results as import("../src/services/workspaceService.js").AnalysisResults;

    const analyses = repo.listAnalyses(projectId);
    const cappedRun = analyses.find((a) => a.label === "capped run")!;
    const cappedResults =
      repo.getAnalysis(cappedRun.id)!.results as import("../src/services/workspaceService.js").AnalysisResults;

    expect(cappedResults.chainLadder.paid.totals.ultimate).toBeLessThan(
      unlimitedResults.chainLadder.paid.totals.ultimate,
    );
  });
});

describe("layer redefinition and cross-layer isolation (review fixes)", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("Layer redefinition test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 47,
      nYears: 5,
      startYear: 2021,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    ws.patchWorkspace(projectId, { layer: { cap: 150_000, active: "capped" } });
  });

  it("changing the cap resets capped selections and re-fits capped tails", () => {
    const view = ws.getWorkspaceView(projectId);
    const allWtd = view.factors.paid.averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd } });
    let state = ws.ensureWorkspaceState(projectId);
    expect(state.selections.capped.paid.some((v) => v !== null)).toBe(true);
    const tailBefore = { ...state.tail.capped.paid };

    ws.patchWorkspace(projectId, { layer: { cap: 400_000 } });
    state = ws.ensureWorkspaceState(projectId);
    // Selections judged against the 150k layer are gone.
    expect(state.selections.capped.paid.every((v) => v === null || v === undefined)).toBe(true);
    // Tails were re-fitted (or honestly reset) against the 400k layer.
    const tailAfter = state.tail.capped.paid;
    expect(
      tailAfter.value !== tailBefore.value || tailAfter.source !== tailBefore.source || tailAfter.value === 1,
    ).toBe(true);
  });

  it("a no-op layer patch preserves a deliberate manual unit tail", () => {
    // The actuary judges no tail development: manual 1.0 on both bases.
    ws.patchWorkspace(projectId, { tail: { basis: "paid", source: "manual", value: 1 } });
    ws.patchWorkspace(projectId, { tail: { basis: "incurred", source: "manual", value: 1 } });
    // Re-assert the SAME layer settings (a no-op patch, like re-clicking the toggle).
    ws.patchWorkspace(projectId, { layer: { active: "capped" } });
    const state = ws.ensureWorkspaceState(projectId);
    expect(state.tail.capped.paid).toEqual({ source: "manual", value: 1 });
    expect(state.tail.capped.incurred).toEqual({ source: "manual", value: 1 });
  });

  it("bf a-priori and berquist trend are per-layer", () => {
    // Set an apriori while CAPPED is active.
    ws.patchWorkspace(projectId, { bf: { aprioriLossRatio: 0.8 } });
    ws.patchWorkspace(projectId, { berquist: { severityTrend: 0.12 } });
    let state = ws.ensureWorkspaceState(projectId);
    expect(state.bf.capped.aprioriLossRatio).toBe(0.8);
    expect(state.bf.unlimited.aprioriLossRatio).toBeNull();
    expect(state.berquist.capped.severityTrend).toBe(0.12);
    expect(state.berquist.unlimited.severityTrend).toBeNull();
    // Switch to unlimited: its own assumptions stay pristine.
    ws.patchWorkspace(projectId, { layer: { active: "unlimited" } });
    ws.patchWorkspace(projectId, { bf: { aprioriLossRatio: 0.65 } });
    state = ws.ensureWorkspaceState(projectId);
    expect(state.bf.unlimited.aprioriLossRatio).toBe(0.65);
    expect(state.bf.capped.aprioriLossRatio).toBe(0.8);
  });

  it("re-import refits BOTH layers' tails when a cap is set", () => {
    const result = ws.autoFitTailsFromData(projectId);
    expect(result.applied.unlimited).toBeDefined();
    expect(result.applied.capped).toBeDefined();
    const state = ws.ensureWorkspaceState(projectId);
    // Both layers now carry either a fitted tail or an honest unit fallback.
    for (const layer of ["unlimited", "capped"] as const) {
      for (const basis of ["paid", "incurred"] as const) {
        expect(state.tail[layer][basis].value).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("rejects a base year beyond 2200 at the service seam", () => {
    expect(() =>
      ws.patchWorkspace(projectId, { layer: { baseYear: 20255 } }),
    ).toThrowError(/1900 and 2200/);
  });

  it("analysis results carry the layer they ran on", () => {
    ws.patchWorkspace(projectId, { layer: { active: "capped" } });
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    const record = ws.runFullAnalysis(projectId, "layer stamp run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.layer?.active).toBe("capped");
    expect(results.layer?.cap).toBe(400_000);
    // The selection exhibit reports the run's layer too.
    const after = ws.getWorkspaceView(projectId);
    expect(after.ultimateSelection?.layer.active).toBe("capped");
  });
});
