/**
 * A real-world loss-development example over CASdatasets'
 * `freclaimset2motor` experience.
 *
 * The committed inputs are compact, deterministic derivatives of the pinned
 * million-row source. `npm run data:refresh` verifies and transforms the full
 * file; ordinary installs and tests remain small and offline.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  computeDevelopmentFactors,
  runCapeCod,
  runChainLadder,
  type LdfSelections,
  type Triangle,
  type TriangleKind,
} from "@actuarial-ts/core";
import {
  parseCsv,
  parseExposureCsv,
  reviewTriangles,
  triangleFromLongFormat,
  type DataCheck,
  type DataReviewReport,
  type LongFormatRow,
} from "@actuarial-ts/data";
import {
  createLedger,
  generateDisclosure,
  recordAssumption,
  type AssumptionLedger,
} from "@actuarial-ts/compliance";
import { SOURCE } from "./sourceManifest.js";

export { SOURCE } from "./sourceManifest.js";

const GENERATED_AT = "2026-07-23T00:00:00Z";
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number);
const longRowSchema = z
  .object({
    origin: z.string().regex(/^\d{4}$/),
    age: decimalString.pipe(z.number().int().positive()),
    value: decimalString.pipe(z.number().finite()),
  })
  .strict();
const qualitySchema = z
  .object({
    source_claim_rows: z.number().int().positive(),
    distinct_claim_ids: z.number().int().positive(),
    source_first_development_claim_count: z.number().int().positive(),
    claim_id_collisions_at_first_development: z.number().int().nonnegative(),
    first_evaluation_after_origin: z.number().int().nonnegative(),
    duplicate_claim_year_groups: z.number().int().nonnegative(),
    rows_in_duplicate_claim_year_groups: z.number().int().nonnegative(),
    exact_duplicate_extra_rows: z.number().int().nonnegative(),
    claims_with_multiple_evaluations: z.number().int().nonnegative(),
    maximum_evaluations_per_claim: z.number().int().positive(),
    annual_gap_transitions: z.number().int().nonnegative(),
    paid_decrease_transitions: z.number().int().nonnegative(),
    recourse_decrease_transitions: z.number().int().nonnegative(),
    negative_gross_case_records: z.number().int().nonnegative(),
    negative_net_case_records: z.number().int().nonnegative(),
    closed_with_positive_gross_case_records: z.number().int().nonnegative(),
  })
  .strict();

export type SourceQuality = z.infer<typeof qualitySchema>;
export type LossBasis = "gross" | "net";

function dataFile(name: string): string {
  return readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8");
}

function recordsFromCsv(text: string, expectedHeaders: readonly string[]): Record<string, string>[] {
  const parsed = parseCsv(text);
  if (parsed.warnings.length > 0) {
    throw new Error(`Generated CSV is structurally invalid: ${parsed.warnings.join("; ")}`);
  }
  const headers = parsed.rows[0] ?? [];
  if (
    headers.length !== expectedHeaders.length ||
    !headers.every((header, index) => header === expectedHeaders[index])
  ) {
    throw new Error(
      `Generated CSV headers must be ${expectedHeaders.join(",")} (got ${headers.join(",")})`,
    );
  }
  return parsed.rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
}

function loadTriangle(filename: string, kind: TriangleKind): Triangle {
  const rows: LongFormatRow[] = recordsFromCsv(dataFile(filename), ["origin", "age", "value"]).map(
    (record) => longRowSchema.parse(record),
  );
  return triangleFromLongFormat(rows, { kind });
}

function loadQuality(): SourceQuality {
  const entries = recordsFromCsv(dataFile("quality-summary.csv"), ["metric", "value"]).map(
    (record) => [record.metric, decimalString.parse(record.value)] as const,
  );
  return qualitySchema.parse(Object.fromEntries(entries));
}

function allWeightedSelections(triangle: Triangle): LdfSelections {
  const average = computeDevelopmentFactors(triangle).averages.find(
    (candidate) => candidate.spec.key === "all-wtd",
  );
  if (average === undefined || average.values.some((value) => value === null)) {
    throw new Error(`A complete all-year volume-weighted selection is unavailable for ${triangle.kind}`);
  }
  return { selected: [...average.values], tailFactor: 1 };
}

function summarize(checks: DataCheck[]): DataReviewReport["summary"] {
  const summary = { pass: 0, warning: 0, fail: 0, notEvaluated: 0 };
  for (const check of checks) {
    if (check.status === "not-evaluated") summary.notEvaluated += 1;
    else summary[check.status] += 1;
  }
  return summary;
}

function sourceQualityChecks(quality: SourceQuality, basis: LossBasis): DataCheck[] {
  const negativeCase =
    basis === "net" ? quality.negative_net_case_records : quality.negative_gross_case_records;
  return [
    {
      id: "source-integrity",
      description: "The source archive is pinned and checksum-verified",
      status: "pass",
      details: [`SHA-256 ${SOURCE.sourceSha256}`],
    },
    {
      id: "annual-date-precision",
      description: "Source dates have annual rather than exact-date precision",
      status: "warning",
      details: [
        `${quality.source_claim_rows} rows carry occurrence and management years only; exact dates must be disclosed as derived`,
        `${quality.first_evaluation_after_origin} IDs first appear after origin and ${quality.annual_gap_transitions} timelines skip at least one annual evaluation`,
      ],
    },
    {
      id: "claim-id-uniqueness",
      description: "Claim identifiers uniquely represent source claims",
      status: "warning",
      details: [
        `${quality.claim_id_collisions_at_first_development} identifier collisions at first development; source ClaimNb is retained for frequency`,
      ],
    },
    {
      id: "duplicate-annual-snapshot",
      description: "No claim has multiple source rows in one management year",
      status: quality.duplicate_claim_year_groups > 0 ? "warning" : "pass",
      details:
        quality.duplicate_claim_year_groups > 0
          ? [
              `${quality.duplicate_claim_year_groups} groups across ${quality.rows_in_duplicate_claim_year_groups} rows; dollar streams were combined`,
              `${quality.exact_duplicate_extra_rows} source rows are exact duplicates, but remain rows under the selected combine policy`,
            ]
          : [],
    },
    {
      id: "source-paid-decreasing",
      description: "Combined cumulative paid does not decrease between annual evaluations",
      status: quality.paid_decrease_transitions > 0 ? "warning" : "pass",
      details:
        quality.paid_decrease_transitions > 0
          ? [
              `${quality.paid_decrease_transitions} decreasing-paid transitions retained`,
              `${quality.recourse_decrease_transitions} decreasing-recourse transitions retained`,
            ]
          : [],
    },
    {
      id: "source-negative-case",
      description: `Inferred ${basis} case reserve is non-negative`,
      status: negativeCase > 0 ? "warning" : "pass",
      details:
        negativeCase > 0
          ? [
              `${negativeCase} annual records have negative inferred case`,
              `${quality.closed_with_positive_gross_case_records} closed annual records have positive inferred gross case`,
            ]
          : [],
    },
    {
      id: "exposure-semantics",
      description: "Insurance-year exposure is kept distinct from gross written premium",
      status: "pass",
      details: ["GWP is retained in the source CSV and is not loaded as earned premium"],
    },
  ];
}

function combinedReview(
  paid: Triangle,
  incurred: Triangle,
  quality: SourceQuality,
  basis: LossBasis,
): DataReviewReport {
  const triangleReview = reviewTriangles(paid, incurred);
  const checks = [...sourceQualityChecks(quality, basis), ...triangleReview.checks];
  return { checks, summary: summarize(checks) };
}

function buildLedger(basis: LossBasis): AssumptionLedger {
  const entries = [
    {
      field: "source.expectChargeInterpretation",
      value: "gross cumulative incurred",
      source: "CASdatasets freclaimset2motor documentation",
      rationale:
        "ExpectCharge behaves as an incurred measure, but the source labels it only as expected amount; the interpretation is therefore recorded explicitly.",
    },
    {
      field: "source.lossBasis",
      value: basis,
      source: "PaidAmount, RecourseAmount, ExpectCharge, ExpectRecourse",
      rationale:
        basis === "net"
          ? "Net of recoveries was selected to demonstrate the source's salvage/subrogation information."
          : "Gross was selected to show losses before the source's recovery measures.",
    },
    {
      field: "source.dateConvention",
      value: "annual precision; calendar-year-end when ClaimSnapshot dates are required",
      source: "OccurYear and ManagYear",
      rationale: "The source supplies years only, so no false day-level precision is asserted.",
    },
    {
      field: "source.duplicatePolicy",
      value: "combine same-ID/same-year dollar streams; retain source ClaimNb for frequency",
      source: "quality-summary.csv",
      rationale:
        "The source identifier cannot distinguish the colliding records; summing preserves aggregate dollars while source ClaimNb preserves frequency.",
    },
    {
      field: "source.exposureBasis",
      value: "insurance-years",
      source: "aggdata.Exposure",
      rationale:
        "The available premium is gross written, not earned; insurance-years support a pure-premium method without relabeling GWP.",
    },
    {
      field: "development.average",
      value: "all-wtd",
      source: "illustrative example selection",
      rationale:
        "The example uses the full-volume weighted indication mechanically; a production analysis must review and select each factor.",
    },
    {
      field: "development.tailFactor",
      value: 1,
      source: "illustrative example selection",
      rationale:
        "No external tail study is supplied; the example stops at the observed 240-month development horizon.",
    },
  ] as const;
  return entries.reduce(
    (ledger, entry, index) =>
      recordAssumption(ledger, {
        timestamp: `2026-07-23T00:00:0${index + 1}Z`,
        actor: "actuary",
        ...entry,
      }),
    createLedger(),
  );
}

const optionsSchema = z.object({ basis: z.enum(["gross", "net"]).default("net") }).strict();

export interface RealWorldReviewOptions {
  basis?: LossBasis;
}

export interface RealWorldReviewOutcome {
  basis: LossBasis;
  source: typeof SOURCE;
  quality: SourceQuality;
  exposureYears: number;
  totalExposureUnits: number;
  earnedPremiumRows: number;
  triangleCellsPerBasis: number;
  selectedLdfs: number;
  paid: { latest: number; ultimate: number; unpaid: number };
  incurred: { latest: number; ultimate: number; unpaid: number };
  capeCod: { expectedPurePremium: number; ultimate: number; ibnr: number };
  dataReview: DataReviewReport;
  disclosure: string;
}

export function runRealWorldLossRunReview(
  input: RealWorldReviewOptions = {},
): RealWorldReviewOutcome {
  const { basis } = optionsSchema.parse(input);
  const paid = loadTriangle(`${basis}-paid.csv`, "paid");
  const incurred = loadTriangle(`${basis}-incurred.csv`, "incurred");
  const quality = loadQuality();

  const exposureResult = parseExposureCsv(dataFile("exposures.csv"));
  if (exposureResult.errors.length > 0) {
    throw new Error(
      `Generated exposure data failed validation: ${exposureResult.errors
        .map((error) => `line ${error.row}: ${error.message}`)
        .join("; ")}`,
    );
  }
  const exposures = exposureResult.exposures;
  const exposureByOrigin = new Map(exposures.map((record) => [record.origin, record]));

  const paidSelections = allWeightedSelections(paid);
  const incurredSelections = allWeightedSelections(incurred);
  const paidResult = runChainLadder(paid, paidSelections);
  const incurredResult = runChainLadder(incurred, incurredSelections);
  const capeCod = runCapeCod(
    incurredResult.rows.map((row) => {
      const exposure = exposureByOrigin.get(row.origin)?.exposureUnits;
      if (exposure === null || exposure === undefined) {
        throw new Error(`No insurance-year exposure for origin ${row.origin}`);
      }
      return { origin: row.origin, reported: row.latestValue, cdf: row.cdf, premium: exposure };
    }),
    { baseIsPurePremium: true },
  );
  const dataReview = combinedReview(paid, incurred, quality, basis);
  const ledger = buildLedger(basis);
  const disclosure = generateDisclosure({
    title: `Real-world French motor reserve illustration — ${basis} basis`,
    metadata: {
      intendedPurpose:
        "reproducible SDK example demonstrating data review, explicit source interpretation, development methods, and exposure-based methods",
      intendedUsers: ["actuarial-ts SDK evaluators and contributors"],
      intendedMeasure: { kind: "central-estimate" },
      basis: {
        grossNet: basis === "net" ? "net-of-salvage-subro" : "gross",
        laeTreatment: "excluding-lae",
      },
      accountingDate: "2014-12-31",
      valuationDate: "2014-12-31",
      currency: "EUR",
      scopeNotes:
        "Anonymous French motor damage-guarantee experience; cumulative claim amounts and insurance-year exposure, excluding any unprovided loss adjustment expense measure.",
    },
    methods: [
      {
        methodId: "chainLadder",
        basisLabel: `${basis} paid`,
        parameters: { average: "all-wtd", tailFactor: 1 },
        resultSummary: paidResult.totals,
      },
      {
        methodId: "chainLadder",
        basisLabel: `${basis} incurred`,
        parameters: { average: "all-wtd", tailFactor: 1 },
        resultSummary: incurredResult.totals,
      },
      {
        methodId: "capeCod",
        basisLabel: `${basis} incurred per insurance-year exposure`,
        parameters: { base: "insurance-years", baseIsPurePremium: true, decay: 1 },
        resultSummary: {
          ultimate: capeCod.totals.ultimate,
          ibnr: capeCod.totals.ultimate - capeCod.totals.reported,
        },
      },
    ],
    ledger,
    dataReview,
    reliances: [
      `CASdatasets authors and archive for source provenance (${SOURCE.doi})`,
      `Pinned source integrity ${SOURCE.sourceSha256}`,
    ],
    limitations: [
      "The insurer is anonymous, so real-world provenance is author-attested rather than independently carrier-verifiable.",
      "The source has annual precision only; calendar-year-end dates are a disclosed compatibility convention.",
      "ExpectCharge is interpreted as cumulative incurred from a source label of expected amount.",
      "Claim identifiers contain collisions; compact dollar triangles combine those streams and frequency relies on source ClaimNb.",
      "Gross written premium is retained but is not used as earned premium; Cape Cod uses insurance-year exposure as a pure-premium base.",
      "The all-year volume-weighted factors and 1.0 tail are illustrative selections, not conclusions for production use.",
    ],
    sdkVersion: "0.5.0",
    generatedAt: GENERATED_AT,
  });

  return {
    basis,
    source: SOURCE,
    quality,
    exposureYears: exposures.length,
    totalExposureUnits: exposures.reduce((sum, record) => sum + (record.exposureUnits ?? 0), 0),
    earnedPremiumRows: exposures.filter((record) => record.earnedPremium !== null).length,
    triangleCellsPerBasis: paid.values.flat().filter((value) => value !== null).length,
    selectedLdfs: paidSelections.selected.length + incurredSelections.selected.length,
    paid: paidResult.totals,
    incurred: incurredResult.totals,
    capeCod: {
      expectedPurePremium: capeCod.elrAtTargetLevel,
      ultimate: capeCod.totals.ultimate,
      ibnr: capeCod.totals.ultimate - capeCod.totals.reported,
    },
    dataReview,
    disclosure,
  };
}

/* c8 ignore start -- CLI entry; the tested function above owns the behavior. */
if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
  const outcome = runRealWorldLossRunReview();
  const money = (value: number) =>
    value.toLocaleString("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  console.log("CASdatasets freclaimset2motor — real-world net motor development\n");
  console.log(`  source rows          ${outcome.quality.source_claim_rows.toLocaleString("en-US")}`);
  console.log(`  insurance-years      ${outcome.totalExposureUnits.toLocaleString("en-US")}`);
  console.log(`  paid CL unpaid       ${money(outcome.paid.unpaid)}`);
  console.log(`  incurred CL IBNR     ${money(outcome.incurred.unpaid)}`);
  console.log(`  Cape Cod IBNR        ${money(outcome.capeCod.ibnr)}`);
  console.log(
    `  data review          ${outcome.dataReview.summary.pass} pass / ${outcome.dataReview.summary.warning} warning / ${outcome.dataReview.summary.fail} fail`,
  );
  console.log("\nReview findings are retained, not silently cleaned. See SOURCE.md and DATA-NOTICE.md.");
}
/* c8 ignore stop */
