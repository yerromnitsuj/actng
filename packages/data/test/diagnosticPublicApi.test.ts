import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_PACKAGE_VERSION } from "../src/index.js";

describe("diagnostic data public API",()=>{
  it("keeps its runtime version synchronized",()=>{
    const manifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {version:string};
    expect(DATA_PACKAGE_VERSION).toBe(manifest.version);
  });
});
