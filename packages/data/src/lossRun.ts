import type { ClaimSnapshot } from "@actuarial-ts/core";
import { ReservingError } from "@actuarial-ts/core";
import { parseCsv } from "./csv.js";

/**
 * Loss-run CSV import. Mirrors the workbench import contract:
 *
 * Required columns (one row per claim per evaluation snapshot):
 *   claim_id, accident_date, report_date, evaluation_date,
 *   paid_to_date, case_reserve, status
 *
 * Headers are normalized (trimmed, lower-cased, whitespace -> underscores);
 * extra columns are ignored. Missing required columns make the file
 * unparseable and throw ReservingError("SHAPE", ...). Row-level failures are
 * collected — not thrown — so the caller decides whether to abort or load
 * the clean rows; a row with any error contributes no claim.
 *
 * Row numbers in errors are the 1-based PHYSICAL line in the file where the
 * row starts (header included; blank lines and newlines inside quoted fields
 * count), so in a file with no blank lines the first data row is row 2.
 *
 * Unlike the workbench importer, negative paid/case amounts are accepted
 * here: the ASOP 23 review layer (reviewClaimData) flags them, keeping the
 * signal visible instead of silently rejecting salvage/subrogation rows.
 */

const REQUIRED_COLUMNS = [
  "claim_id",
  "accident_date",
  "report_date",
  "evaluation_date",
  "paid_to_date",
  "case_reserve",
  "status",
] as const;

export interface LossRunRowError {
  /** 1-based physical file line where the row starts (first data row = 2 when nothing precedes it). */
  row: number;
  message: string;
}

export interface LossRunParseResult {
  claims: ClaimSnapshot[];
  errors: LossRunRowError[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** True when the string is a real calendar date in yyyy-mm-dd form. */
function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return false;
  // Arithmetic rule, mirroring compliance/src/metadata.ts (this package cannot
  // import compliance — the dependency points the other way). The previous
  // Date.UTC form mapped years 0-99 into the 1900s; the mapping happens to
  // preserve leapness for every year except 0000, so this is a correctness-of-
  // form consolidation rather than a live-bug fix.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= daysInMonth;
}

/** Parses a loss-run CSV into ClaimSnapshots plus per-row validation errors. */
export function parseLossRunCsv(text: string): LossRunParseResult {
  const { rows: grid, rowLines, warnings: csvWarnings } = parseCsv(text);
  const headers = (grid[0] ?? []).map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new ReservingError(
      "SHAPE",
      `Missing required column(s): ${missing.join(", ")}. Found: ${
        headers.filter(Boolean).join(", ") || "(none)"
      }`,
    );
  }
  const columnIndex = new Map<string, number>();
  headers.forEach((h, idx) => {
    if (!columnIndex.has(h)) columnIndex.set(h, idx);
  });

  const claims: ClaimSnapshot[] = [];
  const errors: LossRunRowError[] = [];
  for (const warning of csvWarnings) {
    // Structural CSV problems surface through the same channel as row errors:
    // partial loading is intended behavior here, silent partial loading is not.
    const lineMatch = warning.match(/line (\d+)/);
    errors.push({ row: lineMatch ? Number(lineMatch[1]) : 1, message: `CSV structure: ${warning}` });
  }

  for (let r = 1; r < grid.length; r++) {
    // Physical 1-based line in the file where this row starts — NOT r + 1:
    // blank lines and quoted embedded newlines make grid index and file line
    // diverge, and the structural-warning path above already reports physical
    // lines. One errors array, one numbering scheme.
    const rowNumber = rowLines[r]!;
    const cells = grid[r]!;
    const cell = (name: string): string => (cells[columnIndex.get(name)!] ?? "").trim();
    const rowErrors: string[] = [];

    const claimId = cell("claim_id");
    if (claimId === "") rowErrors.push("claim_id is required");

    const date = (name: string): string | null => {
      const value = cell(name);
      if (!isValidIsoDate(value)) {
        rowErrors.push(`${name} must be a real calendar date in yyyy-mm-dd form (got "${value}")`);
        return null;
      }
      return value;
    };
    const accidentDate = date("accident_date");
    const reportDate = date("report_date");
    const evaluationDate = date("evaluation_date");

    const amount = (name: string): number | null => {
      const value = cell(name);
      // Currency is decimal digits with an optional sign and fraction —
      // Number() also accepts hex (0x2710 -> 10000), binary, octal and
      // scientific notation, which silently changes magnitudes instead of
      // erroring. Formatted amounts are rejected with a pointed message
      // rather than guessed at: "1,234" could be one thousand or 1.234
      // depending on locale, and a loss run is no place to guess.
      if (/[,()]|\s/.test(value.trim()) && value.trim() !== "") {
        rowErrors.push(
          `${name} must be an unformatted decimal (got "${value}"); remove thousands separators, ` +
            "parentheses and spaces",
        );
        return null;
      }
      const n = /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : NaN;
      if (!Number.isFinite(n)) {
        rowErrors.push(`${name} must be a finite decimal number (got "${value}")`);
        return null;
      }
      return n;
    };
    const paidToDate = amount("paid_to_date");
    const caseReserve = amount("case_reserve");

    const statusRaw = cell("status").toLowerCase();
    const status: "open" | "closed" | null =
      statusRaw === "open" || statusRaw === "closed" ? statusRaw : null;
    if (status === null) {
      rowErrors.push(`status must be "open" or "closed" (got "${cell("status")}")`);
    }

    // Cross-field checks need all three dates to be individually valid.
    if (accidentDate !== null && reportDate !== null && evaluationDate !== null) {
      if (reportDate < accidentDate) rowErrors.push("report_date precedes accident_date");
      if (evaluationDate < reportDate) rowErrors.push("evaluation_date precedes report_date");
    }

    if (rowErrors.length > 0) {
      for (const message of rowErrors) errors.push({ row: rowNumber, message });
      continue;
    }
    claims.push({
      claimId,
      accidentDate: accidentDate!,
      reportDate: reportDate!,
      evaluationDate: evaluationDate!,
      paidToDate: paidToDate!,
      caseReserve: caseReserve!,
      status: status!,
    });
  }

  return { claims, errors };
}
