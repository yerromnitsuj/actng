/**
 * A complete reserve review in one file, exercising four of the five packages.
 *
 * (@actuarial-ts/agents is not here: it needs a Mastra host, which would make
 * this an application rather than an example. Its tenant seam has its own
 * tests.)
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
 *   5. REPLAY the recorded selection intent and referee the recomputation
 *   6. review the data, record an assumption ledger, generate a disclosure
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
  docToSelections,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
} from "@actuarial-ts/interchange";
import {
  createBundle,
  createLedger,
  generateDisclosure,
  recordAssumption,
  verifyBundle,
} from "@actuarial-ts/compliance";
import { reviewTriangles } from "@actuarial-ts/data";

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
  dataChecksRun: number;
  /** Every column re-derived from the recorded intent, not from stored values. */
  selectionReplayed: boolean;
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

  // 5. The referee, over a genuine REPLAY.
  //
  //    The point of the interchange format is that a selection travels as
  //    INTENT ("all-wtd"), not just as numbers. So the comparison has to go
  //    back through the document: docToSelections re-derives the factors from
  //    the recorded intent against the triangle, and the chain ladder is run
  //    from THOSE. Calling runChainLadder twice with the same arguments would
  //    prove nothing — it is a pure function, so `agree` would be guaranteed
  //    by referential transparency rather than by the replay working.
  const replay = docToSelections(selectionDoc, { triangleDoc, strictness: "refuse" });
  const replayed = resultToDoc(runChainLadder(triangle, replay.selections), {
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

  // 6. The compliance layer: an ASOP 23 data review, an assumption ledger that
  //    separates machine defaults from judgment, and the ASOP 41 disclosure
  //    rendered from both.
  const dataReview = reviewTriangles(triangle, triangle);

  const ledger = recordAssumption(
    recordAssumption(createLedger(), {
      timestamp: CREATED_AT,
      actor: "default",
      field: "chainLadder.averages",
      value: "all-wtd",
    }),
    {
      timestamp: CREATED_AT,
      actor: "actuary",
      field: "chainLadder.tailFactor",
      value: 1,
      source: "Taylor & Ashe (1983) develops to ultimate at 120 months",
      rationale: "The triangle is fully developed at the last age, so no tail is applied.",
    },
  );

  const disclosure = generateDisclosure({
    title: "Taylor & Ashe — unpaid claim estimate",
    metadata: {
      intendedPurpose: "worked example accompanying the actuarial-ts SDK",
      intendedMeasure: { kind: "central-estimate" },
      basis: { grossNet: "gross", laeTreatment: "excluding-lae" },
      accountingDate: "2010-12-31",
      valuationDate: "2010-12-31",
    },
    methods: [
      { methodId: "chainLadder", basisLabel: "paid", parameters: { selections: "all-wtd", tailFactor: 1 } },
      { methodId: "mack", basisLabel: "paid" },
    ],
    ledger,
    dataReview,
    sdkVersion: "0.3.0",
    generatedAt: CREATED_AT,
  });

  // 7. A reproducibility bundle over the inputs, parameters and results, then
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
    sdkVersions: { "@actuarial-ts/core": "0.3.0", "@actuarial-ts/compliance": "0.3.0" },
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
    // Computed, not asserted: the judgment entry must actually reach the
    // rendered document. A hardcoded `true` here would have been the same
    // class of mistake as the referee comparing a document to itself.
    disclosureIncludesLedger: disclosure.includes("chainLadder.tailFactor"),
    dataChecksRun: dataReview.checks.length,
    selectionReplayed: replay.averageKeys.every((k) => k === "all-wtd"),
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
