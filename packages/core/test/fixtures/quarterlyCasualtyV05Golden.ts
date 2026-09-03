/**
 * Frozen migration evidence captured from the verified @actuarial-ts/core 0.5.0
 * quarterly fixture on 2026-09-03. This is plain test data, not a supported
 * legacy API and not a reason to preserve the old public surface.
 */
export interface QuarterlyCasualtyV05GoldenRecord {
  readonly group: string;
  readonly origin: string;
  readonly valuation: string;
  readonly ageMonths: number;
  readonly metricId: string;
  readonly rawNumerator: number | null;
  readonly rawDenominator: number | null;
  readonly value: number | null;
  readonly warningCodes: readonly string[];
}

export const quarterlyCasualtyV05Golden = [
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "case-250-per-open",
    "rawNumerator": 240000,
    "rawDenominator": 18,
    "value": 13333.333333333334,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "case-primary-per-open",
    "rawNumerator": 350000,
    "rawDenominator": 18,
    "value": 19444.444444444445,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-no-pay-frequency",
    "rawNumerator": 8,
    "rawDenominator": 820000,
    "value": 9.75609756097561,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-no-pay-share",
    "rawNumerator": 8,
    "rawDenominator": 40,
    "value": 0.2,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-frequency",
    "rawNumerator": 14,
    "rawDenominator": 820000,
    "value": 17.073170731707318,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share",
    "rawNumerator": 14,
    "rawDenominator": 40,
    "value": 0.35,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share-of-non-cnp",
    "rawNumerator": 14,
    "rawDenominator": 32,
    "value": 0.4375,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-250-per-exposure",
    "rawNumerator": 520000,
    "rawDenominator": 820000,
    "value": 0.6341463414634146,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-250-per-non-cnp",
    "rawNumerator": 520000,
    "rawDenominator": 32,
    "value": 16250,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-exposure",
    "rawNumerator": 710000,
    "rawDenominator": 820000,
    "value": 0.8658536585365854,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-non-cnp",
    "rawNumerator": 710000,
    "rawDenominator": 32,
    "value": 22187.5,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "non-closed-no-pay-frequency",
    "rawNumerator": 32,
    "rawDenominator": 820000,
    "value": 39.02439024390244,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-frequency",
    "rawNumerator": 18,
    "rawDenominator": 820000,
    "value": 21.95121951219512,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-share",
    "rawNumerator": 18,
    "rawDenominator": 40,
    "value": 0.45,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-share-of-non-cnp",
    "rawNumerator": 18,
    "rawDenominator": 32,
    "value": 0.5625,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-250-per-closed-with-pay",
    "rawNumerator": 280000,
    "rawDenominator": 14,
    "value": 20000,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-250-per-exposure",
    "rawNumerator": 280000,
    "rawDenominator": 820000,
    "value": 0.34146341463414637,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-primary-per-closed-with-pay",
    "rawNumerator": 360000,
    "rawDenominator": 14,
    "value": 25714.285714285714,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-primary-per-exposure",
    "rawNumerator": 360000,
    "rawDenominator": 820000,
    "value": 0.43902439024390244,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-250",
    "rawNumerator": 280000,
    "rawDenominator": 520000,
    "value": 0.5384615384615384,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-primary",
    "rawNumerator": 360000,
    "rawDenominator": 710000,
    "value": 0.5070422535211268,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "reported-frequency",
    "rawNumerator": 40,
    "rawDenominator": 820000,
    "value": 48.78048780487805,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "case-250-per-open",
    "rawNumerator": 200000,
    "rawDenominator": 13,
    "value": 15384.615384615385,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "case-primary-per-open",
    "rawNumerator": 290000,
    "rawDenominator": 13,
    "value": 22307.69230769231,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-no-pay-frequency",
    "rawNumerator": 10,
    "rawDenominator": 820000,
    "value": 12.195121951219512,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-no-pay-share",
    "rawNumerator": 10,
    "rawDenominator": 46,
    "value": 0.21739130434782608,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-frequency",
    "rawNumerator": 23,
    "rawDenominator": 820000,
    "value": 28.04878048780488,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-share",
    "rawNumerator": 23,
    "rawDenominator": 46,
    "value": 0.5,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-share-of-non-cnp",
    "rawNumerator": 23,
    "rawDenominator": 36,
    "value": 0.6388888888888888,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-250-per-exposure",
    "rawNumerator": 590000,
    "rawDenominator": 820000,
    "value": 0.7195121951219512,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-250-per-non-cnp",
    "rawNumerator": 590000,
    "rawDenominator": 36,
    "value": 16388.88888888889,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-primary-per-exposure",
    "rawNumerator": 800000,
    "rawDenominator": 820000,
    "value": 0.975609756097561,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-primary-per-non-cnp",
    "rawNumerator": 800000,
    "rawDenominator": 36,
    "value": 22222.222222222223,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "non-closed-no-pay-frequency",
    "rawNumerator": 36,
    "rawDenominator": 820000,
    "value": 43.90243902439024,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-frequency",
    "rawNumerator": 13,
    "rawDenominator": 820000,
    "value": 15.853658536585366,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-share",
    "rawNumerator": 13,
    "rawDenominator": 46,
    "value": 0.2826086956521739,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-share-of-non-cnp",
    "rawNumerator": 13,
    "rawDenominator": 36,
    "value": 0.3611111111111111,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-250-per-closed-with-pay",
    "rawNumerator": 390000,
    "rawDenominator": 23,
    "value": 16956.521739130436,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-250-per-exposure",
    "rawNumerator": 390000,
    "rawDenominator": 820000,
    "value": 0.47560975609756095,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-primary-per-closed-with-pay",
    "rawNumerator": 510000,
    "rawDenominator": 23,
    "value": 22173.91304347826,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-primary-per-exposure",
    "rawNumerator": 510000,
    "rawDenominator": 820000,
    "value": 0.6219512195121951,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-to-incurred-250",
    "rawNumerator": 390000,
    "rawDenominator": 590000,
    "value": 0.6610169491525424,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-to-incurred-primary",
    "rawNumerator": 510000,
    "rawDenominator": 800000,
    "value": 0.6375,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "reported-frequency",
    "rawNumerator": 46,
    "rawDenominator": 820000,
    "value": 56.09756097560976,
    "warningCodes": [
      "DUPLICATE_EXPOSURE_KEY"
    ]
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "case-250-per-open",
    "rawNumerator": 240000,
    "rawDenominator": 17,
    "value": 14117.64705882353,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "case-primary-per-open",
    "rawNumerator": 340000,
    "rawDenominator": 17,
    "value": 20000,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "closed-no-pay-frequency",
    "rawNumerator": 7,
    "rawDenominator": 850000,
    "value": 8.235294117647058,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "closed-no-pay-share",
    "rawNumerator": 7,
    "rawDenominator": 38,
    "value": 0.18421052631578946,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "closed-with-pay-frequency",
    "rawNumerator": 14,
    "rawDenominator": 850000,
    "value": 16.470588235294116,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share",
    "rawNumerator": 14,
    "rawDenominator": 38,
    "value": 0.3684210526315789,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share-of-non-cnp",
    "rawNumerator": 14,
    "rawDenominator": 31,
    "value": 0.45161290322580644,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "incurred-250-per-exposure",
    "rawNumerator": 490000,
    "rawDenominator": 850000,
    "value": 0.5764705882352941,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "incurred-250-per-non-cnp",
    "rawNumerator": 490000,
    "rawDenominator": 31,
    "value": 15806.451612903225,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-exposure",
    "rawNumerator": 670000,
    "rawDenominator": 850000,
    "value": 0.788235294117647,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-non-cnp",
    "rawNumerator": 670000,
    "rawDenominator": 31,
    "value": 21612.90322580645,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "non-closed-no-pay-frequency",
    "rawNumerator": 31,
    "rawDenominator": 850000,
    "value": 36.470588235294116,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "open-frequency",
    "rawNumerator": 17,
    "rawDenominator": 850000,
    "value": 20,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "open-share",
    "rawNumerator": 17,
    "rawDenominator": 38,
    "value": 0.4473684210526316,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "open-share-of-non-cnp",
    "rawNumerator": 17,
    "rawDenominator": 31,
    "value": 0.5483870967741935,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-250-per-closed-with-pay",
    "rawNumerator": 250000,
    "rawDenominator": 14,
    "value": 17857.14285714286,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-250-per-exposure",
    "rawNumerator": 250000,
    "rawDenominator": 850000,
    "value": 0.29411764705882354,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-primary-per-closed-with-pay",
    "rawNumerator": 330000,
    "rawDenominator": 14,
    "value": 23571.428571428572,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-primary-per-exposure",
    "rawNumerator": 330000,
    "rawDenominator": 850000,
    "value": 0.38823529411764707,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-250",
    "rawNumerator": 250000,
    "rawDenominator": 490000,
    "value": 0.5102040816326531,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-primary",
    "rawNumerator": 330000,
    "rawDenominator": 670000,
    "value": 0.4925373134328358,
    "warningCodes": []
  },
  {
    "group": "fleet-a",
    "origin": "2025Q1",
    "valuation": "2025Q1",
    "ageMonths": 3,
    "metricId": "reported-frequency",
    "rawNumerator": 38,
    "rawDenominator": 850000,
    "value": 44.70588235294118,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "case-250-per-open",
    "rawNumerator": 120000,
    "rawDenominator": 9,
    "value": 13333.333333333334,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "case-primary-per-open",
    "rawNumerator": 160000,
    "rawDenominator": 9,
    "value": 17777.777777777777,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-no-pay-frequency",
    "rawNumerator": 5,
    "rawDenominator": 430000,
    "value": 11.627906976744185,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-no-pay-share",
    "rawNumerator": 5,
    "rawDenominator": 22,
    "value": 0.22727272727272727,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-frequency",
    "rawNumerator": 8,
    "rawDenominator": 430000,
    "value": 18.6046511627907,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share",
    "rawNumerator": 8,
    "rawDenominator": 22,
    "value": 0.36363636363636365,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "closed-with-pay-share-of-non-cnp",
    "rawNumerator": 8,
    "rawDenominator": 17,
    "value": 0.47058823529411764,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-250-per-exposure",
    "rawNumerator": 260000,
    "rawDenominator": 430000,
    "value": 0.6046511627906976,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-250-per-non-cnp",
    "rawNumerator": 260000,
    "rawDenominator": 17,
    "value": 15294.117647058823,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-exposure",
    "rawNumerator": 350000,
    "rawDenominator": 430000,
    "value": 0.813953488372093,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "incurred-primary-per-non-cnp",
    "rawNumerator": 350000,
    "rawDenominator": 17,
    "value": 20588.235294117647,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "non-closed-no-pay-frequency",
    "rawNumerator": 17,
    "rawDenominator": 430000,
    "value": 39.53488372093023,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-frequency",
    "rawNumerator": 9,
    "rawDenominator": 430000,
    "value": 20.930232558139537,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-share",
    "rawNumerator": 9,
    "rawDenominator": 22,
    "value": 0.4090909090909091,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "open-share-of-non-cnp",
    "rawNumerator": 9,
    "rawDenominator": 17,
    "value": 0.5294117647058824,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-250-per-closed-with-pay",
    "rawNumerator": 140000,
    "rawDenominator": 8,
    "value": 17500,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-250-per-exposure",
    "rawNumerator": 140000,
    "rawDenominator": 430000,
    "value": 0.32558139534883723,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-primary-per-closed-with-pay",
    "rawNumerator": 190000,
    "rawDenominator": 8,
    "value": 23750,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-primary-per-exposure",
    "rawNumerator": 190000,
    "rawDenominator": 430000,
    "value": 0.4418604651162791,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-250",
    "rawNumerator": 140000,
    "rawDenominator": 260000,
    "value": 0.5384615384615384,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "paid-to-incurred-primary",
    "rawNumerator": 190000,
    "rawDenominator": 350000,
    "value": 0.5428571428571428,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2024Q4",
    "ageMonths": 3,
    "metricId": "reported-frequency",
    "rawNumerator": 22,
    "rawDenominator": 430000,
    "value": 51.16279069767442,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "case-250-per-open",
    "rawNumerator": 100000,
    "rawDenominator": 7,
    "value": 14285.714285714286,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "case-primary-per-open",
    "rawNumerator": 140000,
    "rawDenominator": 7,
    "value": 20000,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-no-pay-frequency",
    "rawNumerator": 6,
    "rawDenominator": 430000,
    "value": 13.953488372093023,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-no-pay-share",
    "rawNumerator": 6,
    "rawDenominator": 25,
    "value": 0.24,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-frequency",
    "rawNumerator": 12,
    "rawDenominator": 430000,
    "value": 27.906976744186046,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-share",
    "rawNumerator": 12,
    "rawDenominator": 25,
    "value": 0.48,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "closed-with-pay-share-of-non-cnp",
    "rawNumerator": 12,
    "rawDenominator": 19,
    "value": 0.631578947368421,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-250-per-exposure",
    "rawNumerator": 290000,
    "rawDenominator": 430000,
    "value": 0.6744186046511628,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-250-per-non-cnp",
    "rawNumerator": 290000,
    "rawDenominator": 19,
    "value": 15263.157894736842,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-primary-per-exposure",
    "rawNumerator": 390000,
    "rawDenominator": 430000,
    "value": 0.9069767441860465,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "incurred-primary-per-non-cnp",
    "rawNumerator": 390000,
    "rawDenominator": 19,
    "value": 20526.315789473683,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "non-closed-no-pay-frequency",
    "rawNumerator": 19,
    "rawDenominator": 430000,
    "value": 44.18604651162791,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-frequency",
    "rawNumerator": 7,
    "rawDenominator": 430000,
    "value": 16.279069767441857,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-share",
    "rawNumerator": 7,
    "rawDenominator": 25,
    "value": 0.28,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "open-share-of-non-cnp",
    "rawNumerator": 7,
    "rawDenominator": 19,
    "value": 0.3684210526315789,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-250-per-closed-with-pay",
    "rawNumerator": 190000,
    "rawDenominator": 12,
    "value": 15833.333333333334,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-250-per-exposure",
    "rawNumerator": 190000,
    "rawDenominator": 430000,
    "value": 0.4418604651162791,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-primary-per-closed-with-pay",
    "rawNumerator": 250000,
    "rawDenominator": 12,
    "value": 20833.333333333332,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-primary-per-exposure",
    "rawNumerator": 250000,
    "rawDenominator": 430000,
    "value": 0.5813953488372093,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-to-incurred-250",
    "rawNumerator": 190000,
    "rawDenominator": 290000,
    "value": 0.6551724137931034,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "paid-to-incurred-primary",
    "rawNumerator": 250000,
    "rawDenominator": 390000,
    "value": 0.6410256410256411,
    "warningCodes": []
  },
  {
    "group": "fleet-b",
    "origin": "2024Q4",
    "valuation": "2025Q1",
    "ageMonths": 6,
    "metricId": "reported-frequency",
    "rawNumerator": 25,
    "rawDenominator": 430000,
    "value": 58.139534883720934,
    "warningCodes": []
  }
] as const satisfies readonly QuarterlyCasualtyV05GoldenRecord[];


