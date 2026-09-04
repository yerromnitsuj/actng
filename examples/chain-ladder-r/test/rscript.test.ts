import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rscriptAvailable, rscriptExecutable } from "../src/rscript.js";

const original = process.env.ACTUARIAL_TS_RSCRIPT;
afterEach(() => {
  if (original === undefined) delete process.env.ACTUARIAL_TS_RSCRIPT;
  else process.env.ACTUARIAL_TS_RSCRIPT = original;
});

describe("the shared R executable convention", () => {
  it("defaults to Rscript and honors an exact path containing spaces", () => {
    delete process.env.ACTUARIAL_TS_RSCRIPT;
    expect(rscriptExecutable()).toBe("Rscript");
    const directory = mkdtempSync(join(tmpdir(), "actuarial ts r-"));
    try {
      const linked = join(directory, "R script");
      symlinkSync(process.execPath, linked);
      process.env.ACTUARIAL_TS_RSCRIPT = linked;
      expect(rscriptExecutable()).toBe(linked);
      expect(rscriptAvailable()).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports a missing configured executable as unavailable", () => {
    process.env.ACTUARIAL_TS_RSCRIPT = "/definitely/missing/Rscript";
    expect(rscriptAvailable()).toBe(false);
  });
});
