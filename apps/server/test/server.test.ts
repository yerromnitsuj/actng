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

  it("carries Benktander and frequency-severity at default weight 0 without moving the blend", () => {
    const view = ws.getWorkspaceView(projectId);
    const sel = view.ultimateSelection!;
    // 12 methods in the matrix, new ones present with zero default weight.
    expect(sel.methods.map((m) => m.key)).toEqual(
      expect.arrayContaining(["gbPaid", "gbIncurred", "freqSev"]),
    );
    expect(sel.methods.length).toBe(12);
    for (const key of ["gbPaid", "gbIncurred", "freqSev"] as const) {
      expect(sel.methods.find((m) => m.key === key)!.weight).toBe(0);
    }
    const firstRow = sel.rows[0]!;
    // The new indications exist and Benktander sits between CL and BF.
    expect(firstRow.ultimates.gbPaid).not.toBeNull();
    expect(firstRow.ultimates.gbIncurred).not.toBeNull();
    expect(firstRow.ultimates.freqSev).not.toBeNull();
    const lo = Math.min(firstRow.ultimates.clPaid!, firstRow.ultimates.bfPaid!) - 1e-6;
    const hi = Math.max(firstRow.ultimates.clPaid!, firstRow.ultimates.bfPaid!) + 1e-6;
    expect(firstRow.ultimates.gbPaid!).toBeGreaterThanOrEqual(lo);
    expect(firstRow.ultimates.gbPaid!).toBeLessThanOrEqual(hi);
    // Zero weight = the blend is still exactly the CL-paid/CL-incurred mean.
    expect(firstRow.weighted).toBeCloseTo(
      (firstRow.ultimates.clPaid! + firstRow.ultimates.clIncurred!) / 2,
      6,
    );
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

describe("increased limits: restoring capped ultimates", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("ILF test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 61,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    ws.patchWorkspace(projectId, { layer: { cap: 120_000, active: "capped" } });
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
  });

  it("exposes severity fits and stays honestly unresolved with source none", () => {
    const view = ws.getWorkspaceView(projectId);
    expect(view.ilfReview.fits).not.toBeNull();
    expect(view.ilfReview.resolved).toBeNull();
    expect(view.ilfReview.unresolvedReason).toMatch(/no ilf source/i);
    // A capped run without a source stays limited: selection = capped values.
    const record = ws.runFullAnalysis(projectId, "limited run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.ilf).toBeNull();
    expect(results.unlimitedDiagonals).toBeDefined();
    const sel = ws.getWorkspaceView(projectId).ultimateSelection!;
    expect(sel.restored).toBeNull();
    expect(sel.rows[0]!.ultimates.clPaid).toBeCloseTo(
      results.chainLadder.paid.rows[0]!.ultimate,
      6,
    );
  });

  it("restores selection ultimates by the fitted factor against unlimited diagonals", () => {
    const view = ws.patchWorkspace(projectId, {
      ilf: { source: "fitted", fittedKind: "lognormal", targetLimit: null },
    });
    const resolved = view.ilfReview.resolved;
    expect(resolved).not.toBeNull();
    expect(resolved!.factor).toBeGreaterThan(1);

    const record = ws.runFullAnalysis(projectId, "restored run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.ilf?.factor).toBeCloseTo(resolved!.factor, 9);

    const sel = ws.getWorkspaceView(projectId).ultimateSelection!;
    expect(sel.restored?.factor).toBeCloseTo(resolved!.factor, 9);
    // Row-level: restored ultimate = capped ultimate x factor.
    for (const row of sel.rows) {
      const capped = results.chainLadder.paid.rows.find((r) => r.origin === row.origin);
      if (capped && row.ultimates.clPaid !== null) {
        expect(row.ultimates.clPaid).toBeCloseTo(capped.ultimate * resolved!.factor, 4);
      }
      // IBNR base is the UNLIMITED diagonal, not the capped one.
      const diag = results.unlimitedDiagonals![row.origin]!;
      expect(row.latestIncurred).toBeCloseTo(diag.incurred, 6);
      if (row.selected !== null) {
        expect(row.ibnr).toBeCloseTo(row.selected - diag.incurred, 6);
      }
    }
  });

  it("unlimited diagonals are >= capped diagonals (the cap bites the base too)", () => {
    const view = ws.getWorkspaceView(projectId);
    const record = repo.listAnalyses(projectId).find((a) => a.label === "restored run")!;
    const results = repo.getAnalysis(record.id)!
      .results as import("../src/services/workspaceService.js").AnalysisResults;
    for (const row of results.chainLadder.incurred.rows) {
      const unl = results.unlimitedDiagonals![row.origin]!.incurred;
      expect(unl).toBeGreaterThanOrEqual(row.latestValue - 1e-9);
    }
    expect(view.ilfReview.resolved).not.toBeNull();
  });

  it("table source: interpolated ratio with finite target, refuses unlimited", () => {
    ws.patchWorkspace(projectId, {
      ilf: {
        table: [
          { limit: 100_000, factor: 1.0 },
          { limit: 250_000, factor: 1.4 },
          { limit: 1_000_000, factor: 1.95 },
        ],
        source: "table",
        targetLimit: null,
      },
    });
    let view = ws.getWorkspaceView(projectId);
    expect(view.ilfReview.resolved).toBeNull();
    expect(view.ilfReview.unresolvedReason).toMatch(/finite target/i);

    view = ws.patchWorkspace(projectId, { ilf: { targetLimit: 1_000_000 } });
    expect(view.ilfReview.resolved).not.toBeNull();
    // 120k cap between the 100k and 250k knots; factor = ILF(1M)/ILF(120k).
    expect(view.ilfReview.resolved!.factor).toBeGreaterThan(1.3);
    expect(view.ilfReview.resolved!.factor).toBeLessThan(1.95);
  });

  it("rejects garbage ilf patches", () => {
    expect(() =>
      ws.patchWorkspace(projectId, { ilf: { targetLimit: -5 } }),
    ).toThrowError(/positive/);
    expect(() =>
      ws.patchWorkspace(projectId, { ilf: { curveId: "not-a-curve" } }),
    ).toThrowError(/curve/i);
    expect(() =>
      ws.patchWorkspace(projectId, {
        ilf: { table: [{ limit: 100, factor: 1 }] },
      }),
    ).toThrowError(/two/);
  });

  it("ilf settings participate in run inputs (staleness)", () => {
    const record = repo.listAnalyses(projectId).find((a) => a.label === "restored run")!;
    const inputs = repo.getAnalysis(record.id)!.inputs as { ilf?: { source: string } };
    expect(inputs.ilf?.source).toBe("fitted");
  });
});

describe("phase-2 review fixes: factor ceiling, override clearing, unresolved honesty", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("ILF review-fix test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 61,
      nYears: 5,
      startYear: 2021,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    ws.patchWorkspace(projectId, { layer: { cap: 100_000, active: "capped" } });
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
  });

  it("refuses a resolved factor beyond the 10x sanity ceiling", () => {
    ws.patchWorkspace(projectId, {
      ilf: {
        table: [
          { limit: 100_000, factor: 1 },
          { limit: 25_000_000, factor: 50 },
        ],
        source: "table",
        targetLimit: 25_000_000,
      },
    });
    const view = ws.getWorkspaceView(projectId);
    expect(view.ilfReview.resolved).toBeNull();
    expect(view.ilfReview.unresolvedReason).toMatch(/sanity ceiling/);
  });

  it("stamps and warns when a configured source fails to resolve", () => {
    const record = ws.runFullAnalysis(projectId, "unresolved ilf run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.ilf).toBeNull();
    expect(results.ilfUnresolvedReason).toMatch(/sanity ceiling/);
    expect(results.warnings.join(" ")).toMatch(/did not resolve/);
  });

  it("clears manual overrides when the restoration config changes", () => {
    ws.patchWorkspace(projectId, {
      ultimateSelection: { overrides: { "2021": 1_200_000 } },
    });
    expect(
      Object.keys(ws.ensureWorkspaceState(projectId).ultimateSelection.overrides),
    ).toHaveLength(1);
    // A sane table this time; changing the config must void level-dependent overrides.
    ws.patchWorkspace(projectId, {
      ilf: {
        table: [
          { limit: 100_000, factor: 1 },
          { limit: 1_000_000, factor: 1.35 },
        ],
        targetLimit: 1_000_000,
      },
    });
    expect(
      Object.keys(ws.ensureWorkspaceState(projectId).ultimateSelection.overrides),
    ).toHaveLength(0);
  });

  it("clears overrides on a layer switch too", () => {
    ws.patchWorkspace(projectId, {
      ultimateSelection: { overrides: { "2022": 900_000 } },
    });
    ws.patchWorkspace(projectId, { layer: { active: "unlimited" } });
    expect(
      Object.keys(ws.ensureWorkspaceState(projectId).ultimateSelection.overrides),
    ).toHaveLength(0);
    ws.patchWorkspace(projectId, { layer: { active: "capped" } });
  });

  it("a sane table restores and flags restoration-shortfall rows honestly", () => {
    const record = ws.runFullAnalysis(projectId, "restored run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.ilf).not.toBeNull();
    expect(results.ilf!.factor).toBeGreaterThan(1);
    expect(results.ilf!.factor).toBeLessThan(10);
    const view = ws.getWorkspaceView(projectId);
    const sel = view.ultimateSelection!;
    // Every row carries the flag field; flagged rows are exactly those whose
    // restored blend sits below their unlimited reported incurred.
    for (const row of sel.rows) {
      expect(typeof row.restorationShortfall).toBe("boolean");
      if (row.weighted !== null) {
        expect(row.restorationShortfall).toBe(row.weighted < row.latestIncurred);
      }
    }
  });

  it("rejects {source:'table', table:null} in a single patch", () => {
    expect(() =>
      ws.patchWorkspace(projectId, { ilf: { source: "table", table: null } }),
    ).toThrowError(/Import an ILF table/);
  });

  it("rejects duplicate-limit tables at the patch door", () => {
    expect(() =>
      ws.patchWorkspace(projectId, {
        ilf: {
          table: [
            { limit: 100_000, factor: 1 },
            { limit: 100_000, factor: 1.2 },
            { limit: 250_000, factor: 1.4 },
          ],
        },
      }),
    ).toThrowError(/Duplicate limit/);
  });
});

describe("trend and frequency/severity exhibit", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("Trend test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 73,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    ws.runFullAnalysis(projectId, "trend base run");
  });

  it("populates every row with consistent math and the run stamps ultimate counts", () => {
    const view = ws.getWorkspaceView(projectId);
    const review = view.trendReview!;
    expect(review).not.toBeNull();
    expect(review.level).toBe("unlimited");

    // The run itself carries counts keyed by origin - asserted directly, not
    // through the exhibit (a broken stamp must fail HERE, not vacuously).
    const record = repo.getAnalysis(view.ultimateSelection!.analysisId)!;
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.ultimateCounts).toBeDefined();
    for (const row of review.rows) {
      expect(results.ultimateCounts![row.origin]).toBeGreaterThan(0);
    }

    // Every row must be POPULATED (exposures exist for every seeded year);
    // guarded if-checks would pass vacuously on a broken join.
    const exposures = repo.getExposures(projectId);
    const sel = view.ultimateSelection!;
    for (const row of review.rows) {
      const premium = exposures.find((e) => e.origin === row.origin)!.earnedPremium!;
      const selRow = sel.rows.find((r) => r.origin === row.origin)!;
      expect(row.ultimateCounts).not.toBeNull();
      expect(row.frequency).not.toBeNull();
      expect(row.severity).not.toBeNull();
      expect(row.frequency!).toBeCloseTo(row.ultimateCounts! / (premium / 1_000_000), 9);
      expect(row.severity!).toBeCloseTo(selRow.selected! / row.ultimateCounts!, 6);
      // Midpoint convention: annual origins sit at year + 0.5.
      expect(row.year - Math.floor(row.year)).toBeCloseTo(0.5, 12);
      // No selections yet -> trended columns blank.
      expect(row.trendedFrequency).toBeNull();
      expect(row.trendedSeverity).toBeNull();
    }
  });

  it("selected trends drive the trended restatement exactly", () => {
    ws.patchWorkspace(projectId, {
      trend: {
        frequency: { source: "manual", value: 0.02 },
        severity: { layer: "unlimited", source: "manual", value: 0.08 },
        targetYear: 2025,
      },
    });
    const review = ws.getWorkspaceView(projectId).trendReview!;
    for (const row of review.rows) {
      expect(row.frequency).not.toBeNull();
      expect(row.severity).not.toBeNull();
      // Restatement runs midpoint-to-midpoint: target x = targetYear + 0.5.
      expect(row.trendedFrequency).toBeCloseTo(
        row.frequency! * Math.pow(1.02, 2025.5 - row.year),
        9,
      );
      expect(row.trendedSeverity).toBeCloseTo(
        row.severity! * Math.pow(1.08, 2025.5 - row.year),
        6,
      );
    }
  });

  it("severity trend selections are per layer and the exhibit reads the run's layer slot", () => {
    const state = ws.ensureWorkspaceState(projectId);
    expect(state.trend.severity.unlimited.value).toBe(0.08);
    expect(state.trend.severity.capped.value).toBeNull();
    // Writing the capped slot must not disturb the unlimited exhibit.
    ws.patchWorkspace(projectId, {
      trend: { severity: { layer: "capped", source: "manual", value: 0.03 } },
    });
    const review = ws.getWorkspaceView(projectId).trendReview!;
    expect(review.severityLayer).toBe("unlimited");
    expect(review.severity.selection.value).toBe(0.08);
  });

  it("fits recover an exact planted trend through the full stack", () => {
    // Synthetic data won't be exactly exponential, but the fit plumbing must
    // return rates and R^2 for windows with enough points.
    const review = ws.getWorkspaceView(projectId).trendReview!;
    const all = review.severity.fits.find((f) => f.key === "all")!;
    expect(all.nPoints).toBeGreaterThanOrEqual(5);
    expect(all.annualRate).not.toBeNull();
    expect(all.rSquared).not.toBeNull();
  });

  it("cap redefinition and ilf changes reset the capped severity-trend judgment", () => {
    ws.patchWorkspace(projectId, { layer: { cap: 200_000 } });
    ws.patchWorkspace(projectId, {
      trend: { severity: { layer: "capped", source: "manual", value: 0.04 } },
    });
    expect(ws.ensureWorkspaceState(projectId).trend.severity.capped.value).toBe(0.04);
    // Redefine the cap: the capped-series judgment is void.
    ws.patchWorkspace(projectId, { layer: { cap: 300_000 } });
    expect(ws.ensureWorkspaceState(projectId).trend.severity.capped.value).toBeNull();
    // Re-select, then change the restoration config: void again (level flip).
    ws.patchWorkspace(projectId, {
      trend: { severity: { layer: "capped", source: "manual", value: 0.05 } },
    });
    ws.patchWorkspace(projectId, {
      ilf: {
        table: [
          { limit: 300_000, factor: 1 },
          { limit: 2_000_000, factor: 1.3 },
        ],
      },
    });
    expect(ws.ensureWorkspaceState(projectId).trend.severity.capped.value).toBeNull();
    // The unlimited slot is untouched throughout.
    expect(ws.ensureWorkspaceState(projectId).trend.severity.unlimited.value).toBe(0.08);
  });

  it("rejects garbage trend patches", () => {
    expect(() =>
      ws.patchWorkspace(projectId, {
        trend: { frequency: { source: "manual", value: -1.5 } },
      }),
    ).toThrowError(/-100%/);
    expect(() =>
      ws.patchWorkspace(projectId, { trend: { targetYear: 1500 } }),
    ).toThrowError(/1900 and 2200/);
  });
});

