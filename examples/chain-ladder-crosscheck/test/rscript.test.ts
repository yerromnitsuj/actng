import { afterEach, describe, expect, it } from "vitest";
import { rscriptAvailable, rscriptExecutable } from "../src/rscript.js";

const original = process.env.ACTUARIAL_TS_RSCRIPT;
afterEach(() => {
  if (original === undefined) delete process.env.ACTUARIAL_TS_RSCRIPT;
  else process.env.ACTUARIAL_TS_RSCRIPT = original;
});

describe("the R executable convention", () => {
  it("defaults and fails closed for a missing configured path", () => {
    delete process.env.ACTUARIAL_TS_RSCRIPT;
    expect(rscriptExecutable()).toBe("Rscript");
    process.env.ACTUARIAL_TS_RSCRIPT = "/definitely/missing/Rscript";
    expect(rscriptExecutable()).toBe("/definitely/missing/Rscript");
    expect(rscriptAvailable()).toBe(false);
  });
});
