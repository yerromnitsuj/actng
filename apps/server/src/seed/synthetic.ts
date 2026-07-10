import type { ClaimSnapshot, ExposureRecord } from "@actng/core";

/**
 * Synthetic loss-run generator with a realistic claim lifecycle:
 * - claim counts driven by exposure (premium) with year-over-year growth
 * - lognormal report lags, severities with an annual trend, settlement lags
 *   that scale with severity
 * - partial payments developing over time from report to settlement
 * - case reserves set at report and revised toward the final value
 * - an open/closed mix by maturity, including claims closed without payment
 *
 * Two deliberate distortions are baked in so the diagnostics and the
 * Berquist-Sherman methods have something real to find:
 * - settlement speedup: claims handled from CY 2022 onward settle ~25% faster
 * - case-reserve strengthening: case reserves set/revised from CY 2022 onward
 *   are carried at a richer adequacy level
 *
 * Fully deterministic for a given seed.
 */

export interface SyntheticConfig {
  seed?: number;
  startYear?: number;
  nYears?: number;
  asOfDate?: string;
  basePremium?: number;
  premiumGrowth?: number;
  /** Exposure units in the start year (the pure-premium base, e.g. earned car-years). */
  baseExposureUnits?: number;
  /** Annual exposure-count growth; slower than premiumGrowth so premium carries rate on top of exposure. */
  exposureGrowth?: number;
  claimsPerMillion?: number;
  severityTrend?: number;
}

