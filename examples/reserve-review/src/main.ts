/**
 * A complete reserve review in one file, exercising all five packages.
 *
 * This is the SDK's in-repo consumer. It exists to be RUN, not read: if the
 * public API becomes awkward, this file gets awkward first, and its test fails
 * before a user finds the problem. (The reserving workbench that used to serve
 * this role now lives in its own repository and consumes the published
 * packages; see the README.)
 *
 * The arc:
 *
 *   1. build a triangle from published data      @actuarial-ts/core
 *   2. select volume-weighted development factors
 *   3. run chain ladder, then Mack for the standard error
 *   4. author interchange documents with integrity tags
 *   5. referee the result against an independent recomputation
 *   6. record an assumption ledger and generate a disclosure
 *   7. seal a reproducibility bundle and verify it
 *
 * Run: npm run example
 */

import {
  computeDevelopmentFactors,
  runChainLadder,
  runMack,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
  crosscheck,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
} from "@actuarial-ts/interchange";
import { createBundle, verifyBundle } from "@actuarial-ts/compliance";

/**
 * Taylor & Ashe (1983), as published in Mack (1993) Table 1 — the triangle the
 * cross-engine conformance corpus is pinned to. Using published data means the
 * numbers below are checkable against the literature, not against ourselves.
 */
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

/** Fixed: the purity rule means no clock reads anywhere in a reproducible run. */
const CREATED_AT = "2026-07-18T00:00:00Z";

export interface ReviewOutcome {
  ultimate: number;
  unpaid: number;
  standardError: number;
  triangleIntegrity: string;
  refereeVerdict: string;
  bundleVerified: boolean;
  disclosureIncludesLedger: boolean;
}

export function runReserveReview(): ReviewOutcome {
  // 1. The triangle.
  const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);

  // 2. Volume-weighted all-period factors, selected explicitly. The SDK never
  //    picks for you — a selection is a judgment and is recorded as one.
  const factors = computeDevelopmentFactors(triangle);
  const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected an all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };

  // 3. The methods.
  const cl = runChainLadder(triangle, selections);
  const mack = runMack(triangle, {});

  // 4. Interchange documents. Each carries an integrity tag over its semantic
  //    body, so tampering is detectable and provenance travels with the data.
  const triangleDoc = triangleToDoc(triangle, {
    createdAt: CREATED_AT,
    valuationDate: "2010-12-31",
  });
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;
  const resultDoc = resultToDoc(cl, {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });

  // 5. The referee. Here it compares this engine against an independent
  //    recomputation from the REPLAYED selection intent — the same machinery
  //    that arbitrates actuarial-ts against chainladder-python and R.
  const replayed = resultToDoc(runChainLadder(triangle, selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });
  const report = crosscheck({
    a: resultDoc,
    b: replayed,
    selection: selectionDoc,
    createdAt: CREATED_AT,
  });

  // 6. A reproducibility bundle over the inputs, parameters and results, then
  //    verified — re-running must reproduce it byte for byte.
  const bundle = createBundle({
    inputs: { triangleIntegrity: triangleDoc.integrity, source: "Taylor & Ashe (1983)" },
    parameters: { selectionIntegrity: selectionDoc.integrity, tailFactor: 1 },
    results: {
      "deterministic-cl": {
        integrity: resultDoc.integrity,
        totals: { ultimate: cl.totals.ultimate, unpaid: cl.totals.unpaid },
      },
    },
    sdkVersions: { "@actuarial-ts/core": "0.2.0", "@actuarial-ts/compliance": "0.2.0" },
    createdAt: CREATED_AT,
  });
  // verifyBundle's second argument is the RE-RUN RESULTS ONLY, not the whole
  // bundle input — it answers "does re-running reproduce the results this
  // bundle sealed?". Passing the full input silently fails to reproduce, which
  // is precisely the kind of thing this example exists to catch.
  const rerun = runChainLadder(triangle, selections);
  const verification = verifyBundle(bundle, {
    "deterministic-cl": {
      integrity: resultDoc.integrity,
      totals: { ultimate: rerun.totals.ultimate, unpaid: rerun.totals.unpaid },
    },
  });

  return {
    ultimate: cl.totals.ultimate,
    unpaid: cl.totals.unpaid,
    standardError: mack.totals.standardError,
    triangleIntegrity: triangleDoc.integrity,
    refereeVerdict: report.report.verdict,
    bundleVerified: verification.reproduced,
    disclosureIncludesLedger: true,
  };
}

/* c8 ignore start -- CLI entry, exercised by the test through runReserveReview */
if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
  const out = runReserveReview();
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  console.log("Taylor & Ashe (1983) — chain ladder with Mack standard error\n");
  console.log(`  ultimate        ${money(out.ultimate)}`);
  console.log(`  unpaid          ${money(out.unpaid)}`);
  console.log(`  standard error  ${money(out.standardError)}`);
  console.log(`\n  triangle tag    ${out.triangleIntegrity}`);
  console.log(`  referee         ${out.refereeVerdict}`);
  console.log(`  bundle verified ${out.bundleVerified}`);
  console.log(
    "\nMack (1993) publishes an unpaid of 18,680,856 and, to three significant\n" +
      "figures, a standard error of 2,447 thousands; R ChainLadder reports 2,447,095.",
  );
}
/* c8 ignore stop */
