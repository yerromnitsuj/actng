import fs from "node:fs";
import path from "node:path";
import { env } from "../env.js";
import { createProject, insertClaims, listProjects, replaceExposures } from "../db/repo.js";
import {
  ensureWorkspaceState,
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
} from "../services/workspaceService.js";
import { claimsToCsv, exposuresToCsv, generateSyntheticLossRun } from "./synthetic.js";

/**
 * Seeds the demo project and writes demo CSVs (for exercising the import
 * flow by hand). `--if-empty` makes it a no-op when projects already exist,
 * which is how `npm run dev` stays idempotent.
 */

const ifEmpty = process.argv.includes("--if-empty");

const existing = listProjects();
if (ifEmpty && existing.length > 0) {
  console.log(`[seed] ${existing.length} project(s) already present; skipping (--if-empty).`);
  process.exit(0);
}

console.log("[seed] Generating synthetic loss run...");
const { claims, exposures, config } = generateSyntheticLossRun();
console.log(
  `[seed] ${claims.length} snapshot rows across ${new Set(claims.map((c) => c.claimId)).size} claims, ${exposures.length} exposure years (seed ${config.seed}).`,
);

const project = createProject(
  "Demo: GL Occurrence (synthetic)",
  `Synthetic general liability loss run, accident years ${config.startYear}-${config.startYear + config.nYears - 1}, evaluated ${config.asOfDate}. Includes a deliberate settlement speedup and case-reserve strengthening from CY2022 for the diagnostics and Berquist-Sherman methods to detect.`,
);
insertClaims(project.id, claims);
replaceExposures(project.id, exposures);
ensureWorkspaceState(project.id);

// Give the demo a sensible starting point: volume-weighted selections and a
// unit tail, so the workspace renders a full picture immediately. The
// walkthrough still exercises changing selections and fitting tails.
const view = getWorkspaceView(project.id);
const allWtd = (basis: "paid" | "incurred") =>
  view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")?.values ?? [];
patchWorkspace(project.id, { selections: { basis: "paid", selected: allWtd("paid") } });
patchWorkspace(project.id, { selections: { basis: "incurred", selected: allWtd("incurred") } });
runFullAnalysis(project.id, "Seed baseline (all-year volume-weighted, no tail)");

fs.mkdirSync(env.demoDir, { recursive: true });
const claimsPath = path.join(env.demoDir, "demo-loss-run.csv");
const exposuresPath = path.join(env.demoDir, "demo-exposures.csv");
fs.writeFileSync(claimsPath, claimsToCsv(claims));
fs.writeFileSync(exposuresPath, exposuresToCsv(exposures));

console.log(`[seed] Demo project created: ${project.name} (${project.id})`);
console.log(`[seed] Demo CSVs written for the import flow:`);
console.log(`[seed]   ${claimsPath}`);
console.log(`[seed]   ${exposuresPath}`);
