import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_PACKAGE_VERSION, type DataFindingContext } from "../src/index.js";

// @ts-expect-error Generalized contexts have explicit age/unit, never legacy ageMonths.
const removedContext: DataFindingContext = { ageMonths: 12 };
void removedContext;

describe("diagnostic data public API", () => {
  it("keeps its runtime version synchronized", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(DATA_PACKAGE_VERSION).toBe(manifest.version);
  });
});
