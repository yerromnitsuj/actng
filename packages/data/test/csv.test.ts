import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3").rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parses quoted fields", () => {
    expect(parseCsv('"a","b"\n"1","2"').rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"say ""hi""",x').rows).toEqual([['say "hi"', "x"]]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('"1,234",b').rows).toEqual([["1,234", "b"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line1\nline2",b\nc,d').rows).toEqual([
      ["line1\nline2", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps CRLF inside quoted fields verbatim", () => {
    expect(parseCsv('"a\r\nb",c').rows).toEqual([["a\r\nb", "c"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF row endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("tolerates a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips completely empty lines", () => {
    expect(parseCsv("a,b\n\n\r\n1,2\n").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not skip lines that are empty only after quote removal", () => {
    expect(parseCsv('a\n""\nb').rows).toEqual([["a"], [""], ["b"]]);
  });

  it("does not skip lines of empty fields separated by commas", () => {
    expect(parseCsv("a,b\n,\n1,2").rows).toEqual([
      ["a", "b"],
      ["", ""],
      ["1", "2"],
    ]);
  });

  it("preserves ragged rows as-is (validation is the caller's job)", () => {
    expect(parseCsv("a,b,c\n1\nx,y").rows).toEqual([
      ["a", "b", "c"],
      ["1"],
      ["x", "y"],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(parseCsv("").rows).toEqual([]);
    expect(parseCsv("\n\n").rows).toEqual([]);
  });
});

describe("unterminated quoted fields", () => {
  it("warns with the starting line instead of silently swallowing the file", () => {
    // One stray opening quote used to consume the remainder of the input into
    // a single field: five valid rows became zero claims with three misleading
    // per-field errors downstream. The parser knows inQuotes at EOF; saying
    // nothing was the bug.
    const text = 'id,paid\n1,100\n2,"250\n3,300\n4,400';
    const { rows, warnings } = parseCsv(text);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unterminated quoted field");
    expect(warnings[0]).toContain("line 3");
    // Lenient content behavior is unchanged: the field carries what it saw.
    expect(rows[0]).toEqual(["id", "paid"]);
    expect(rows[1]).toEqual(["1", "100"]);
  });

  it("emits no warnings for clean input", () => {
    expect(parseCsv("a,b\n1,2").warnings).toEqual([]);
  });
});
