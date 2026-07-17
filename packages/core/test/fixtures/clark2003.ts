import type { Triangle } from "../../src/types.js";

/**
 * Published validation data from Clark (2003), "LDF Curve-Fitting and
 * Stochastic Reserving: A Maximum Likelihood Approach", CAS Forum Fall 2003,
 * pp. 41-92 (Section 4 example, Tables and text pp. 59-69).
 *
 * DATA NOTE: Clark's triangle is the Mack (1993) Taylor/Ashe triangle
 * relabeled AY 1991-2000 - but Clark's PRINTED triangle differs from Mack's
 * in one cell: 1991 @ age 48 reads 2,182,708 where Mack Table 1 prints
 * 2,218,270 (a digit transposition in one of the two sources; Clark's
 * incremental table confirms his cumulative value, 447,378 = 2,182,708 -
 * 1,735,330, so his published fits flow from HIS printed cell). This fixture
 * transcribes Clark's triangle exactly as printed, so it deliberately
 * differs from fixtures/mack1993.ts in that single cell.
 */

const N = null;

/** Clark (2003) Section 4.1 cumulative reported-loss triangle (p. 59). */
export const clarkTriangle: Triangle = {
  kind: "incurred",
  origins: ["1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998", "1999", "2000"],
  ages: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
  values: [
    [357848, 1124788, 1735330, 2182708, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
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

/**
 * Onlevel premium assumed by Clark for the Cape Cod method (Section 4.2):
 * 10,000,000 for 1991 increasing 400,000 per year to 13,600,000 in 2000.
 */
export const clarkOnlevelPremium: { origin: string; premium: number }[] =
  clarkTriangle.origins.map((origin, i) => ({ origin, premium: 10_000_000 + 400_000 * i }));

/** LDF method, loglogistic (pp. 61-65). */
export const clarkLdfLoglogisticPublished = {
  omega: 1.434294,
  theta: 48.6249,
  sigma2: 65_029,
  dof: 43,
  untruncated: {
    totalReserve: 35_640_618,
    totalUltimate: 69_998_708,
    // Spot rows (AY -> published values): G(x) at avg age, reserve.
    rows: {
      "1991": { growthAtAge: 0.7724, ldf: 1.2946, ultimate: 5_050_867, reserve: 1_149_404 },
      "1996": { reserve: 3_176_268 },
      "2000": { growthAtAge: 0.0474, reserve: 6_917_191 },
    },
  },
  truncatedAt240: {
    growthAtTruncation: 0.905, // G(avg age 234)
    totalReserve: 28_987_633,
    totalLossesAt240: 63_345_723,
    processSdTotal: 1_372_966,
    parameterSdTotal: 4_688_826,
    totalSdTotal: 4_885_707,
    rows: {
      "1991": {
        truncatedLdf: 1.1716, // = G(234)/G(114) = 0.9050/0.7724
        ultimateAt240: 4_570_810,
        reserve: 669_347,
        processSd: 208_631,
        parameterSd: 158_088,
        totalSd: 261_761,
      },
      "1996": { reserve: 2_523_505 },
      "2000": { reserve: 6_227_054, processSd: 636_348, parameterSd: 2_838_890 },
    },
  },
};

/** LDF method, Weibull (pp. 64-65) - the lighter-tail alternative. */
export const clarkLdfWeibullPublished = {
  omega: 1.296906,
  theta: 48.88453,
  untruncated: {
    totalUltimate: 55_572_851,
    totalReserve: 21_214_761,
    rows: {
      "1991": { growthAtAge: 0.9501, reserve: 204_726 },
      "1996": { reserve: 1_741_530 },
      "2000": { growthAtAge: 0.0637, reserve: 5_054_849 },
    },
  },
};

/** Cape Cod method, loglogistic, truncated at 240 months (pp. 66-69). */
export const clarkCapeCodPublished = {
  omega: 1.447634,
  theta: 48.0205,
  elr: 0.5978,
  sigma2: 61_577,
  dof: 52,
  truncatedAt240: {
    growthAtTruncation: 0.9083,
    totalReserve: 29_707_484,
    processSdTotal: 1_352_515,
    parameterSdTotal: 3_143_967,
    totalSdTotal: 3_422_547,
    rows: {
      "1991": {
        growthAtAge: 0.7776,
        reserve: 781_218,
        processSd: 219_329,
        parameterSd: 158_913,
        totalSd: 270_848,
      },
      "1996": { reserve: 2_624_620 },
      "2000": { growthAtAge: 0.0469, reserve: 7_002_255, parameterSd: 439_441 },
    },
  },
};
