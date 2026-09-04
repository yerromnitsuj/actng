import { describe, expect, it } from "vitest";
import { ReservingError } from "@actuarial-ts/core";
import { parseExposureCsv } from "../src/exposure.js";

describe("parseExposureCsv", () => {
  it("parses earned premium and exposure units independently", () => {
    const result = parseExposureCsv(
      "origin,earned_premium,exposure_units\n" +
        "2022,100000,1200\n" +
        "2023,,1250\n" +
        "2024,110000,\n",
    );

    expect(result.errors).toEqual([]);
    expect(result.exposures).toEqual([
      { origin: "2022", earnedPremium: 100000, exposureUnits: 1200 },
      { origin: "2023", earnedPremium: null, exposureUnits: 1250 },
      { origin: "2024", earnedPremium: 110000, exposureUnits: null },
    ]);
  });

  it("ignores explicitly retained source measures rather than relabeling them", () => {
    const result = parseExposureCsv(
      "origin,exposure_units,gross_written_premium,source_claim_count\n1995,148600,25700000,26775\n",
    );
    expect(result).toEqual({
      exposures: [
        { origin: "1995", earnedPremium: null, exposureUnits: 148600 },
      ],
      errors: [],
    });
  });

  it("reports malformed rows without partially interpreting their amounts", () => {
    const result = parseExposureCsv(
      'origin,earned_premium,exposure_units\n2022,"1,000",10\n2023,,\n,100,10\n',
    );
    expect(result.exposures).toEqual([]);
    expect(result.errors).toEqual([
      {
        row: 2,
        message:
          'earned_premium must be blank or an unformatted finite decimal (got "1,000")',
      },
      {
        row: 3,
        message: "earned_premium and exposure_units cannot both be blank",
      },
      { row: 4, message: "origin is required" },
    ]);
  });

  it("rejects all records for a duplicated origin", () => {
    const result = parseExposureCsv(
      "origin,exposure_units\n2022,100\n2022,200\n2023,300\n",
    );
    expect(result.exposures).toEqual([
      { origin: "2023", earnedPremium: null, exposureUnits: 300 },
    ]);
    expect(result.errors).toEqual([
      { row: 2, message: 'duplicate origin "2022"' },
      { row: 3, message: 'duplicate origin "2022"' },
    ]);
  });

  it("requires origin and at least one supported exposure measure", () => {
    expect(() => parseExposureCsv("exposure_units\n100\n")).toThrow(
      ReservingError,
    );
    expect(() =>
      parseExposureCsv("origin,gross_written_premium\n2022,100\n"),
    ).toThrow(/earned_premium, exposure_units, or both/);
  });

  it("rejects duplicate normalized headers", () => {
    expect(() =>
      parseExposureCsv("origin,exposure_units,Exposure Units\n2022,100,999\n"),
    ).toThrow(/Duplicate normalized column\(s\): exposure_units/);
  });
});
