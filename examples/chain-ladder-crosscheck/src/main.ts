/**
 * The interop proof: ONE triangle document, THREE engines computing live —
 * @actuarial-ts/core in-process, chainladder-python over the sidecar, and R
 * ChainLadder via Rscript — then the referee, pairwise. All three results
 * must carry the same appliesTo tags and agree under deterministic-cl.
 *
 * Nothing here reads a committed result fixture: a capstone that compared
 * fixtures would be comparing this repo to itself.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
  crosscheck,
  parseDocument,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
  type MethodResultDoc,
} from "@actuarial-ts/interchange";
import { callRemoteMethod } from "@actuarial-ts/agents";
import { rscriptAvailable, runRscript } from "./rscript.js";

/** Taylor & Ashe (1983), as published in Mack (1993) Table 1. */
const TAYLOR_ASHE: (number | null)[][] = [
  [357848, 1124788, 1735330, 2218270, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
  [352118, 1236139, 2170033, 3353322, 3799067, 4120063, 4647867, 4914039, 5339085, null],
  [290507, 1292306, 2218525, 3235179, 3985995, 4132918, 4628910, 4909315, null, null],
  [310608, 1418858, 2195047, 3757447, 4029929, 4381982, 4588268, null, null, null],
  [443160, 1136350, 2128333, 2897821, 3402672, 3873311, null, null, null, null],
  [396132, 1333217, 2180715, 2985752, 3691712, null, null, null, null, null],
  [440832, 1288463, 2419861, 3483130, null, null, null, null, null, null],
  [359480, 1421128, 2864498, null, null, null, null, null, null, null],
  [376686, 1363294, null, null, null, null, null, null, null, null],
  [344014, null, null, null, null, null, null, null, null, null],
];
const ORIGINS = ["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010"];
const AGES = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];

/** Purity rule: no module in the SDK reads a clock; neither does this example. */
const CREATED_AT = "2026-07-19T00:00:00Z";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUN_MACK = join(REPO_ROOT, "tools", "interop", "run-mack.R");

export interface PairVerdict {
  pair: "ts-vs-python" | "ts-vs-r" | "python-vs-r";
  verdict: string;
  centralComparedCells: number;
}
export interface CapstoneOutcome {
  triangleIntegrity: string;
  sameAppliesTo: boolean;
  pairs: PairVerdict[];
}

export async function runCapstone(): Promise<CapstoneOutcome> {
  const sidecarUrl = process.env.SIDECAR_URL;
  const sidecarToken = process.env.SIDECAR_TOKEN;
  if (!sidecarUrl || !sidecarToken || !rscriptAvailable()) {
    console.error(
      "chain-ladder-crosscheck needs a live sidecar AND Rscript:\n" +
        "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar\n" +
        "  brew install r    # then tools/interop/README.md",
    );
    process.exit(2);
  }

  const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);
  const factors = computeDevelopmentFactors(triangle);
  const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected an all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };
  const triangleDoc = triangleToDoc(triangle, { createdAt: CREATED_AT, valuationDate: "2010-12-31" });
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;

  // Engine 1 — TypeScript, in-process.
  const tsDoc = resultToDoc(runChainLadder(triangle, selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });

  // Engine 2 — chainladder-python, over the sidecar (replays the intent).
  const remote = await callRemoteMethod(
    { sidecarUrl, method: "Chainladder", headers: { authorization: `Bearer ${sidecarToken}` }, timeoutMs: 120_000 },
    { triangles: { primary: triangleDoc }, selection: selectionDoc },
  );
  if (!remote.success) throw new Error(`sidecar: ${remote.error.code}: ${remote.error.message}`);
  const pyDoc = remote.doc as MethodResultDoc;

  // Engine 3 — R ChainLadder, via Rscript (recomputes the same intent natively).
  const dir = mkdtempSync(join(tmpdir(), "cl-capstone-"));
  let rDoc: MethodResultDoc;
  try {
    writeFileSync(join(dir, "triangle.json"), JSON.stringify(triangleDoc));
    writeFileSync(join(dir, "selection.json"), JSON.stringify(selectionDoc));
    const ran = await runRscript(RUN_MACK, [
      "--in", join(dir, "triangle.json"),
      "--selection", join(dir, "selection.json"),
      "--out", join(dir, "result.json"),
      "--created-at", CREATED_AT,
      "--profile", "deterministic-cl",
    ]);
    if (!ran.ok) throw new Error(`Rscript: ${ran.code}: ${ran.message}`);
    rDoc = parseDocument(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")), {
      strictness: "refuse",
    }).doc as MethodResultDoc;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The referee, pairwise. `coverage` is a passthrough field on the report
  // body (not in the typed schema at 0.3.0), hence the structural cast.
  const referee = (pair: PairVerdict["pair"], a: MethodResultDoc, b: MethodResultDoc): PairVerdict => {
    const report = crosscheck({ a, b, selection: selectionDoc, createdAt: CREATED_AT });
    const coverage = (report.report as unknown as {
      coverage?: { central?: { comparedCells?: number } };
    }).coverage;
    return {
      pair,
      verdict: report.report.verdict,
      centralComparedCells: coverage?.central?.comparedCells ?? 0,
    };
  };
  const pairs = [
    referee("ts-vs-python", tsDoc, pyDoc),
    referee("ts-vs-r", tsDoc, rDoc),
    referee("python-vs-r", pyDoc, rDoc),
  ];

  // Compare the two tags field-wise, not via JSON.stringify: R and Python may
  // serialize appliesTo's keys in a different order than TypeScript does.
  const tagOf = (d: MethodResultDoc) => {
    const to = (d as unknown as {
      result: { appliesTo: { triangleIntegrity: string; selectionIntegrity: string | null } };
    }).result.appliesTo;
    return `${to.triangleIntegrity}/${to.selectionIntegrity ?? "-"}`;
  };
  const sameAppliesTo = tagOf(tsDoc) === tagOf(pyDoc) && tagOf(pyDoc) === tagOf(rDoc);

  return { triangleIntegrity: triangleDoc.integrity, sameAppliesTo, pairs };
}

/* c8 ignore start */
if (process.argv[1]?.endsWith("main.ts")) {
  const out = await runCapstone();
  console.log("Taylor & Ashe — one triangle, three engines, one referee\n");
  for (const p of out.pairs) {
    console.log(`  ${p.pair.padEnd(14)} ${p.verdict}  (central cells compared: ${p.centralComparedCells})`);
  }
  console.log(`  same appliesTo ${out.sameAppliesTo}`);
}
/* c8 ignore stop */
