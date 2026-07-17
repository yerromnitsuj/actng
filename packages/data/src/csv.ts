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

/** Parses CSV text into a grid of string fields (rows x columns). */
export function parseCsv(text: string): string[][] {
  let s = text;
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

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
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
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
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush a final row that has no trailing newline. An unterminated quoted
  // field flushes with whatever content it accumulated (lenient by design).
  endRow();
  return rows;
}
