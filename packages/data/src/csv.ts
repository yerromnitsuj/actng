/**
 * Minimal RFC 4180-subset CSV parser.
 *
 * Supported: comma delimiter, quoted fields, doubled quotes ("") as escaped
 * quotes inside quoted fields, commas and newlines inside quoted fields,
 * CRLF and LF row endings, a leading UTF-8 BOM, and a tolerated trailing
 * newline. Lines that are completely empty outside quotes are skipped.
 *
 * Deliberately NOT here: header handling, type coercion, and shape
 * validation. Ragged rows are preserved as-is — validation is the caller's
 * job (see lossRun.ts).
 */

export interface CsvParseResult {
  /** The parsed grid (rows x columns). Ragged rows preserved as-is. */
  rows: string[][];
  /**
   * Structural problems the parser recovered from. Content is still parsed
   * leniently — a warning here means the OUTPUT may not mean what the file's
   * author intended, which the caller must surface rather than swallow: an
   * unterminated quote consumes the remainder of the input into one field,
   * and five good rows silently becoming one is how claims vanish.
   */
  warnings: string[];
}

/** Parses CSV text into a grid of string fields plus structural warnings. */
export function parseCsv(text: string): CsvParseResult {
  let s = text;
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const rows: string[][] = [];
  const warnings: string[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let quoteOpenedAtLine = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    // A line with zero characters outside quotes is skipped; a line like
    // `""` or `,` still produces a row.
    if (row.length === 0 && field === "" && !fieldWasQuoted) return;
    endField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
      quoteOpenedAtLine = line;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (s[i + 1] === "\n") i++;
      endRow();
      line++;
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      line++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush a final row that has no trailing newline. An unterminated quoted
  // field still flushes with whatever it accumulated — content stays lenient —
  // but the structural problem is REPORTED: everything after the stray quote
  // was consumed into one field, and the caller must not present that output
  // as a faithful read of the file.
  if (inQuotes) {
    warnings.push(
      `unterminated quoted field starting at line ${quoteOpenedAtLine}: the remainder of the ` +
        "input was consumed into a single field; check the file for a stray or unescaped quote",
    );
  }
  endRow();
  return { rows, warnings };
}
