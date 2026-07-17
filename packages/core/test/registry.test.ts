import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AVERAGE_KEYS,
  DEFAULT_AVERAGES,
  RESERVING_ERROR_CODES,
  ReservingError,
} from "../src/index.js";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

describe("public registries", () => {
  it("RESERVING_ERROR_CODES matches every code constructed in source", () => {
    // Self-enforcing: a new `new ReservingError("X", ...)` in any module fails
    // this test until X is added to the registry (and vice versa for stale
    // registry entries with no constructor site).
    const found = new Set<string>();
    for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith(".ts"))) {
      const text = fs.readFileSync(path.join(srcDir, f), "utf8");
      for (const m of text.matchAll(/new ReservingError\(\s*"([A-Z0-9_]+)"/g)) {
        found.add(m[1]!);
      }
    }
    expect([...found].sort()).toEqual([...RESERVING_ERROR_CODES].sort());
  });

  it("ReservingError carries a registered, typed code", () => {
    const err = new ReservingError("NO_DATA", "probe");
    expect(err.code).toBe("NO_DATA");
    expect(RESERVING_ERROR_CODES).toContain(err.code);
    expect(err.name).toBe("ReservingError");
  });

  it("AVERAGE_KEYS matches the default averages menu exactly", () => {
    expect([...DEFAULT_AVERAGES.map((a) => a.key)].sort()).toEqual([...AVERAGE_KEYS].sort());
  });
});
