/**
 * Golden-prompt evals for the advisor: does a realistic instruction select
 * the right tool(s)? Runs the REAL model (claude-opus-4-8) against a seeded
 * scratch project - every run costs live API tokens, so it is opt-in:
 *
 *   ACTNG_RUN_EVALS=1 npm run eval:advisor -- [--id <id>]
 *
 * Asserts tool SELECTION, not prose. The eval loop itself is
 * @actuarial-ts/agents' runToolSelectionEvals (dogfooding the packaged
 * harness); this script owns only the environment: scratch data dir,
 * seeded book, baseline selections and analysis, and the case table.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

if (process.env.ACTNG_RUN_EVALS !== "1") {
  console.log("Skipped: set ACTNG_RUN_EVALS=1 to run (live API cost).");
  process.exit(0);
}
process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-eval-"));

const { RequestContext } = await import("@mastra/core/request-context");
const { runToolSelectionEvals } = await import("@actuarial-ts/agents");
const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
const synthetic = await import("../src/seed/synthetic.js");
const { advisorAgent } = await import("../src/mastra/index.js");

const project = repo.createProject("Eval book", "");
const { claims, exposures } = synthetic.generateSyntheticLossRun({
  seed: 7,
  nYears: 6,
  startYear: 2020,
  asOfDate: "2025-12-31",
});
repo.insertClaims(project.id, claims);
repo.replaceExposures(project.id, exposures);
const view = ws.getWorkspaceView(project.id);
const allWtd = (b: "paid" | "incurred") =>
  view.factors[b].averages.find((a) => a.spec.key === "all-wtd")!.values;
ws.patchWorkspace(project.id, { selections: { basis: "paid", selected: allWtd("paid") } });
ws.patchWorkspace(project.id, { selections: { basis: "incurred", selected: allWtd("incurred") } });
ws.runFullAnalysis(project.id, "eval base");

interface GoldenCase {
  id: string;
  prompt: string;
  expectTools: string[];
}

const CASES: GoldenCase[] = [
  {
    id: "cap-evidence",
    prompt: "Should we develop this book on a capped layer? Look at the claim-size evidence first.",
    expectTools: ["analyze_claim_sizes"],
  },
  {
    id: "cap-apply",
    prompt: "Cap losses at 150,000 per occurrence indexed 4% a year and switch to the capped layer.",
    expectTools: ["set_loss_cap"],
  },
  {
    id: "severity-fit",
    prompt: "Fit severity curves to our own claims and tell me whether either is usable for restoration.",
    expectTools: ["fit_severity_curves"],
  },
  {
    id: "trend-analyze",
    prompt: "What severity trend does this book show? Check the fits before you answer.",
    expectTools: ["analyze_trends"],
  },
  {
    id: "trend-select",
    prompt: "Select a 6% severity trend and a flat frequency trend on the unlimited layer.",
    expectTools: ["set_trend_selections"],
  },
  {
    id: "rate-history",
    prompt: "Record a +5% rate change effective 2023-01-01 and +3% effective 2024-07-01.",
    expectTools: ["set_rate_history"],
  },
  {
    id: "elr-compile",
    prompt: "Show me the expected loss ratio exhibit and how it compares to the Cape Cod cross-check.",
    expectTools: ["analyze_elr"],
  },
  {
    id: "elr-select",
    prompt: "Select an expected loss ratio of 65% for the BF methods.",
    expectTools: ["set_elr"],
  },
  {
    id: "derive-guided",
    prompt: "Walk me through deriving an expected loss ratio end to end, step by step, with your recommendations at each judgment.",
    expectTools: ["derive_expected_losses"],
  },
  {
    id: "weights-new-methods",
    prompt: "Put full weight on Cape Cod incurred for 2024 in the selection exhibit.",
    expectTools: ["set_ultimate_selection"],
  },
];

const only = process.argv.includes("--id")
  ? process.argv[process.argv.indexOf("--id") + 1]
  : null;
const cases = only ? CASES.filter((c) => c.id === only) : CASES;
if (cases.length === 0) {
  console.error(`No case with id "${only}"`);
  process.exit(1);
}

const requestContext = new RequestContext();
requestContext.set("projectId", project.id);

const report = await runToolSelectionEvals({
  agent: advisorAgent,
  cases,
  requestContext,
  maxSteps: 8,
  timeoutMs: 180_000,
  memoryFor: (c) => ({ thread: `eval-${c.id}`, resource: project.id }),
});

for (const r of report.results) {
  if (r.pass) {
    console.log(`PASS ${r.id} (called: ${r.called.join(", ")})`);
  } else if (r.error) {
    console.log(`FAIL ${r.id}: stream error ${r.error}`);
  } else {
    console.log(
      `FAIL ${r.id}: missing ${r.missing.join(", ")} (called: ${r.called.join(", ") || "none"})`,
    );
  }
}
console.log(`\n${report.summary.passed} passed, ${report.summary.failed} failed`);
process.exit(report.summary.failed > 0 ? 1 : 0);
