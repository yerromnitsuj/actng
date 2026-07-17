/**
 * Published validation data, transcribed from the primary source:
 *
 * Gluck, S. (1997), "Balancing Development and Trend in Loss Reserve
 * Analysis", Proceedings of the Casualty Actuarial Society LXXXIV,
 * Tables 1-4 ("Company XYZ Workers Compensation Study, Data as of
 * 12/31/92", paid losses, 11%/yr trend to 1992).
 *
 * Columns per accident year: exposures E, paid losses to date LTD (000s),
 * trend factor to 1992 TF, cumulative paid development factor DF.
 *
 * Checkpoints as printed:
 * - Table 1 (standard Cape Cod, D = 1): expected pure premium at the 1992
 *   trend level = 1.9621 (= 33,166 / 16,903 from the printed totals; the
 *   p. 497 text says "1.9617", an internal rounding inconsistency in the
 *   paper — the tabled arithmetic supports 1.9621).
 * - Tables 3-4 (Generalized Cape Cod, D = 0.75): per-AY expected pure
 *   premium at the 1992 level (col 11), the 1990 target restated to its own
 *   level (2.0675 / 1.2321 = 1.6781), and BF ultimates totaling 38,208 (000s).
 */

export interface GluckRow {
  year: string;
  exposures: number;
  paidToDate: number;
  trendTo1992: number;
  cdf: number;
}

export const gluckRows: GluckRow[] = [
  { year: "1979", exposures: 914, paidToDate: 491, trendTo1992: 3.8833, cdf: 1.12 },
  { year: "1980", exposures: 1203, paidToDate: 385, trendTo1992: 3.4985, cdf: 1.1312 },
  { year: "1981", exposures: 1264, paidToDate: 949, trendTo1992: 3.1518, cdf: 1.1538 },
  { year: "1982", exposures: 1372, paidToDate: 769, trendTo1992: 2.8394, cdf: 1.1769 },
  { year: "1983", exposures: 1422, paidToDate: 944, trendTo1992: 2.558, cdf: 1.2122 },
  { year: "1984", exposures: 1502, paidToDate: 909, trendTo1992: 2.3045, cdf: 1.2624 },
  { year: "1985", exposures: 2090, paidToDate: 1345, trendTo1992: 2.0762, cdf: 1.3239 },
  { year: "1986", exposures: 2338, paidToDate: 1298, trendTo1992: 1.8704, cdf: 1.4175 },
  { year: "1987", exposures: 2456, paidToDate: 1375, trendTo1992: 1.6851, cdf: 1.5531 },
  { year: "1988", exposures: 2617, paidToDate: 2086, trendTo1992: 1.5181, cdf: 1.7053 },
  { year: "1989", exposures: 2774, paidToDate: 2153, trendTo1992: 1.3676, cdf: 1.9171 },
  { year: "1990", exposures: 3021, paidToDate: 2265, trendTo1992: 1.2321, cdf: 2.4865 },
  { year: "1991", exposures: 3067, paidToDate: 2345, trendTo1992: 1.11, cdf: 3.4906 },
  { year: "1992", exposures: 3428, paidToDate: 1186, trendTo1992: 1.0, cdf: 6.6569 },
];

/** Table 1: the standard Cape Cod pooled pure premium at the 1992 level. */
export const gluckCapeCodPP1992 = 1.9621;

/** Table 4 col 11 (D = 0.75): per-AY expected pure premium at the 1992 level. */
export const gluckGcc075PP1992: number[] = [
  1.9586, 1.9246, 1.9676, 1.929, 1.9019, 1.8644, 1.8397, 1.8246, 1.8511, 1.925, 1.9915,
  2.0675, 2.1399, 2.1486,
];

/** Table 3/4: the 1990 expected PP restated to its own accident-year level. */
export const gluckGcc075PP1990OwnLevel = 1.6781;

/** Table 4 col 15 total (D = 0.75): BF estimated ultimate losses, 000s. */
export const gluckGcc075UltimateTotal = 38208;
