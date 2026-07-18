/**
 * crosscheck-ci (interchange spec rev 2.1, section 5 "CI mode"): the live
 * cross-engine referee. For EVERY committed conformance fixture and both
 * deterministic convention profiles, the committed TS-authored result
 * document is refereed against a LIVE chainladder-python sidecar run of the
 * same computation:
 *
 * - deterministic-cl: the sidecar replays the committed SelectionDoc through
 *   Chainladder on the committed TriangleDoc;
 * - mack1993-vw: the sidecar runs MackChainladder with
 *   sigma_interpolation="mack" pinned (volume-weighted all-period factors,
 *   the profile's requirements) — no selection, exactly like the committed
 *   TS runMack document.
 *
 * The referee is `crosscheck` — deterministic, not an agent — and the exit
 * code is the contract: any `disagree` or `not-comparable` verdict fails the
 * run (and therefore the CI job). Requires a booted sidecar:
 *
 *   SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=... npm run crosscheck:ci
 *
 * (Boot: PYTHONPATH=interop SIDECAR_TOKEN=... .venv-interop/bin/python -m sidecar)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  crosscheck,
  parseDocument,
  type CrosscheckReportDoc,
  type MethodResultDoc,
  type SelectionDoc,
} from "../../packages/interchange/src/index.js";
import { callRemoteMethod } from "../../packages/agents/src/remote.js";
import { CONFORMANCE_FIXTURES } from "./ts/fixtures.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const sidecarUrl = process.env.SIDECAR_URL;
const sidecarToken = process.env.SIDECAR_TOKEN;
if (!sidecarUrl || !sidecarToken) {
  console.error(
    "crosscheck-ci needs a live sidecar: set SIDECAR_URL and SIDECAR_TOKEN " +
      "(boot one with: PYTHONPATH=interop SIDECAR_TOKEN=... .venv-interop/bin/python -m sidecar)",
  );
  process.exit(2);
}

const call = {
  sidecarUrl,
  headers: { authorization: `Bearer ${sidecarToken}` },
  timeoutMs: 120_000,
};

function readJson(fixture: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fixture, file), "utf8"));
}

interface Row {
  fixture: string;
  profile: "deterministic-cl" | "mack1993-vw";
  verdict: string;
  maxCentral: number;
  maxStandardError: number | null;
  engines: string;
}

function maxDeviations(report: CrosscheckReportDoc): {
  maxCentral: number;
  maxStandardError: number | null;
} {
  const body = report.report;
  let maxCentral = 0;
  let maxSe: number | null = null;
  for (const row of body.deviations.perOrigin) {
    maxCentral = Math.max(maxCentral, row.ultimate ?? 0, row.unpaid ?? 0);
    if (row.standardError !== null) maxSe = Math.max(maxSe ?? 0, row.standardError);
  }
  const totals = body.deviations.totals;
  maxCentral = Math.max(maxCentral, totals.ultimate ?? 0, totals.unpaid ?? 0);
  if (totals.standardError !== null) maxSe = Math.max(maxSe ?? 0, totals.standardError);
  return { maxCentral, maxStandardError: maxSe };
}

const rows: Row[] = [];
let failed = false;

for (const fixture of CONFORMANCE_FIXTURES) {
  const triangleRaw = readJson(fixture.name, "triangle.json");
  const selectionRaw = readJson(fixture.name, "selection.json");
  const selectionDoc = parseDocument(selectionRaw).doc as SelectionDoc;
  const createdAt = new Date().toISOString();

  const legs = [
    {
      profile: "deterministic-cl" as const,
      tsDoc: parseDocument(readJson(fixture.name, "deterministic-cl.json")).doc as MethodResultDoc,
      method: "Chainladder",
      body: { triangles: { primary: triangleRaw }, selection: selectionRaw },
      selection: selectionDoc,
    },
    {
      profile: "mack1993-vw" as const,
      tsDoc: parseDocument(readJson(fixture.name, "mack1993-vw.json")).doc as MethodResultDoc,
      method: "MackChainladder",
      body: {
        triangles: { primary: triangleRaw },
        parameters: { sigma_interpolation: "mack" },
      },
      selection: undefined,
    },
  ];

  for (const leg of legs) {
    const remote = await callRemoteMethod({ ...call, method: leg.method }, leg.body);
    if (!remote.success) {
      console.error(
        `${fixture.name} ${leg.profile}: sidecar run FAILED — ${remote.error.code}: ${remote.error.message}`,
      );
      failed = true;
      rows.push({
        fixture: fixture.name,
        profile: leg.profile,
        verdict: `sidecar-error (${remote.error.code})`,
        maxCentral: NaN,
        maxStandardError: null,
        engines: "-",
      });
      continue;
    }
    const report = crosscheck({
      a: leg.tsDoc,
      b: remote.doc as MethodResultDoc,
      ...(leg.selection !== undefined ? { selection: leg.selection } : {}),
      createdAt,
    });
    const { maxCentral, maxStandardError } = maxDeviations(report);
    const verdict = report.report.verdict;
    if (verdict === "disagree" || verdict === "not-comparable") {
      failed = true;
      for (const warning of report.report.warnings) {
        console.error(`${fixture.name} ${leg.profile}: ${warning}`);
      }
    }
    const engines = report.report.engines;
    rows.push({
      fixture: fixture.name,
      profile: leg.profile,
      verdict,
      maxCentral,
      maxStandardError,
      engines: `${engines.a.name}@${engines.a.version} vs ${engines.b.name}@${engines.b.version}`,
    });
  }
}

// --- verdict table ---
const header = ["fixture", "profile", "verdict", "max central dev", "max SE dev", "engines"];
const table = rows.map((r) => [
  r.fixture,
  r.profile,
  r.verdict,
  Number.isNaN(r.maxCentral) ? "-" : r.maxCentral.toExponential(3),
  r.maxStandardError === null ? "(not compared)" : r.maxStandardError.toExponential(3),
  r.engines,
]);
const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => row[i]!.length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
console.log(line(header));
console.log(line(widths.map((w) => "-".repeat(w))));
for (const row of table) console.log(line(row));

if (failed) {
  console.error("\ncrosscheck-ci: FAIL — at least one disagree/not-comparable/sidecar-error verdict");
  process.exit(1);
}
console.log("\ncrosscheck-ci: PASS — every fixture x profile referees to agreement");