describe("expected-loss-ratio machinery (phase 4)", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("ELR test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 89,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
  });

  it("parallelogram on-level factors flow into the exhibit and run adjustments", () => {
    ws.patchWorkspace(projectId, {
      rates: {
        history: [
          { effectiveDate: "2022-01-01", change: 0.1 },
          { effectiveDate: "2024-01-01", change: 0.05 },
        ],
        premiumTrend: 0.02,
      },
      trend: {
        frequency: { source: "manual", value: 0.0 },
        severity: { layer: "unlimited", source: "manual", value: 0.08 },
        targetYear: 2025,
      },
    });
    const record = ws.runFullAnalysis(projectId, "elr base run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    // Adjustments stamped per origin; 2020 predates all changes -> its OLF
    // is the full compounded level 1.1 * 1.05.
    expect(results.elrAdjustments).toBeDefined();
    expect(results.elrAdjustments!["2020"]!.onLevelFactor).toBeCloseTo(1.1 * 1.05, 6);
    // Loss adj for 2020 at 8% sev (freq 0): (1.08)^(2025.5-2020.5) = 1.08^5.
    expect(results.elrAdjustments!["2020"]!.lossAdj).toBeCloseTo(1.08 ** 5, 6);
    // Cape Cod ran on both bases with a sane mechanical ELR.
    expect(results.capeCod?.paid?.elrAtTargetLevel).toBeGreaterThan(0);
    expect(results.capeCod?.incurred?.elrAtTargetLevel).toBeGreaterThan(0);
    // Cape Cod internal identity on one row: ultimate = reported + expected x (1 - 1/cdf).
    const cc = results.capeCod!.paid!;
    const row = cc.rows[cc.rows.length - 1]!;
    expect(row.ultimate).toBeCloseTo(
      row.reported + row.expectedUltimate * (1 - 1 / row.cdf),
      6,
    );
    // The ELR exhibit populates with premium-weighted average available.
    const review = ws.getWorkspaceView(projectId).elrReview!;
    expect(review.rows.length).toBeGreaterThan(0);
    const wtd = review.averages.find((a) => a.key === "wtd-all")!;
    expect(wtd.value).toBeGreaterThan(0);
    expect(review.capeCodElr.paid).toBeCloseTo(cc.elrAtTargetLevel, 9);
  });

  it("a selected ELR drives BF per-origin a-priori and the Expected Claims method", () => {
    ws.patchWorkspace(projectId, { elr: { selected: 0.7 } });
    const record = ws.runFullAnalysis(projectId, "elr selected run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    // Expected Claims: ultimate_i = 0.7 restated to origin level x premium_i.
    expect(results.expectedClaims).not.toBeNull();
    const exposures = repo.getExposures(projectId);
    for (const row of results.expectedClaims!.rows) {
      const adj = results.elrAdjustments![row.origin]!;
      const premium = exposures.find((e) => e.origin === row.origin)!.earnedPremium!;
      expect(row.ultimate).toBeCloseTo(((0.7 * adj.premiumAdj) / adj.lossAdj) * premium, 6);
    }
    // BF used the restated ELR as its per-origin a-priori.
    const bfRow = results.bornhuetterFerguson.paid!.rows.find((r) => r.origin === "2025")!;
    const adj2025 = results.elrAdjustments!["2025"]!;
    expect(bfRow.aprioriLossRatio).toBeCloseTo((0.7 * adj2025.premiumAdj) / adj2025.lossAdj, 9);
    // Selection matrix carries all nine methods.
    const sel = ws.getWorkspaceView(projectId).ultimateSelection!;
    expect(sel.methods.map((m) => m.key)).toEqual(
      expect.arrayContaining(["ccPaid", "ccIncurred", "expectedClaims"]),
    );
    const first = sel.rows[0]!;
    expect(first.ultimates.ccPaid).not.toBeNull();
    expect(first.ultimates.expectedClaims).not.toBeNull();
  });

  it("a manual BF override still wins over the selected ELR", () => {
    ws.patchWorkspace(projectId, { bf: { aprioriLossRatio: 0.55 } });
    const record = ws.runFullAnalysis(projectId, "manual override run");
    const results = record.results as import("../src/services/workspaceService.js").AnalysisResults;
    for (const row of results.bornhuetterFerguson.paid!.rows) {
      expect(row.aprioriLossRatio).toBeCloseTo(0.55, 9);
    }
    ws.patchWorkspace(projectId, { bf: { aprioriLossRatio: null } });
  });

  it("rates and elr are run inputs (staleness) and validate at the door", () => {
    const record = repo.listAnalyses(projectId)[0]!;
    const full = repo.getAnalysis(record.id)!;
    const inputs = full.inputs as { rates?: unknown; elr?: unknown };
    expect(inputs.rates).toBeDefined();
    expect(inputs.elr).toBeDefined();
    expect(() =>
      ws.patchWorkspace(projectId, {
        rates: { history: [{ effectiveDate: "2024-13-01", change: 0.1 }] },
      }),
    ).toThrowError(/calendar dates/);
    expect(() => ws.patchWorkspace(projectId, { elr: { selected: -0.2 } })).toThrowError(
      /positive/,
    );
  });
});

