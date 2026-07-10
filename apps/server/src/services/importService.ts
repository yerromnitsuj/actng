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

/** An optional positive numeric cell: blank/absent -> undefined, else > 0. */
const optionalPositiveCell = (label: string) =>
  z.preprocess(
    (v) =>
      v === undefined || v === null || String(v).trim() === ""
        ? undefined
        : Number(String(v).replace(/,/g, "")),
    z
      .number({ invalid_type_error: `${label} must be a number` })
      .finite()
      .positive(`${label} must be > 0`)
      .optional(),
  );

const exposureRowSchema = z
  .object({
    origin: z.string().trim().min(1, "origin is required"),
    earned_premium: optionalPositiveCell("earned_premium"),
    exposure_units: optionalPositiveCell("exposure_units"),
  })
  .refine((r) => r.earned_premium !== undefined || r.exposure_units !== undefined, {
    message: "each row needs earned_premium and/or exposure_units",
  });

interface RawTable {
  headers: string[];
  rows: Record<string, string>[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Hard ceiling on data rows per import (guards decompression bombs too). */
const MAX_IMPORT_ROWS = 250_000;

async function parseUpload(filename: string, buffer: Buffer): Promise<RawTable> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
    throw new HttpError(
      422,
      "UNSUPPORTED_FORMAT",
      "Legacy .xls workbooks are not supported; save the file as .xlsx or CSV and re-import",
    );
  }
  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      throw new HttpError(
        422,
        "BAD_EXCEL",
        `Could not read the workbook (${err instanceof Error ? err.message : "corrupt or unsupported file"}); save as .xlsx or CSV and re-import`,
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new HttpError(422, "EMPTY_FILE", "The workbook has no worksheets");
    if (sheet.rowCount > MAX_IMPORT_ROWS) {
      throw new HttpError(
        422,
        "TOO_MANY_ROWS",
        `The worksheet has ${sheet.rowCount.toLocaleString()} rows; the import limit is ${MAX_IMPORT_ROWS.toLocaleString()}`,
      );
    }
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
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      422,
      "TOO_MANY_ROWS",
      `The file has ${parsed.data.length.toLocaleString()} rows; the import limit is ${MAX_IMPORT_ROWS.toLocaleString()}`,
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
  if (!table.headers.includes("earned_premium") && !table.headers.includes("exposure_units")) {
    throw new HttpError(
      422,
      "MISSING_COLUMNS",
      `Exposure files need an origin column plus earned_premium (loss-ratio method) and/or exposure_units (pure-premium method). Found: ${table.headers.join(", ") || "(none)"}`,
    );
  }
  const rows = validateRows(table, exposureRowSchema, ["origin"]);
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.origin)) {
      throw new HttpError(422, "DUPLICATE_ORIGIN", `Duplicate origin "${r.origin}" in the file`);
    }
    seen.add(r.origin);
  }
  return rows.map((r) => ({
    origin: r.origin,
    earnedPremium: r.earned_premium ?? null,
    exposureUnits: r.exposure_units ?? null,
  }));
}

const numericCell = (label: string) =>
  z.preprocess(
    (v) => Number(String(v).replace(/,/g, "")),
    z.number({ invalid_type_error: `${label} must be a number` }).positive(`${label} must be positive`),
  );

const ilfRowSchema = z.object({
  limit: numericCell("limit"),
  factor: numericCell("factor"),
});

const rateChangeRowSchema = z.object({
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effective_date must be yyyy-mm-dd"),
  rate_change: numericCell("rate_change").refine((v) => v > -1, {
    message: "rate_change must be greater than -1 (-100%)",
  }),
});

/** Parses a rate-change history upload: CSV/Excel with columns effective_date, rate_change (decimal, 0.05 = +5%). */
export async function parseRateHistoryUpload(
  filename: string,
  buffer: Buffer,
): Promise<{ effectiveDate: string; change: number }[]> {
  const table = await parseUpload(filename, buffer);
  const rows = validateRows(table, rateChangeRowSchema, ["effective_date", "rate_change"]);
  if (rows.length === 0) {
    throw new HttpError(422, "NO_ROWS", "The rate-history file has no data rows");
  }
  return rows
    .map((r) => ({ effectiveDate: r.effective_date, change: r.rate_change }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/** Parses an ILF table upload: CSV/Excel with columns limit, factor. */
export async function parseIlfTableUpload(
  filename: string,
  buffer: Buffer,
): Promise<{ limit: number; factor: number }[]> {
  const table = await parseUpload(filename, buffer);
  const rows = validateRows(table, ilfRowSchema, ["limit", "factor"]);
  if (rows.length < 2) {
    throw new HttpError(422, "BAD_TABLE", "An ILF table needs at least two limit/factor rows");
  }
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.limit)) {
      throw new HttpError(422, "BAD_TABLE", `Duplicate limit ${r.limit.toLocaleString()} in the file`);
    }
    seen.add(r.limit);
  }
  return rows.map((r) => ({ limit: r.limit, factor: r.factor }));
}
