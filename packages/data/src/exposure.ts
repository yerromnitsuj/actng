import type { ExposureRecord } from "@actuarial-ts/core";
import { ReservingError } from "@actuarial-ts/core";
import { z } from "zod";
import { parseCsv } from "./csv.js";

/** Runtime schema for an exposure record after CSV field parsing. */
export const exposureRecordSchema = z
  .object({
    origin: z.string().trim().min(1),
    earnedPremium: z.number().finite().nullable(),
    exposureUnits: z.number().finite().nullable(),
  })
  .strict()
  .refine((record) => record.earnedPremium !== null || record.exposureUnits !== null, {
    message: "earnedPremium and exposureUnits cannot both be null",
  });

export interface ExposureRowError {
  /** 1-based physical file line where the row starts. */
  row: number;
  message: string;
}

export interface ExposureParseResult {
  exposures: ExposureRecord[];
  errors: ExposureRowError[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function optionalAmount(
  name: string,
  raw: string,
  errors: string[],
): number | null {
  const value = raw.trim();
  if (value === "") return null;
  if (/[,()]|\s/.test(value) || !/^-?\d+(\.\d+)?$/.test(value)) {
    errors.push(
      `${name} must be blank or an unformatted finite decimal (got "${raw}")`,
    );
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${name} must be blank or a finite decimal number (got "${raw}")`);
    return null;
  }
  return parsed;
}

/**
 * Parses origin-period exposure data.
 *
 * Required header: `origin`, plus at least one of `earned_premium` or
 * `exposure_units`. Either numeric field may be blank on an individual row,
 * but not both. Extra source fields (for example gross written premium or a
 * source claim count) are intentionally preserved in the caller's source file
 * and ignored here rather than relabeled as an SDK measure.
 */
export function parseExposureCsv(text: string): ExposureParseResult {
  const { rows: grid, rowLines, warnings } = parseCsv(text);
  const headers = (grid[0] ?? []).map(normalizeHeader);
  if (!headers.includes("origin")) {
    throw new ReservingError(
      "SHAPE",
      `Missing required column: origin. Found: ${headers.filter(Boolean).join(", ") || "(none)"}`,
    );
  }
  if (!headers.includes("earned_premium") && !headers.includes("exposure_units")) {
    throw new ReservingError(
      "SHAPE",
      "Exposure CSV must include earned_premium, exposure_units, or both",
    );
  }

  const columnIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!columnIndex.has(header)) columnIndex.set(header, index);
  });
  const errors: ExposureRowError[] = warnings.map((warning) => {
    const line = /line (\d+)/.exec(warning)?.[1];
    return { row: line === undefined ? 1 : Number(line), message: `CSV structure: ${warning}` };
  });
  const parsedRows: { exposure: ExposureRecord; row: number }[] = [];

  for (let index = 1; index < grid.length; index++) {
    const row = grid[index]!;
    const rowNumber = rowLines[index]!;
    const cell = (name: string): string => {
      const position = columnIndex.get(name);
      return position === undefined ? "" : (row[position] ?? "").trim();
    };
    const rowErrors: string[] = [];
    const origin = cell("origin");
    if (origin === "") rowErrors.push("origin is required");
    const earnedPremium = optionalAmount("earned_premium", cell("earned_premium"), rowErrors);
    const exposureUnits = optionalAmount("exposure_units", cell("exposure_units"), rowErrors);
    if (earnedPremium === null && exposureUnits === null && rowErrors.length === 0) {
      rowErrors.push("earned_premium and exposure_units cannot both be blank");
    }
    if (rowErrors.length > 0) {
      for (const message of rowErrors) errors.push({ row: rowNumber, message });
      continue;
    }
    const validated = exposureRecordSchema.safeParse({ origin, earnedPremium, exposureUnits });
    if (!validated.success) {
      for (const issue of validated.error.issues) {
        errors.push({ row: rowNumber, message: issue.message });
      }
      continue;
    }
    parsedRows.push({ exposure: validated.data, row: rowNumber });
  }

  const rowsByOrigin = new Map<string, { exposure: ExposureRecord; row: number }[]>();
  for (const parsed of parsedRows) {
    const sameOrigin = rowsByOrigin.get(parsed.exposure.origin);
    if (sameOrigin === undefined) rowsByOrigin.set(parsed.exposure.origin, [parsed]);
    else sameOrigin.push(parsed);
  }
  const exposures: ExposureRecord[] = [];
  for (const [origin, sameOrigin] of rowsByOrigin) {
    if (sameOrigin.length > 1) {
      for (const duplicate of sameOrigin) {
        errors.push({ row: duplicate.row, message: `duplicate origin "${origin}"` });
      }
    } else {
      exposures.push(sameOrigin[0]!.exposure);
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { exposures, errors };
}
