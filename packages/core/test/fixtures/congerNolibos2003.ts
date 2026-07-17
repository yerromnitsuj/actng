/**
 * Published validation data, transcribed from the primary source:
 *
 * - Conger, R.F. & Nolibos, A. (2003), "Estimating ULAE Liabilities:
 *   Rediscovering and Expanding Kittel's Approach", CAS Forum Fall 2003,
 *   93-139 (corrected v2 PDF with the Sept 2008 errata). Worked example:
 *   "XYZ Insurance Company, Review of ULAE Reserves as of 12/31/2002"
 *   ($000's), Exhibits A.1-F. Transcribed via
 *   docs/research/phase5/ulae-conger-nolibos-2003.md from
 *   https://www.casact.org/sites/default/files/old/forum_03fforum_03ff093v2.pdf
 *
 * Every exhibit figure below was independently recomputed and matched during
 * transcription; ratios are printed to 3 decimals and reserves to whole
 * $000's, so the pins use the printed precision.
 */

/**
 * Exhibit A.1 input parameters by calendar year: M = CY paid ULAE, P = CY
 * paid loss & ALAE, reported = CY reported loss & ALAE, R = estimated
 * ultimate loss & ALAE on claims reported in the calendar year.
 */
export const cnCalendarYears = [
  { label: "1997", M: 1978, P: 4590, reported: 19534, R: 27200 },
  { label: "1998", M: 4820, P: 14600, reported: 57125, R: 76700 },
  { label: "1999", M: 8558, P: 38390, reported: 85521, R: 106900 },
  { label: "2000", M: 12039, P: 58297, reported: 128672, R: 154300 },
  { label: "2001", M: 13143, P: 86074, reported: 145070, R: 163100 },
  { label: "2002", M: 15286, P: 105466, reported: 163626, R: 176400 },
] as const;

/** Exhibit A.2 by accident year: ultimate loss & ALAE, IBNR and reported at 12/31/2002. */
export const cnAccidentYears = [
  { label: "1997", ultimate: 28600, ibnr: 257, reported: 28343 },
  { label: "1998", ultimate: 79200, ibnr: 1742, reported: 77458 },
  { label: "1999", ultimate: 108400, ibnr: 5095, reported: 103305 },
  { label: "2000", ultimate: 156700, ibnr: 16140, reported: 140560 },
  { label: "2001", ultimate: 163400, ibnr: 34477, reported: 128923 },
  { label: "2002", ultimate: 177100, ibnr: 56141, reported: 120959 },
] as const;

/** Cumulative-to-date totals shared by the reserve exhibits. */
export const cnTotals = {
  ulaePaid: 55824, // Total M
  paid: 307417, // Total P = P(t)
  reported: 599547, // Total CY reported = reported losses to date
  reportedUltimate: 704600, // Total R = R(t), ultimate cost of claims reported to date
  ultimateLosses: 713400, // L (Exhibit A.2 total)
  ibnr: 113853, // Broad IBNR = L - reported
  caseReserve: 292130, // reported - paid
} as const;

/** Exhibit B - classical paid-to-paid: W = M/P; reserve = W* x (IBNR + 50% case). */
export const cnExhibitB = {
  ratios: [0.431, 0.33, 0.223, 0.207, 0.153, 0.145],
  totalRatio: 0.182,
  selectedW: 0.16,
  reserve: 41587,
} as const;

/** Exhibit C - Kittel: W = M / (50% x (P + reported)); same reserve formula. */
export const cnExhibitC = {
  ratios: [0.164, 0.134, 0.138, 0.129, 0.114, 0.114],
  totalRatio: 0.123,
  selectedW: 0.115,
  reserve: 29891,
} as const;

/** Exhibit D - generalized method, U = (60%, 40%, 0). */
export const cnExhibitD = {
  weights: { u1: 0.6, u2: 0.4, u3: 0 },
  bases: [18156, 51860, 79496, 115899, 132290, 148026],
  ratios: [0.109, 0.093, 0.108, 0.104, 0.099, 0.103],
  totalBasis: 545727,
  totalRatio: 0.102,
  selectedW: 0.1,
  reserves: { expected: 15516, bornhuetterFerguson: 16767, development: 17152 },
} as const;

/** Exhibit E - generalized method, U = (70%, 30%, 0). */
export const cnExhibitE = {
  weights: { u1: 0.7, u2: 0.3, u3: 0 },
  bases: [20417, 58070, 86347, 125499, 139992, 155120],
  ratios: [0.097, 0.083, 0.099, 0.096, 0.094, 0.099],
  totalBasis: 585445,
  totalRatio: 0.095,
  selectedW: 0.1,
  reserves: { expected: 15516, bornhuetterFerguson: 12795, development: 12201 },
} as const;

/**
 * Exhibit F - simplified generalized (60/40): the basis substitutes the
 * corresponding ACCIDENT year's ultimate A for R (valid only when U3 = 0);
 * the reserve uses an externally estimated pure IBNR for L - R(t).
 */
export const cnExhibitF = {
  weights: { u1: 0.6, u2: 0.4, u3: 0 },
  /** Accident-year ultimates A, in calendar-year order (Exhibit A.2 col 2). */
  accidentYearUltimates: [28600, 79200, 108400, 156700, 163400, 177100],
  bases: [18996, 53360, 80396, 117339, 132470, 148446],
  ratios: [0.104, 0.09, 0.106, 0.103, 0.099, 0.103],
  totalBasis: 551007,
  totalRatio: 0.101,
  selectedW: 0.1,
  /** (a) pure IBNR = 4% of latest AY ultimate; (b) 6%. */
  pureIbnr: { fourPercent: 7084, sixPercent: 10626 },
  reserves: { fourPercent: 16664, sixPercent: 16877 },
} as const;