export interface SyntheticOutput {
  claims: ClaimSnapshot[];
  exposures: ExposureRecord[];
  config: Required<SyntheticConfig>;
}

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rand: () => number): () => number {
  return () => {
    // Box-Muller; guard against log(0).
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function isoFromDayOffset(year: number, dayOfYear: number): string {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + Math.min(364, Math.max(0, Math.floor(dayOfYear))));
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y! * 12 + (m! - 1)) + Math.floor(months);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d!, lastDay);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function generateSyntheticLossRun(config: SyntheticConfig = {}): SyntheticOutput {
  const cfg: Required<SyntheticConfig> = {
    seed: config.seed ?? 20260705,
    startYear: config.startYear ?? 2016,
    nYears: config.nYears ?? 10,
    asOfDate: config.asOfDate ?? "2025-12-31",
    basePremium: config.basePremium ?? 5_000_000,
    premiumGrowth: config.premiumGrowth ?? 0.05,
    baseExposureUnits: config.baseExposureUnits ?? 10_000,
    exposureGrowth: config.exposureGrowth ?? 0.02,
    claimsPerMillion: config.claimsPerMillion ?? 48,
    severityTrend: config.severityTrend ?? 0.06,
  };
  const rand = mulberry32(cfg.seed);
  const normal = makeNormal(rand);
  const lognormal = (mu: number, sigma: number) => Math.exp(mu + sigma * normal());

  const asOfYear = Number(cfg.asOfDate.slice(0, 4));
  const claims: ClaimSnapshot[] = [];
  const exposures: ExposureRecord[] = [];
  let claimSeq = 0;

  for (let yearIdx = 0; yearIdx < cfg.nYears; yearIdx++) {
    const accidentYear = cfg.startYear + yearIdx;
    const premium = Math.round(cfg.basePremium * Math.pow(1 + cfg.premiumGrowth, yearIdx));
    // Exposure units grow slower than premium: premium carries rate change on top
    // of exposure growth, so the pure-premium and loss-ratio methods differ.
    const exposureUnits = Math.round(cfg.baseExposureUnits * Math.pow(1 + cfg.exposureGrowth, yearIdx));
    exposures.push({ origin: String(accidentYear), earnedPremium: premium, exposureUnits });

    const expectedClaims = (premium / 1_000_000) * cfg.claimsPerMillion;
    // Poisson-ish count via normal approximation, floored sensibly.
    const count = Math.max(
      20,
      Math.round(expectedClaims + Math.sqrt(expectedClaims) * normal()),
    );

    for (let c = 0; c < count; c++) {
      claimSeq++;
      const claimId = `CLM-${accidentYear}-${String(claimSeq).padStart(5, "0")}`;
      const accidentDate = isoFromDayOffset(accidentYear, rand() * 365);

      // Report lag in months: lognormal, median ~1.3 months, capped at 30.
      const reportLagMonths = Math.min(30, lognormal(Math.log(1.3), 0.9));
      const reportDate = addMonthsISO(accidentDate, reportLagMonths);
      if (reportDate > cfg.asOfDate) continue; // pure IBNR: invisible to the loss run

      // Severity: lognormal with an annual trend; ~18% close with no payment.
      const closedNoPay = rand() < 0.18;
      const sevMean = 16000 * Math.pow(1 + cfg.severityTrend, yearIdx);
      const sigma = 1.35;
      const mu = Math.log(sevMean) - (sigma * sigma) / 2;
      const ultimate = closedNoPay ? 0 : Math.max(250, lognormal(mu, sigma));

      // Settlement lag from report, scaled up for severe claims.
      const sevFactor = closedNoPay ? 0.5 : Math.min(3, 0.6 + Math.log10(Math.max(ultimate, 1000) / 1000));
      let settleLagMonths = Math.min(96, lognormal(Math.log(8), 0.8) * sevFactor);
      // Settlement speedup: claim departments close files faster from CY2022 on.
      const reportYear = Number(reportDate.slice(0, 4));
      if (reportYear >= 2022) settleLagMonths *= 0.72;
      settleLagMonths = Math.max(0.5, settleLagMonths);
      const closeDate = addMonthsISO(reportDate, settleLagMonths);

      // Initial case reserve adequacy; richer from CY2022 onward.
      const caseNoise = Math.exp(0.3 * normal());

      // Year-end snapshots from the report year until close (or as-of).
      const reportYearEnd = Number(reportDate.slice(0, 4));
      for (let evalYear = reportYearEnd; evalYear <= asOfYear; evalYear++) {
        const evaluationDate = `${evalYear}-12-31`;
        if (evaluationDate < reportDate) continue;
        const isClosed = closeDate <= evaluationDate;

        // Paid development: power curve of elapsed/settlement time.
        let paidToDate = 0;
        if (!closedNoPay) {
          if (isClosed) {
            paidToDate = ultimate;
          } else {
            const elapsedMonths =
              (Number(evaluationDate.slice(0, 4)) * 12 + Number(evaluationDate.slice(5, 7))) -
              (Number(reportDate.slice(0, 4)) * 12 + Number(reportDate.slice(5, 7)));
            const frac = Math.min(1, Math.pow(Math.max(0, elapsedMonths) / settleLagMonths, 1.35));
            paidToDate = ultimate * frac * 0.92; // holdback until settlement
          }
        }

        // Case reserve on open claims: remaining cost at the adequacy level
        // prevailing in the evaluation calendar year.
        let caseReserve = 0;
        if (!isClosed) {
          const adequacy = evalYear >= 2022 ? Math.min(1.2, 0.9 + 0.1 * (evalYear - 2021)) : 0.9;
          const remaining = closedNoPay ? 2500 : Math.max(0, ultimate - paidToDate);
          caseReserve = Math.max(500, remaining * adequacy * caseNoise);
        }

        claims.push({
          claimId,
          accidentDate,
          reportDate,
          evaluationDate,
          paidToDate: Math.round(paidToDate * 100) / 100,
          caseReserve: Math.round(caseReserve * 100) / 100,
          status: isClosed ? "closed" : "open",
        });
        if (isClosed) break; // step function carries the closed state forward
      }
    }
  }

  return { claims, exposures, config: cfg };
}

export function claimsToCsv(claims: ClaimSnapshot[]): string {
  const header = "claim_id,accident_date,report_date,evaluation_date,paid_to_date,case_reserve,status";
  const lines = claims.map(
    (c) =>
      `${c.claimId},${c.accidentDate},${c.reportDate},${c.evaluationDate},${c.paidToDate},${c.caseReserve},${c.status}`,
  );
  return [header, ...lines].join("\n") + "\n";
}

export function exposuresToCsv(exposures: ExposureRecord[]): string {
  // Both bases so the demo import supports the loss-ratio and pure-premium methods.
  const header = "origin,earned_premium,exposure_units";
  const lines = exposures.map((e) => `${e.origin},${e.earnedPremium ?? ""},${e.exposureUnits ?? ""}`);
  return [header, ...lines].join("\n") + "\n";
}
