import Papa from "papaparse";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { ClaimSnapshot, ExposureRecord } from "@actng/core";
import { HttpError } from "./workspaceService.js";

/**
 * Loss run and exposure imports. CSV and Excel (.xlsx, first worksheet).
 *
 * Canonical loss-run columns (one row per claim per evaluation snapshot):
 *   claim_id, accident_date, report_date, evaluation_date,
 *   paid_to_date, case_reserve, status
 * Exposure columns: origin, earned_premium
 *
 * Every row is schema-validated; failures are reported with row numbers and
 * abort the import (no partial loads, no silently dropped rows).
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (yyyy-mm-dd)");

const claimRowSchema = z.object({
  claim_id: z.string().trim().min(1, "claim_id is required"),
  accident_date: isoDate,
  report_date: isoDate,
  evaluation_date: isoDate,
  paid_to_date: z.coerce.number().finite().min(0, "paid_to_date must be >= 0"),
  case_reserve: z.coerce.number().finite().min(0, "case_reserve must be >= 0"),
  status: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["open", "closed"])),
});

const exposureRowSchema = z.object({
  origin: z.string().trim().min(1, "origin is required"),
  earned_premium: z.coerce.number().finite().positive("earned_premium must be > 0"),
});

interface RawTable {
  headers: string[];
  rows: Record<string, string>[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

async function parseUpload(filename: string, buffer: Buffer): Promise<RawTable> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new HttpError(422, "EMPTY_FILE", "The workbook has no worksheets");
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = normalizeHeader(String(cell.value ?? ""));
    });
    const rows: Record<string, string>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((h, idx) => {
        if (!h) return;
        const cell = row.getCell(idx + 1).value;
        let text = "";
        if (cell instanceof Date) {
          text = cell.toISOString().slice(0, 10);
        } else if (cell !== null && cell !== undefined) {
          if (typeof cell === "object" && "result" in cell) {
            text = String((cell as { result: unknown }).result ?? "");
          } else {
            text = String(cell);
          }
        }
        record[h] = text.trim();
        if (record[h]) hasValue = true;
      });
      if (hasValue) rows.push(record);
    });
    return { headers: headers.filter(Boolean), rows };
  }

  const text = buffer.toString("utf8");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    throw new HttpError(
      422,
      "CSV_PARSE",
      `CSV parse error at row ${first.row !== undefined ? Number(first.row) + 2 : "?"}: ${first.message}`,
    );
  }
  return { headers: parsed.meta.fields ?? [], rows: parsed.data };
}

function validateRows<T>(
  table: RawTable,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  requiredColumns: string[],
): T[] {
  const missing = requiredColumns.filter((c) => !table.headers.includes(c));
  if (missing.length > 0) {
    throw new HttpError(
      422,
      "MISSING_COLUMNS",
      `Missing required column(s): ${missing.join(", ")}. Found: ${table.headers.join(", ") || "(none)"}`,
    );
  }
  if (table.rows.length === 0) {
    throw new HttpError(422, "EMPTY_FILE", "The file has a header but no data rows");
  }
  const out: T[] = [];
  const errors: string[] = [];
  table.rows.forEach((row, idx) => {
    const result = schema.safeParse(row);
    if (result.success) {
      out.push(result.data);
    } else {
      const issue = result.error.issues[0]!;
      errors.push(`row ${idx + 2}: ${issue.path.join(".")} ${issue.message}`);
    }
  });
  if (errors.length > 0) {
    const preview = errors.slice(0, 10).join("; ");
    throw new HttpError(
      422,
      "ROW_VALIDATION",
      `${errors.length} of ${table.rows.length} rows failed validation (nothing was imported): ${preview}${errors.length > 10 ? "; ..." : ""}`,
    );
  }
  return out;
}

export async function parseClaimsUpload(
  filename: string,
  buffer: Buffer,
): Promise<ClaimSnapshot[]> {
  const table = await parseUpload(filename, buffer);
  const rows = validateRows(table, claimRowSchema, [
    "claim_id",
    "accident_date",
    "report_date",
    "evaluation_date",
    "paid_to_date",
    "case_reserve",
    "status",
  ]);
  const claims: ClaimSnapshot[] = rows.map((r) => ({
    claimId: r.claim_id,
    accidentDate: r.accident_date,
    reportDate: r.report_date,
    evaluationDate: r.evaluation_date,
    paidToDate: r.paid_to_date,
    caseReserve: r.case_reserve,
    status: r.status,
  }));
  // Cross-field sanity checks.
  const problems: string[] = [];
  claims.forEach((c, idx) => {
    if (c.reportDate < c.accidentDate) {
      problems.push(`row ${idx + 2}: report_date precedes accident_date`);
    }
    if (c.evaluationDate < c.reportDate) {
      problems.push(`row ${idx + 2}: evaluation_date precedes report_date`);
    }
  });
  if (problems.length > 0) {
    throw new HttpError(
      422,
      "ROW_VALIDATION",
      `${problems.length} row(s) failed date-order checks (nothing was imported): ${problems.slice(0, 10).join("; ")}${problems.length > 10 ? "; ..." : ""}`,
    );
  }
  return claims;
}

export async function parseExposuresUpload(
  filename: string,
  buffer: Buffer,
): Promise<ExposureRecord[]> {
  const table = await parseUpload(filename, buffer);
  const rows = validateRows(table, exposureRowSchema, ["origin", "earned_premium"]);
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.origin)) {
      throw new HttpError(422, "DUPLICATE_ORIGIN", `Duplicate origin "${r.origin}" in the file`);
    }
    seen.add(r.origin);
  }
  return rows.map((r) => ({ origin: r.origin, earnedPremium: r.earned_premium }));
}