describe("phase-4 review fixes: level coherence, zod weights, on-level frequency", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("ELR coherence test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 89,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
  });

  it("the route zod accepts weights for the three new methods", async () => {
    const { patchSchema } = await import("../src/routes/workspace.js");
    const parsed = patchSchema.parse({
      ultimateSelection: { weights: { ccPaid: 1, ccIncurred: 2, expectedClaims: 3 } },
    });
    expect(parsed.ultimateSelection?.weights).toEqual({
      ccPaid: 1,
      ccIncurred: 2,
      expectedClaims: 3,
    });
  });

  it("trend exhibit frequency divides by ON-LEVEL premium", () => {
    ws.runFullAnalysis(projectId, "base run");
    ws.patchWorkspace(projectId, {
      rates: { history: [{ effectiveDate: "2023-01-01", change: 0.1 }] },
    });
    const view = ws.getWorkspaceView(projectId);
    const review = view.trendReview!;
    const exposures = repo.getExposures(projectId);
    const row2020 = review.rows.find((r) => r.origin === "2020")!;
    expect(row2020.onLevelFactor).toBeGreaterThan(1); // pre-change year restates up
    const premium = exposures.find((e) => e.origin === "2020")!.earnedPremium!;
    expect(row2020.frequency).toBeCloseTo(
      row2020.ultimateCounts! / ((premium * row2020.onLevelFactor) / 1_000_000),
      9,
    );
  });

  it("ELR selected on a restored exhibit is de-restated for the run: Expected Claims is restored exactly once", () => {
    // Arm the capped+restored pipeline.
    ws.patchWorkspace(projectId, { layer: { cap: 150_000, active: "capped" } });
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    ws.patchWorkspace(projectId, {
      ilf: {
        table: [
          { limit: 150_000, factor: 1 },
          { limit: 5_000_000, factor: 1.25 },
        ],
        source: "table",
        targetLimit: 5_000_000,
      },
    });
    const restoredRun = ws.runFullAnalysis(projectId, "restored run");
    const restoredResults =
      restoredRun.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(restoredResults.ilf).not.toBeNull();
    const factor = restoredResults.ilf!.factor;

    // Select an ELR from the RESTORED exhibit (stamps the level).
    ws.patchWorkspace(projectId, { elr: { selected: 0.7 } });
    expect(ws.ensureWorkspaceState(projectId).elr.selectedAtLevel).toBe("restored");

    const rerun = ws.runFullAnalysis(projectId, "ec run");
    const results = rerun.results as import("../src/services/workspaceService.js").AnalysisResults;
    // EC ran (levels match) with the DE-RESTATED elr...
    expect(results.expectedClaims).not.toBeNull();
    expect(results.expectedClaims!.selectedElrAtTargetLevel).toBeCloseTo(0.7 / factor, 9);
    // ...so after the matrix restores it ONCE, the displayed EC ultimate is
    // the target-level a-priori: 0.7 x premium x premiumAdj/lossAdj.
    const sel = ws.getWorkspaceView(projectId).ultimateSelection!;
    const adj = results.elrAdjustments!;
    const exposures = repo.getExposures(projectId);
    const probe = sel.rows.find((r) => r.ultimates.expectedClaims !== null)!;
    const premium = exposures.find((e) => e.origin === probe.origin)!.earnedPremium!;
    const a = adj[probe.origin]!;
    expect(probe.ultimates.expectedClaims!).toBeCloseTo(
      ((0.7 * a.premiumAdj) / a.lossAdj) * premium,
      6,
    );
  });

  it("a level mismatch SKIPS Expected Claims and the derived a-priori with a warning", () => {
    ws.patchWorkspace(projectId, { layer: { active: "unlimited" } });
    const run = ws.runFullAnalysis(projectId, "mismatch run");
    const results = run.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.expectedClaims ?? null).toBeNull();
    // The skip is now a structured field the selection exhibit surfaces (round-5 F2),
    // not just a buried warning - assert both.
    expect(results.elrDerivedSkipReason).toBeTruthy();
    expect(results.elrDerivedSkipReason).toMatch(/skipped/i);
    expect(results.warnings.join(" ")).toMatch(/skipped/i);
    ws.patchWorkspace(projectId, { layer: { active: "capped" } });
  });

  it("elrReview restates the Cape Cod cross-check to the restored level and discloses circularity", () => {
    // The exhibit reads the LATEST run; the previous test left an unlimited
    // one on top - put a capped+restored run back first.
    ws.runFullAnalysis(projectId, "restored again");
    ws.patchWorkspace(projectId, {
      ultimateSelection: { weights: { expectedClaims: 1 } },
    });
    const view = ws.getWorkspaceView(projectId);
    const review = view.elrReview!;
    expect(review.level).toBe("restored");
    expect(review.warnings.join(" ")).toMatch(/restated x/);
    expect(review.warnings.join(" ")).toMatch(/SELF-CONFIRM/);
    // Reset the EC weight.
    ws.patchWorkspace(projectId, { ultimateSelection: { weights: { expectedClaims: 0 } } });
  });

  it("trend changes now flag runs stale (trend is a run input)", () => {
    const run = ws.runFullAnalysis(projectId, "trend input run");
    const inputs = run.inputs as { trend?: unknown };
    expect(inputs.trend).toBeDefined();
  });
});

