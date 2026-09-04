import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runMack, type Triangle } from "../src/index.js";
import {
  registerSourceFile,
  sourceExpected,
} from "../../../tools/validation/source-contract.js";

registerSourceFile(import.meta.url);
const directory = new URL(
  "../../../interop/conformance/fixtures/mortgage/",
  import.meta.url,
);
const fixture = sourceExpected<
  typeof import("../../../interop/conformance/fixtures/mortgage/mack-1999-tail.json")
>("mack-1999-tail", "threeShoreFixture");
const document = JSON.parse(
  readFileSync(new URL(fixture.triangle, directory), "utf8"),
);

describe("Mack 1999 three-shore tail fixture", () => {
  it("reproduces the frozen engine result and printed Table 2 precision", () => {
    expect(document.integrity).toBe(fixture.triangleIntegrity);
    const triangle: Triangle = {
      kind: "paid",
      origins: document.triangle.origins.map(
        (origin: { label: string }) => origin.label,
      ),
      ages: document.triangle.agesMonths,
      values: document.triangle.values,
    };
    const result = runMack(triangle, fixture.options);
    for (const [index, row] of result.rows.entries()) {
      expect(
        Math.abs(row.ultimate - fixture.engine.ultimate[index]!),
      ).toBeLessThanOrEqual(fixture.tolerances.engineAbsolute);
      expect(
        Math.abs(row.standardError - fixture.engine.standardError[index]!),
      ).toBeLessThanOrEqual(fixture.tolerances.engineAbsolute);
      expect(
        Math.abs(
          row.ultimate / 1000 - fixture.publishedThousands.ultimate[index]!,
        ),
      ).toBeLessThanOrEqual(fixture.tolerances.publishedUltimateThousands);
      expect(
        Math.abs(
          row.standardError / 1000 -
            fixture.publishedThousands.standardError[index]!,
        ),
      ).toBeLessThanOrEqual(fixture.tolerances.publishedStandardErrorThousands);
    }
    expect(
      Math.abs(result.totals.ultimate - fixture.engine.totalUltimate),
    ).toBeLessThanOrEqual(fixture.tolerances.engineAbsolute);
    expect(
      Math.abs(result.totals.standardError - fixture.engine.totalStandardError),
    ).toBeLessThanOrEqual(fixture.tolerances.engineAbsolute);
    expect(
      Math.abs(
        result.totals.ultimate / 1000 -
          fixture.publishedThousands.totalUltimate,
      ),
    ).toBeLessThanOrEqual(fixture.tolerances.publishedTotalUltimateThousands);
    expect(
      Math.abs(
        result.totals.standardError / 1000 -
          fixture.publishedThousands.totalStandardError,
      ),
    ).toBeLessThanOrEqual(fixture.tolerances.publishedStandardErrorThousands);
  });
});
