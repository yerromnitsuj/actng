import type { Triangle } from "../../src/types.js";

/**
 * Published validation data, transcribed from the primary sources:
 *
 * - Mack, T. (1993), "Distribution-free Calculation of the Standard Error of
 *   Chain Ladder Reserve Estimates", ASTIN Bulletin 23(2), 213-225.
 *   Table 1 (Taylor/Ashe 1983 data, the "GenIns" triangle) and
 *   Table 4 (Sanders 1990 mortgage guarantee data), with published
 *   development factors, sigma^2 estimates, reserves, and standard errors.
 * - Mack, T. (1999), "The Standard Error of Chain Ladder Reserve Estimates:
 *   Recursive Calculation and Inclusion of a Tail Factor", ASTIN Bulletin
 *   29(2), 361-366. Tables 1-2 (tail factor 1.05 on the Table 4 data).
 */

const N = null;

/** Mack (1993) Table 1: Taylor/Ashe run-off triangle (accumulated figures). */
export const taylorAshe: Triangle = {
  kind: "paid",
  origins: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  ages: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
  values: [
    [357848, 1124788, 1735330, 2218270, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
    [352118, 1236139, 2170033, 3353322, 3799067, 4120063, 4647867, 4914039, 5339085, N],
    [290507, 1292306, 2218525, 3235179, 3985995, 4132918, 4628910, 4909315, N, N],
    [310608, 1418858, 2195047, 3757447, 4029929, 4381982, 4588268, N, N, N],
    [443160, 1136350, 2128333, 2897821, 3402672, 3873311, N, N, N, N],
    [396132, 1333217, 2180715, 2985752, 3691712, N, N, N, N, N],
    [440832, 1288463, 2419861, 3483130, N, N, N, N, N, N],
    [359480, 1421128, 2864498, N, N, N, N, N, N, N],
    [376686, 1363294, N, N, N, N, N, N, N, N],
    [344014, N, N, N, N, N, N, N, N, N],
  ],
};

/** Published parameter estimates for Taylor/Ashe (Mack 1993, p. 221). */
export const taylorAshePublished = {
  // f_k as printed: 3.49, 1.75, 1.46, 1.174, 1.104, 1.086, 1.054, 1.077, 1.018
  factors: [3.49, 1.75, 1.46, 1.174, 1.104, 1.086, 1.054, 1.077, 1.018],
  factorTolerance: [0.005, 0.005, 0.005, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005],
  // sigma^2_k / 1000 as printed (the last value is Mack's extrapolation).
  // The scan prints the final value as 0.477, but Mack's own formula
  // min(s^4_8/s^2_7, min(s^2_7, s^2_8)) = min(2.96, 0.447) = 0.447, and the
  // R ChainLadder package reproduces sigma_9 = 21.1 (0.445k). 0.447 is used.
  sigma2Over1000: [160, 37.7, 42.0, 15.2, 13.7, 8.19, 0.447, 1.15, 0.447],
  // Chain ladder reserves in 1000s (Table 2), origins 2..10 and overall.
  reservesIn1000s: [95, 470, 710, 985, 1419, 2178, 3920, 4279, 4626],
  totalReserveIn1000s: 18681,
  // Standard error as % of reserve (Table 3), origins 2..10 and overall.
  sePercent: [80, 26, 19, 27, 29, 26, 22, 23, 29],
  totalSePercent: 13,
};

/** Mack (1993) Table 4: Sanders mortgage guarantee run-off triangle. */
export const mortgage: Triangle = {
  kind: "paid",
  origins: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ages: [12, 24, 36, 48, 60, 72, 84, 96, 108],
  values: [
    [58046, 127970, 476599, 1027692, 1360489, 1647310, 1819179, 1906852, 1950105],
    [24492, 141767, 984288, 2142656, 2961978, 3683940, 4048898, 4115760, N],
    [32848, 274682, 1522637, 3203427, 4445927, 5158781, 5342585, N, N],
    [21439, 529828, 2900301, 4999019, 6460112, 6853904, N, N, N],
    [40397, 763394, 2920745, 4989572, 5648563, N, N, N, N],
    [90748, 951994, 4210640, 5866482, N, N, N, N, N],
    [62096, 868480, 1954797, N, N, N, N, N, N],
    [24983, 284441, N, N, N, N, N, N, N],
    [13121, N, N, N, N, N, N, N, N],
  ],
};

/** Published values for the mortgage data (Mack 1993 Tables 4-6; Mack 1999 Tables 1-2). */
export const mortgagePublished = {
  // Mack 1999 Table 1 prints these to more digits than Mack 1993.
  factors: [11.1, 4.092, 1.708, 1.276, 1.139, 1.069, 1.026, 1.023],
  factorTolerance: [0.05, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005],
  sigma2Over1000: [1787, 977, 194, 42.8, 27.0, 5.57, 1.26, 0.285],
  // Chain ladder reserves in 1000s (Table 5), origins 2..9 and overall.
  reservesIn1000s: [93, 265, 834, 1568, 3696, 3487, 2956, 1647],
  totalReserveIn1000s: 14547,
  // Standard error as % of reserve (Table 6), origins 2..9 and overall.
  sePercent: [65, 53, 38, 38, 28, 37, 61, 133],
  totalSePercent: 26,
  // Mack 1999: with a judgmental tail factor of 1.05, the estimated ultimate
  // total is 48,906 (in 1000s); per-origin ultimates as printed in Table 2.
  tailFactor: 1.05,
  ultimatesWithTailIn1000s: [2048, 4420, 5888, 8073, 7577, 10041, 5714, 3403, 1743],
  totalUltimateWithTailIn1000s: 48906,
};
