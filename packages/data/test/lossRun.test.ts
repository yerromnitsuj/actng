import { describe, expect, it } from "vitest";
import { ReservingError } from "@actuarial-ts/core";
import { parseLossRunCsv } from "../src/lossRun.js";

const HEADER =
  "claim_id,accident_date,report_date,evaluation_date,paid_to_date,case_reserve,status";

function csv(...dataRows: string[]): string {
  return [HEADER, ...dataRows].join("\n");
}

describe("strict numeric and date forms (findings data.2, data.1)", () => {
  const header = "claim_id,accident_date,report_date,evaluation_date,status,paid_to_date,case_reserve\n";
  const row = (paid: string, accident = "2024-01-15"): string =>
    `C1,${accident},2024-03-01,2024-06-30,open,${paid},0\n`;

  it("rejects JS numeric literals that are not decimal currency", () => {
    // Number() accepts hex, binary, octal and scientific notation — "0x2710"
    // became 10,000 dollars with no complaint. Currency is decimal digits, an
    // optional sign and an optional fraction; everything else is an error the
    // author needs to see, not a silent magnitude change.
    for (const bad of ["0x2710", "0b1010", "0o17", "1e5", "Infinity"]) {
      const { claims, errors } = parseLossRunCsv(header + row(bad));
      expect(claims).toHaveLength(0);
      expect(errors.map((e) => e.message).join(" ")).toContain("paid_to_date");
    }
  });

  it("still accepts plain decimal currency, signed and fractional", () => {
    for (const good of ["100", "-50.25", "0", "12345.6"]) {
      const { claims, errors } = parseLossRunCsv(header + row(good));
      expect(errors).toHaveLength(0);
      expect(claims).toHaveLength(1);
    }
  });

  it("rejects formatted amounts with a message naming the formatting", () => {
    const { claims, errors } = parseLossRunCsv(header + row('"1,234"'));
    expect(claims).toHaveLength(0);
    expect(errors.map((e) => e.message).join(" ")).toMatch(/thousands|formatting/i);
  });

  it("validates leap days with the arithmetic rule, any century", () => {
    // 2023-02-29 does not exist; 2024-02-29 does.
    expect(parseLossRunCsv(header + row("100", "2023-02-29")).errors).toHaveLength(1);
    expect(parseLossRunCsv(header + row("100", "2024-02-29")).errors).toHaveLength(0);
  });
});

describe("parseLossRunCsv", () => {
  it("parses a clean loss run into ClaimSnapshots with no errors", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(
        "CL-1,2021-03-15,2021-04-01,2021-12-31,1000,500,open",
        "CL-1,2021-03-15,2021-04-01,2022-12-31,1800,0,closed",
        "CL-2,2022-07-04,2022-07-10,2022-12-31,0,250,open",
      ),
    );
    expect(errors).toEqual([]);
    expect(claims).toHaveLength(3);
    expect(claims[0]).toEqual({
      claimId: "CL-1",
      accidentDate: "2021-03-15",
      reportDate: "2021-04-01",
      evaluationDate: "2021-12-31",
      paidToDate: 1000,
      caseReserve: 500,
      status: "open",
    });
  });

  it("normalizes header case/whitespace and ignores extra columns", () => {
    const text = [
      "Claim ID,Accident Date,Report Date,Evaluation Date,Paid To Date,Case Reserve,Status,adjuster",
      "CL-1,2021-01-01,2021-01-02,2021-12-31,10,0,closed,Pat",
    ].join("\n");
    const { claims, errors } = parseLossRunCsv(text);
    expect(errors).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claimId).toBe("CL-1");
  });

  it("trims and lower-cases status", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,2021-01-01,2021-01-02,2021-12-31,10,0, OPEN "),
    );
    expect(errors).toEqual([]);
    expect(claims[0]!.status).toBe("open");
  });

  it("throws ReservingError SHAPE naming missing required columns", () => {
    const text = "claim_id,accident_date,paid_to_date\nCL-1,2021-01-01,10";
    let caught: unknown;
    try {
      parseLossRunCsv(text);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReservingError);
    const err = caught as ReservingError;
    expect(err.code).toBe("SHAPE");
    expect(err.message).toContain("report_date");
    expect(err.message).toContain("evaluation_date");
    expect(err.message).toContain("case_reserve");
    expect(err.message).toContain("status");
  });

  it("throws ReservingError SHAPE on empty input", () => {
    expect(() => parseLossRunCsv("")).toThrowError(ReservingError);
  });

  it("rejects a missing claim_id with the 1-based row number (header = row 1)", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(",2021-01-01,2021-01-02,2021-12-31,10,0,open"),
    );
    expect(claims).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(2);
    expect(errors[0]!.message).toContain("claim_id");
  });

  it("rejects malformed date strings", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,03/15/2021,2021-04-01,2021-12-31,10,0,open"),
    );
    expect(claims).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2 });
    expect(errors[0]!.message).toContain("accident_date");
  });

  it("rejects impossible calendar dates (2021-02-30, month 13)", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(
        "CL-1,2021-02-30,2021-04-01,2021-12-31,10,0,open",
        "CL-2,2021-01-01,2021-13-01,2021-12-31,10,0,open",
      ),
    );
    expect(claims).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it("accepts leap-day dates only in leap years", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(
        "CL-1,2024-02-29,2024-03-01,2024-12-31,10,0,open",
        "CL-2,2023-02-29,2023-03-01,2023-12-31,10,0,open",
      ),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claimId).toBe("CL-1");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(3);
  });

  it("rejects non-finite and non-numeric amounts", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(
        "CL-1,2021-01-01,2021-01-02,2021-12-31,abc,0,open",
        "CL-2,2021-01-01,2021-01-02,2021-12-31,10,Infinity,open",
        "CL-3,2021-01-01,2021-01-02,2021-12-31,10,,open",
      ),
    );
    expect(claims).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(errors[0]!.message).toContain("paid_to_date");
    expect(errors[1]!.message).toContain("case_reserve");
    expect(errors[2]!.message).toContain("case_reserve");
  });

  it("rejects an unknown status", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,2021-01-01,2021-01-02,2021-12-31,10,0,pending"),
    );
    expect(claims).toHaveLength(0);
    expect(errors).toEqual([
      { row: 2, message: expect.stringContaining("status") },
    ]);
  });

  it("rejects report_date before accident_date", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,2021-06-01,2021-05-31,2021-12-31,10,0,open"),
    );
    expect(claims).toHaveLength(0);
    expect(errors).toEqual([
      { row: 2, message: "report_date precedes accident_date" },
    ]);
  });

  it("rejects evaluation_date before report_date", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,2021-01-01,2021-06-01,2021-05-31,10,0,open"),
    );
    expect(claims).toHaveLength(0);
    expect(errors).toEqual([
      { row: 2, message: "evaluation_date precedes report_date" },
    ]);
  });

  it("collects errors from bad rows while keeping good rows", () => {
    const { claims, errors } = parseLossRunCsv(
      csv(
        "CL-1,2021-01-01,2021-01-02,2021-12-31,10,0,open",
        "CL-2,2021-01-01,2021-01-02,2021-12-31,oops,0,open",
        "CL-3,2021-01-01,2021-01-02,2021-12-31,10,0,closed",
      ),
    );
    expect(claims.map((c) => c.claimId)).toEqual(["CL-1", "CL-3"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(3);
  });

  it("reports every field error on a multi-problem row", () => {
    const { claims, errors } = parseLossRunCsv(
      csv("CL-1,2021-01-01,2021-01-02,2021-12-31,oops,nope,maybe"),
    );
    expect(claims).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([2, 2, 2]);
  });

  it("treats short (ragged) rows as missing-field errors, not crashes", () => {
    const { claims, errors } = parseLossRunCsv(csv("CL-1,2021-01-01"));
    expect(claims).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.row === 2)).toBe(true);
  });
});

