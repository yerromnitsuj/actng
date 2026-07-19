/**
 * Chain ladder, computed IN-PROCESS by @actuarial-ts/core.
 *
 * One of three sibling examples that are deliberately line-for-line identical
 * except for the body of the `compute_chain_ladder` tool — see
 * ../chain-ladder-python and ../chain-ladder-r. Diff them: where the math runs
 * is the ONLY difference. examples/chain-ladder-crosscheck referees all three.
 */
import {
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
  crosscheck,
  docToSelections,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
} from "@actuarial-ts/interchange";

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

export interface ClExampleOutcome {
  ultimate: number;
  unpaid: number;
  triangleIntegrity: string;
  refereeVerdict: string;
  ledgerJudgments: number;
  trailActorIdentity: string | undefined;
  disclosureHasJudgmentSection: boolean;
  tenantFailClosedCode: string;
}

export async function runChainLadderTypescript(): Promise<ClExampleOutcome> {
  // 1. Triangle -> factors. The SDK never selects for you; picking "all-wtd"
  //    (volume-weighted, all periods) is a judgment, recorded as one in Task 2.
  const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);
  const factors = computeDevelopmentFactors(triangle);
  const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected an all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };

  // 2. Interchange documents. The integrity tag travels with the data; the
  //    selection travels as INTENT ("all-wtd"), not just as numbers.
  const triangleDoc = triangleToDoc(triangle, { createdAt: CREATED_AT, valuationDate: "2010-12-31" });
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;

  // 3. THE COMPUTE STEP — the only part that differs across the three examples.
  const cl = runChainLadder(triangle, selections);
  const resultDoc = resultToDoc(cl, {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });

  // 4. Referee over a genuine intent REPLAY (runChainLadder is pure — calling
  //    it twice with the same arguments would prove nothing).
  const replay = docToSelections(selectionDoc, { triangleDoc, strictness: "refuse" });
  const replayedDoc = resultToDoc(runChainLadder(triangle, replay.selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });
  const report = crosscheck({ a: resultDoc, b: replayedDoc, selection: selectionDoc, createdAt: CREATED_AT });

  return {
    ultimate: cl.totals.ultimate,
    unpaid: cl.totals.unpaid,
    triangleIntegrity: triangleDoc.integrity,
    refereeVerdict: report.report.verdict,
    ledgerJudgments: 0, // Task 2
    trailActorIdentity: undefined, // Task 2
    disclosureHasJudgmentSection: false, // Task 2
    tenantFailClosedCode: "", // Task 2
  };
}

// CLI tail (c8-fenced like reserve-review).
/* c8 ignore start */
if (process.argv[1]?.endsWith("main.ts")) {
  const out = await runChainLadderTypescript();
  console.log("Taylor & Ashe — chain ladder computed in TypeScript\n");
  console.log(`  ultimate   ${Math.round(out.ultimate).toLocaleString("en-US")}`);
  console.log(`  unpaid     ${Math.round(out.unpaid).toLocaleString("en-US")}`);
  console.log(`  referee    ${out.refereeVerdict}`);
}
/* c8 ignore stop */
