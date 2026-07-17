/**
 * Estimate metadata: the typed identification of what an unpaid-claim
 * estimate IS — its intended purpose and users, the intended measure, the
 * gross/net and LAE basis, and the accounting/valuation/review dates
 * (ASOP 43 terminology; the disclosure generator renders these under
 * ASOP 41).
 *
 * Ground truth:
 * - `validateMetadata` VALIDATES, it does not construct: metadata is often
 *   built up field-by-field over the course of an analysis, so callers keep
 *   plain objects and ask for the problem list whenever they need to know
 *   whether the metadata is disclosure-ready. Empty array = valid.
 * - Validation is defensive at runtime (built-up metadata may have been cast
 *   from a partial), so required-field presence and enum membership are
 *   checked even though the types already say so.
 * - Dates are caller-supplied ISO strings (yyyy-mm-dd), checked for real
 *   calendar validity (leap years included); the module never reads a clock.
 * - `percentile` is a fraction strictly between 0 and 1 (e.g. 0.75 for the
 *   75th percentile) and is only meaningful — and only allowed — when
 *   intendedMeasure.kind === "specified-percentile".
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP Nos. 41 and 43; responsibility for compliance remains with the
 * credentialed actuary.
 */

export const INTENDED_MEASURE_KINDS = [
  "central-estimate",
  "high-estimate",
  "low-estimate",
  "specified-percentile",
  "range",
] as const;

export type IntendedMeasureKind = (typeof INTENDED_MEASURE_KINDS)[number];

export interface IntendedMeasure {
  kind: IntendedMeasureKind;
  /** Fraction in (0, 1), e.g. 0.75; required iff kind === "specified-percentile". */
  percentile?: number;
}

export const GROSS_NET_BASES = [
  "gross",
  "net-of-reinsurance",
  "net-of-salvage-subro",
  "net-all",
] as const;

export type GrossNetBasis = (typeof GROSS_NET_BASES)[number];

export const LAE_TREATMENTS = [
  "excluding-lae",
  "including-all-lae",
  "dcc-only",
  "aao-only",
] as const;

export type LaeTreatment = (typeof LAE_TREATMENTS)[number];

export interface EstimateBasis {
  grossNet: GrossNetBasis;
  laeTreatment: LaeTreatment;
}

export interface EstimateMetadata {
  /** Why the estimate exists (e.g. "unpaid claim estimate for the 2025 annual statement"). */
  intendedPurpose: string;
  /** Who may rely on the estimate. */
  intendedUsers?: string[];
  intendedMeasure: IntendedMeasure;
  basis: EstimateBasis;
  /** ISO date (yyyy-mm-dd) used to separate paid from unpaid (ASOP 43 accounting date). */
  accountingDate: string;
  /** ISO date through which transactions are reflected in the data (ASOP 43 valuation date). */
  valuationDate: string;
  /** ISO cutoff for information reflected in the analysis (ASOP 41 review date), when later than the valuation date. */
  reviewDate?: string;
  scopeNotes?: string;
  /** ISO 4217-style currency label (e.g. "USD"); informational, not validated against a table. */
  currency?: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a well-formed yyyy-mm-dd string naming a real calendar date. */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day >= 1 && day <= daysInMonth;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function checkDate(problems: string[], name: string, value: unknown, required: boolean): void {
  if (value === undefined) {
    if (required) problems.push(`${name} is required (ISO yyyy-mm-dd)`);
    return;
  }
  if (typeof value !== "string" || !isIsoDate(value)) {
    problems.push(`${name} must be a valid ISO date (yyyy-mm-dd); got ${JSON.stringify(value)}`);
  }
}

/**
 * Returns the list of problems keeping `metadata` from being disclosure-ready;
 * an empty array means valid. Never throws — validation, not construction.
 */
export function validateMetadata(metadata: EstimateMetadata): string[] {
  const problems: string[] = [];

  if (!isNonEmptyString(metadata.intendedPurpose)) {
    problems.push("intendedPurpose is required and must be a non-empty string");
  }

  if (metadata.intendedUsers !== undefined) {
    if (!Array.isArray(metadata.intendedUsers)) {
      problems.push("intendedUsers, when provided, must be an array of non-empty strings");
    } else {
      metadata.intendedUsers.forEach((user, index) => {
        if (!isNonEmptyString(user)) {
          problems.push(`intendedUsers[${index}] must be a non-empty string`);
        }
      });
    }
  }

  const measure = metadata.intendedMeasure as IntendedMeasure | undefined;
  if (measure === undefined) {
    problems.push("intendedMeasure is required");
  } else {
    if (!(INTENDED_MEASURE_KINDS as readonly string[]).includes(measure.kind)) {
      problems.push(
        `intendedMeasure.kind must be one of ${INTENDED_MEASURE_KINDS.join(", ")}; got ${JSON.stringify(measure.kind)}`,
      );
    }
    if (measure.kind === "specified-percentile") {
      const p = measure.percentile;
      if (p === undefined) {
        problems.push('intendedMeasure.percentile is required when kind is "specified-percentile"');
      } else if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p >= 1) {
        problems.push(
          `intendedMeasure.percentile must be a fraction strictly between 0 and 1 (e.g. 0.75); got ${JSON.stringify(p)}`,
        );
      }
    } else if (measure.percentile !== undefined) {
      problems.push(
        `intendedMeasure.percentile is only meaningful when kind is "specified-percentile"; got kind ${JSON.stringify(measure.kind)}`,
      );
    }
  }

  const basis = metadata.basis as EstimateBasis | undefined;
  if (basis === undefined) {
    problems.push("basis is required");
  } else {
    if (!(GROSS_NET_BASES as readonly string[]).includes(basis.grossNet)) {
      problems.push(
        `basis.grossNet must be one of ${GROSS_NET_BASES.join(", ")}; got ${JSON.stringify(basis.grossNet)}`,
      );
    }
    if (!(LAE_TREATMENTS as readonly string[]).includes(basis.laeTreatment)) {
      problems.push(
        `basis.laeTreatment must be one of ${LAE_TREATMENTS.join(", ")}; got ${JSON.stringify(basis.laeTreatment)}`,
      );
    }
  }

  checkDate(problems, "accountingDate", metadata.accountingDate, true);
  checkDate(problems, "valuationDate", metadata.valuationDate, true);
  checkDate(problems, "reviewDate", metadata.reviewDate, false);

  if (metadata.scopeNotes !== undefined && !isNonEmptyString(metadata.scopeNotes)) {
    problems.push("scopeNotes, when provided, must be a non-empty string");
  }
  if (metadata.currency !== undefined && !isNonEmptyString(metadata.currency)) {
    problems.push("currency, when provided, must be a non-empty string");
  }

  return problems;
}