describe("mastra instance storage", () => {
  it("uses durable LibSQL storage so paused workflow runs survive restarts", async () => {
    // Without an explicit storage adapter Mastra falls back to an in-memory
    // store and a suspended ELR derivation dies with the process, breaking the
    // advisor's resume-by-runId promise (proven by cross-process resume: the
    // rehydrated run throws "This workflow run was not suspended").
    const { LibSQLStore } = await import("@mastra/libsql");
    const { mastra } = await import("../src/mastra/index.js");
    expect(mastra.getStorage()).toBeInstanceOf(LibSQLStore);
  });
});

describe("derive-expected-losses workflow (phase 5)", () => {
  let projectId: string;

  beforeAll(() => {
    const project = repo.createProject("Workflow gate test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 101,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    ws.runFullAnalysis(projectId, "workflow base");
  });

  it("suspends at every gate, applies decisions through the service layer, and persists the trail", async () => {
    const { RequestContext } = await import("@mastra/core/request-context");
    const { mastra } = await import("../src/mastra/index.js");
    const rc = new RequestContext<{ projectId: string }>();
    rc.set("projectId", projectId);
    const wf = mastra.getWorkflow("deriveExpectedLossesWorkflow");
    const run = await wf.createRun();

    let result = (await run.start({ inputData: {}, requestContext: rc })) as {
      status: string;
      suspended?: string[][];
      steps?: Record<string, { suspendPayload?: { stage?: string; recommendation?: string } }>;
      result?: { trail: unknown[]; selectedElr: number | null; noteId: string | null };
    };
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("cap-gate");
    expect(
      result.steps!["cap-gate"]!.suspendPayload!.recommendation!.length,
    ).toBeGreaterThan(10);

    // Gate 1: stay unlimited. The ilf gate must pass through silently.
    result = (await run.resume({
      step: "cap-gate",
      resumeData: { decision: "skip", rationale: "test: stay unlimited" },
      requestContext: rc,
    })) as typeof result;
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("trend-gate");

    // Gate 3: trends.
    result = (await run.resume({
      step: "trend-gate",
      resumeData: { decision: "accept", frequency: null, severity: 0.05, rationale: "sev 5%" },
      requestContext: rc,
    })) as typeof result;
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("elr-gate");

    // Gate 4: the ELR.
    result = (await run.resume({
      step: "elr-gate",
      resumeData: { decision: "accept", selected: 0.68, rationale: "weighted average" },
      requestContext: rc,
    })) as typeof result;
    expect(result.status).toBe("success");
    expect(result.result!.selectedElr).toBe(0.68);
    expect(result.result!.trail).toHaveLength(3);
    expect(result.result!.noteId).not.toBeNull();

    // The decisions landed in real state through the same service layer.
    const state = ws.ensureWorkspaceState(projectId);
    expect(state.elr.selected).toBe(0.68);
    expect(state.elr.selectedAtLevel).toBe("unlimited");
    expect(state.trend.severity.unlimited.value).toBe(0.05);
    const note = repo.listNotes(projectId).find((n) => n.text.includes("ELR derivation trail"));
    expect(note).toBeDefined();
    expect(note!.text).toMatch(/stay unlimited/);
  }, 30_000);
});

describe("elr derivation compliance ledger (dogfood addition)", () => {
  it("persists the assumption ledger as a second advisor note whose entries carry the rationale verbatim", async () => {
    const project = repo.createProject("Ledger note test", "");
    const projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 101,
      nYears: 6,
      startYear: 2020,
      asOfDate: "2025-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    const allWtd = (basis: "paid" | "incurred") =>
      view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtd("paid") } });
    ws.patchWorkspace(projectId, {
      selections: { basis: "incurred", selected: allWtd("incurred") },
    });
    ws.runFullAnalysis(projectId, "ledger base");

    const { RequestContext } = await import("@mastra/core/request-context");
    const { mastra } = await import("../src/mastra/index.js");
    const rc = new RequestContext<{ projectId: string }>();
    rc.set("projectId", projectId);
    const wf = mastra.getWorkflow("deriveExpectedLossesWorkflow");
    const run = await wf.createRun();

    const trendRationale = "severity 5%/yr from the all-years fit";
    const elrRationale = "anchored on the premium-weighted average";
    let result = (await run.start({ inputData: {}, requestContext: rc })) as { status: string };
    expect(result.status).toBe("suspended");
    result = (await run.resume({
      step: "cap-gate",
      resumeData: { decision: "skip", rationale: "ledger test: stay unlimited" },
      requestContext: rc,
    })) as typeof result;
    result = (await run.resume({
      step: "trend-gate",
      resumeData: { decision: "accept", frequency: null, severity: 0.05, rationale: trendRationale },
      requestContext: rc,
    })) as typeof result;
    result = (await run.resume({
      step: "elr-gate",
      resumeData: { decision: "accept", selected: 0.68, rationale: elrRationale },
      requestContext: rc,
    })) as typeof result;
    expect(result.status).toBe("success");

    // Both notes exist: the human-readable trail and the compliance ledger.
    const notes = repo.listNotes(projectId);
    expect(notes.find((n) => n.text.includes("ELR derivation trail"))).toBeDefined();
    const ledgerNote = notes.find((n) => n.text.startsWith("ELR derivation assumption ledger:"));
    expect(ledgerNote).toBeDefined();
    expect(ledgerNote!.author).toBe("advisor");

    const ledger = JSON.parse(
      ledgerNote!.text.slice("ELR derivation assumption ledger:\n".length),
    ) as {
      entries: {
        seq: number;
        timestamp: string;
        actor: string;
        field: string;
        value: unknown;
        rationale?: string;
      }[];
    };
    const byField = new Map(ledger.entries.map((e) => [e.field, e]));
    expect(byField.get("trend.frequency")).toMatchObject({
      actor: "actuary",
      value: null,
      rationale: trendRationale,
    });
    expect(byField.get("trend.severity.unlimited")).toMatchObject({
      actor: "actuary",
      value: 0.05,
      rationale: trendRationale,
    });
    expect(byField.get("elr.selected")).toMatchObject({
      actor: "actuary",
      value: 0.68,
      rationale: elrRationale,
    });
    // seq assigned contiguously by the recorder; timestamps are ISO strings.
    expect(ledger.entries.map((e) => e.seq)).toEqual(ledger.entries.map((_, i) => i + 1));
    for (const e of ledger.entries) expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 30_000);
});