describe("row numbers are physical file lines (finding: blank-line desync)", () => {
  // Line 1 = HEADER, line 2 = a valid C1 row, line 3 = blank (skipped from the
  // grid but not from the physical line count), line 4 = a C2 row with a bad
  // paid_to_date.
  const blankLineText = [
    HEADER,
    "C1,2021-01-01,2021-01-02,2021-12-31,10,0,open",
    "",
    "C2,2021-01-01,2021-01-02,2021-12-31,bad,0,open",
  ].join("\n");

  it("cell errors after an interior blank line cite the physical line", () => {
    const { claims, errors } = parseLossRunCsv(blankLineText);
    expect(claims.map((c) => c.claimId)).toEqual(["C1"]);
    expect(errors).toEqual([
      { row: 4, message: expect.stringContaining("paid_to_date") },
    ]);
  });

  it("blank lines never affect which claims load", () => {
    // Diagnostics-only property: this must pass both before and after the
    // fix — it pins that the bug is purely about the reported row number,
    // never about which rows load.
    const { claims } = parseLossRunCsv(blankLineText);
    expect(claims).toHaveLength(1);
  });

  it("structural warnings and cell errors agree on one physical numbering", () => {
    // Line 1 = HEADER, line 2 = blank, line 3 = a C3 row with a bad
    // paid_to_date, line 4 = a C4 row with an unterminated quoted field
    // (consumes the rest of the input into one ragged row).
    const text = [
      HEADER,
      "",
      "C3,2021-01-01,2021-01-02,2021-12-31,bad,0,open",
      'C4,2021-01-01,2021-01-02,2021-12-31,"100,50,open',
    ].join("\n");
    const { errors } = parseLossRunCsv(text);

    const [structuralError, c3PaidError, ...c4Errors] = errors;
    expect(structuralError).toBeDefined();
    expect(structuralError!.message).toContain("CSV structure");
    expect(structuralError!.row).toBe(4);

    expect(c3PaidError).toBeDefined();
    expect(c3PaidError!.message).toContain("paid_to_date");
    expect(c3PaidError!.row).toBe(3);

    expect(c4Errors.length).toBeGreaterThan(0);
    expect(c4Errors.every((e) => e.row === 4)).toBe(true);
  });

  it("a quoted multiline extra column does not shift later rows' numbers", () => {
    // Line 1 = HEADER + an extra "note" column, lines 2-3 = a valid C1 row
    // whose note field is a quoted, embedded-newline value spanning two
    // physical lines, line 4 = a C2 row with a bad paid_to_date.
    const text =
      `${HEADER},note\n` +
      'C1,2021-01-01,2021-01-02,2021-12-31,10,0,open,"l1\nl2"\n' +
      "C2,2021-01-01,2021-01-02,2021-12-31,bad,0,open";
    const { claims, errors } = parseLossRunCsv(text);
    expect(claims.map((c) => c.claimId)).toEqual(["C1"]);
    expect(errors).toEqual([
      { row: 4, message: expect.stringContaining("paid_to_date") },
    ]);
  });
});
