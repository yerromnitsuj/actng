import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parses quoted fields", () => {
    expect(parseCsv('"a","b"\n"1","2"')).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', "x"]]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('"1,234",b')).toEqual([["1,234", "b"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line1\nline2",b\nc,d')).toEqual([
      ["line1\nline2", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps CRLF inside quoted fields verbatim", () => {
    expect(parseCsv('"a\r\nb",c')).toEqual([["a\r\nb", "c"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF row endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("tolerates a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips completely empty lines", () => {
    expect(parseCsv("a,b\n\n\r\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not skip lines that are empty only after quote removal", () => {
    expect(parseCsv('a\n""\nb')).toEqual([["a"], [""], ["b"]]);
  });

  it("does not skip lines of empty fields separated by commas", () => {
    expect(parseCsv("a,b\n,\n1,2")).toEqual([
      ["a", "b"],
      ["", ""],
      ["1", "2"],
    ]);
  });

  it("preserves ragged rows as-is (validation is the caller's job)", () => {
    expect(parseCsv("a,b,c\n1\nx,y")).toEqual([
      ["a", "b", "c"],
      ["1"],
      ["x", "y"],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});