describe("pure-premium method", () => {
  let projectId: string;
  const allWtdOf = (view: ReturnType<WorkspaceService["getWorkspaceView"]>, basis: "paid" | "incurred") =>
    view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
  const setup = () => {
    const project = repo.createProject("Pure premium test", "");
    projectId = project.id;
    const { claims, exposures } = synthetic.generateSyntheticLossRun({
      seed: 99,
      nYears: 6,
      startYear: 2019,
      asOfDate: "2024-12-31",
    });
    repo.insertClaims(projectId, claims);
    repo.replaceExposures(projectId, exposures);
    const view = ws.getWorkspaceView(projectId);
    ws.patchWorkspace(projectId, { selections: { basis: "paid", selected: allWtdOf(view, "paid") } });
    ws.patchWorkspace(projectId, { selections: { basis: "incurred", selected: allWtdOf(view, "incurred") } });
  };

  it("the synthetic generator emits exposure units alongside premium", () => {
    const { exposures } = synthetic.generateSyntheticLossRun({ seed: 1, nYears: 3, startYear: 2020, asOfDate: "2022-12-31" });
    for (const e of exposures) {
      expect(e.earnedPremium!).toBeGreaterThan(0);
      expect(e.exposureUnits!).toBeGreaterThan(0);
    }
  });

  it("divides by units (no on-leveling) and Expected Claims uses pure premium x units", () => {
    setup();
    // A rate history is present but must NOT touch pure premium (units don't on-level).
    ws.patchWorkspace(projectId, { rates: { history: [{ effectiveDate: "2022-01-01", change: 0.1 }] } });
    ws.patchWorkspace(projectId, { elr: { method: "pure-premium" } });
    ws.runFullAnalysis(projectId, "pp run");
    const review = ws.getWorkspaceView(projectId).elrReview!;
    expect(review.method).toBe("pure-premium");
    const exposures = repo.getExposures(projectId);
    for (const r of review.rows) {
      expect(r.onLevelFactor).toBe(1); // units are not rate-sensitive
      const units = exposures.find((e) => e.origin === r.origin)!.exposureUnits!;
      expect(r.premium).toBeCloseTo(units, 6); // the base IS units, not premium
      if (r.trendedUltimate !== null) {
        expect(r.lossRatioAtTarget!).toBeCloseTo(r.trendedUltimate / units, 6);
        expect(r.lossRatioAtTarget!).toBeGreaterThan(50); // a dollar pure premium, not a ratio
      }
    }
    // Select the weighted pure premium; Expected Claims = (PP / lossAdj) x units.
    const wtd = Math.round(review.averages.find((a) => a.key === "wtd-all")!.value!);
    ws.patchWorkspace(projectId, { elr: { selected: wtd } });
    const rerun = ws.runFullAnalysis(projectId, "pp ec run");
    const results = rerun.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.expectedClaims).not.toBeNull();
    const sel = ws.getWorkspaceView(projectId).ultimateSelection!;
    const adj = results.elrAdjustments!;
    const probe = sel.rows.find((r) => r.ultimates.expectedClaims !== null)!;
    const units = exposures.find((e) => e.origin === probe.origin)!.exposureUnits!;
    const a = adj[probe.origin]!;
    expect(a.premiumAdj).toBe(1); // no on-level / premium trend
    expect(probe.ultimates.expectedClaims!).toBeCloseTo((wtd / a.lossAdj) * units, 3);
  });

  it("switching methods clears a selected a-priori and manual BF override", () => {
    setup();
    ws.patchWorkspace(projectId, { elr: { selected: 0.7 } });
    ws.patchWorkspace(projectId, { bf: { aprioriLossRatio: 0.8 } });
    expect(ws.ensureWorkspaceState(projectId).elr.selected).toBe(0.7);
    ws.patchWorkspace(projectId, { elr: { method: "pure-premium" } });
    const state = ws.ensureWorkspaceState(projectId);
    expect(state.elr.method).toBe("pure-premium");
    expect(state.elr.selected).toBeNull();
    expect(state.elr.selectedAtLevel).toBeNull();
    expect(state.bf.unlimited.aprioriLossRatio).toBeNull();
  });

  it("loss-ratio yields a ratio, pure-premium yields a dollar amount (bases differ)", () => {
    setup();
    ws.runFullAnalysis(projectId, "lr run");
    const lr = ws.getWorkspaceView(projectId).elrReview!;
    expect(lr.method).toBe("loss-ratio");
    const lrWtd = lr.averages.find((a) => a.key === "wtd-all")!.value!;
    expect(lrWtd).toBeGreaterThan(0.2);
    expect(lrWtd).toBeLessThan(3);
    ws.patchWorkspace(projectId, { elr: { method: "pure-premium" } });
    ws.runFullAnalysis(projectId, "pp run");
    const pp = ws.getWorkspaceView(projectId).elrReview!;
    const ppWtd = pp.averages.find((a) => a.key === "wtd-all")!.value!;
    expect(ppWtd).toBeGreaterThan(50);
  });

  it("pure premium with no exposure units skips BF/EC with a units-specific message", () => {
    const project = repo.createProject("PP no units", "");
    const pid = project.id;
    const { claims } = synthetic.generateSyntheticLossRun({ seed: 5, nYears: 4, startYear: 2020, asOfDate: "2023-12-31" });
    repo.insertClaims(pid, claims);
    repo.replaceExposures(pid, [
      { origin: "2020", earnedPremium: 1_000_000, exposureUnits: null },
      { origin: "2021", earnedPremium: 1_000_000, exposureUnits: null },
      { origin: "2022", earnedPremium: 1_000_000, exposureUnits: null },
      { origin: "2023", earnedPremium: 1_000_000, exposureUnits: null },
    ]);
    const view = ws.getWorkspaceView(pid);
    ws.patchWorkspace(pid, { selections: { basis: "paid", selected: allWtdOf(view, "paid") } });
    ws.patchWorkspace(pid, { selections: { basis: "incurred", selected: allWtdOf(view, "incurred") } });
    ws.patchWorkspace(pid, { elr: { method: "pure-premium" } });
    const run = ws.runFullAnalysis(pid, "pp no units");
    const results = run.results as import("../src/services/workspaceService.js").AnalysisResults;
    expect(results.bornhuetterFerguson.skippedReason).toMatch(/exposure units/i);
    expect(results.warnings.join(" ")).toMatch(/pure-premium method needs them/i);
  });

  it("hides the Cape Cod cross-check (not mislabels it) when the method is toggled without a rerun", () => {
    setup();
    ws.patchWorkspace(projectId, { elr: { method: "pure-premium" } });
    ws.runFullAnalysis(projectId, "pp run");
    expect(ws.getWorkspaceView(projectId).elrReview!.capeCodElr.paid!).toBeGreaterThan(50);

    // Toggle to loss ratio WITHOUT rerunning: the run's pure-premium Cape Cod must
    // NOT reappear as a ~45000% loss ratio - it is hidden until a rerun (round 7).
    ws.patchWorkspace(projectId, { elr: { method: "loss-ratio" } });
    const stale = ws.getWorkspaceView(projectId).elrReview!;
    expect(stale.method).toBe("loss-ratio");
    expect(stale.capeCodElr.paid).toBeNull();
    expect(stale.warnings.join(" ")).toMatch(/method changed/i);

    // Rerun in loss ratio: now it is a real loss ratio.
    ws.runFullAnalysis(projectId, "lr run");
    const lr = ws.getWorkspaceView(projectId).elrReview!;
    expect(lr.capeCodElr.paid!).toBeGreaterThan(0.2);
    expect(lr.capeCodElr.paid!).toBeLessThan(3);
  });
});
