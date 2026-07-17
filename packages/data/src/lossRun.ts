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
 * Row numbers in errors are 1-based INCLUDING the header row, so the first
 * data row is row 2.
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
  /** 1-based row number including the header (first data row = 2). */
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
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** Parses a loss-run CSV into ClaimSnapshots plus per-row validation errors. */
export function parseLossRunCsv(text: string): LossRunParseResult {
  const grid = parseCsv(text);
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

  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1; // 1-based including the header row
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
      const n = value === "" ? NaN : Number(value);
      if (!Number.isFinite(n)) {
        rowErrors.push(`${name} must be a finite number (got "${value}")`);
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
