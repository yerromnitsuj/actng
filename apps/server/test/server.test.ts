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
    const before = ws.getWorkspaceView(projectId).state.selections.paid;
    const result = ws.runSensitivity(projectId, {
      basis: "paid",
      tailFactor: 1.1,
    });
    expect(result.deltaUltimate).toBeGreaterThan(0);
    const after = ws.getWorkspaceView(projectId).state.selections.paid;
    expect(after).toEqual(before);
  });
});
