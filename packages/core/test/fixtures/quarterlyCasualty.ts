import type { DiagnosticExposureRow, DiagnosticLossRow } from "../../src/index.js";

/**
 * Small, transparent quarterly casualty fixture. Values are illustrative but
 * preserve realistic cumulative relationships and ragged valuation maturity.
 */
export const quarterlyCasualtyLosses: DiagnosticLossRow[] = [
  {
    id: "fleet-a-2024q4-at-2024q4", group: "fleet-a", origin: "2024Q4", valuation: "2024Q4", ageMonths: 3, policyPeriod: "PY2024",
    measures: { reportedCount: 40, openCount: 18, closedNoPayCount: 8, closedWithPayCount: 14, paid250: 280_000, incurred250: 520_000, paidPrimary: 360_000, incurredPrimary: 710_000 },
  },
  {
    id: "fleet-a-2024q4-at-2025q1", group: "fleet-a", origin: "2024Q4", valuation: "2025Q1", ageMonths: 6, policyPeriod: "PY2024",
    measures: { reportedCount: 46, openCount: 13, closedNoPayCount: 10, closedWithPayCount: 23, paid250: 390_000, incurred250: 590_000, paidPrimary: 510_000, incurredPrimary: 800_000 },
  },
  {
    id: "fleet-a-2025q1-at-2025q1", group: "fleet-a", origin: "2025Q1", valuation: "2025Q1", ageMonths: 3, policyPeriod: "PY2024",
    measures: { reportedCount: 38, openCount: 17, closedNoPayCount: 7, closedWithPayCount: 14, paid250: 250_000, incurred250: 490_000, paidPrimary: 330_000, incurredPrimary: 670_000 },
  },
  {
    id: "fleet-b-2024q4-at-2024q4", group: "fleet-b", origin: "2024Q4", valuation: "2024Q4", ageMonths: 3, policyPeriod: "PY2024",
    measures: { reportedCount: 22, openCount: 9, closedNoPayCount: 5, closedWithPayCount: 8, paid250: 140_000, incurred250: 260_000, paidPrimary: 190_000, incurredPrimary: 350_000 },
  },
  {
    id: "fleet-b-2024q4-at-2025q1", group: "fleet-b", origin: "2024Q4", valuation: "2025Q1", ageMonths: 6, policyPeriod: "PY2024",
    measures: { reportedCount: 25, openCount: 7, closedNoPayCount: 6, closedWithPayCount: 12, paid250: 190_000, incurred250: 290_000, paidPrimary: 250_000, incurredPrimary: 390_000 },
  },
];

export const quarterlyCasualtyExposures: DiagnosticExposureRow[] = [
  { key: "fleet-a-unit-2024q4", group: "fleet-a", origin: "2024Q4", valuation: "2024Q4", measures: { exposure: 820_000 } },
  // The same exposure appears on a later snapshot; its stable key prevents double-counting.
  { key: "fleet-a-unit-2024q4", group: "fleet-a", origin: "2024Q4", valuation: "2025Q1", measures: { exposure: 820_000 } },
  { key: "fleet-a-unit-2025q1", group: "fleet-a", origin: "2025Q1", measures: { exposure: 850_000 } },
  { key: "fleet-b-unit-2024q4", group: "fleet-b", origin: "2024Q4", measures: { exposure: 430_000 } },
];

/**
 * The exact input used to capture the immutable 0.5.0 migration golden. The
 * golden freezes numeric behavior, not this release's public API shape.
 */
export const quarterlyCasualtyV05Input = {
  losses: quarterlyCasualtyLosses,
  exposures: quarterlyCasualtyExposures,
} as const;

/** Independently calculated golden values for fleet-a / 2024Q4 / age 3. */
export const quarterlyCasualtyExpectedFleetA2024Q4Age3 = {
  "reported-frequency": 40 / 820_000 * 1_000_000,
  "open-frequency": 18 / 820_000 * 1_000_000,
  "closed-no-pay-frequency": 8 / 820_000 * 1_000_000,
  "closed-with-pay-frequency": 14 / 820_000 * 1_000_000,
  "non-closed-no-pay-frequency": 32 / 820_000 * 1_000_000,
  "closed-no-pay-share": 8 / 40,
  "closed-with-pay-share": 14 / 40,
  "closed-with-pay-share-of-non-cnp": 14 / 32,
  "open-share": 18 / 40,
  "open-share-of-non-cnp": 18 / 32,
  "paid-to-incurred-250": 280_000 / 520_000,
  "paid-to-incurred-primary": 360_000 / 710_000,
  "incurred-250-per-exposure": 520_000 / 820_000,
  "incurred-primary-per-exposure": 710_000 / 820_000,
  "incurred-250-per-non-cnp": 520_000 / 32,
  "incurred-primary-per-non-cnp": 710_000 / 32,
  "paid-250-per-exposure": 280_000 / 820_000,
  "paid-primary-per-exposure": 360_000 / 820_000,
  "paid-250-per-closed-with-pay": 280_000 / 14,
  "paid-primary-per-closed-with-pay": 360_000 / 14,
  "case-250-per-open": (520_000 - 280_000) / 18,
  "case-primary-per-open": (710_000 - 360_000) / 18,
} as const;
