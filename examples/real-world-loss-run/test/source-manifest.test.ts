import { describe, expect, it } from "vitest";
import { registerSourceFile } from "../../../tools/validation/source-contract.js";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { SOURCE } from "../src/sourceManifest.js";
import {
  verifyCommittedDerivatives,
  verifyDerivative,
} from "../scripts/verify-derivatives.mjs";
registerSourceFile(import.meta.url);

describe("committed real-world source evidence", () => {
  it("verifies a clean checkout containing only the seven committed CSVs", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "actuarial-derivatives-"));
    try {
      await cp(
        fileURLToPath(new URL("../data", import.meta.url)),
        resolve(root, "data"),
        { recursive: true },
      );
      expect(await verifyCommittedDerivatives(root)).toBe(7);
      await writeFile(resolve(root, "data/extra.csv"), "unregistered\n1\n");
      await expect(verifyCommittedDerivatives(root)).rejects.toThrow(
        "exactly one derivative manifest entry",
      );
      await rm(resolve(root, "data/extra.csv"));
      await rm(resolve(root, "data/net-paid.csv"));
      await expect(verifyCommittedDerivatives(root)).rejects.toThrow(
        "exactly one derivative manifest entry",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects changes to bytes, row counts, and column schemas independently", async () => {
    const item = SOURCE.derivatives[0]!;
    const bytes = await readFile(new URL(`../${item.path}`, import.meta.url));
    expect(() =>
      verifyDerivative(item, Buffer.concat([bytes, Buffer.from("\n")])),
    ).toThrow("derivative bytes");
    expect(() =>
      verifyDerivative({ ...item, rowCount: item.rowCount + 1 }, bytes),
    ).toThrow("expected 211 rows");
    expect(() =>
      verifyDerivative({ ...item, columns: ["different"] }, bytes),
    ).toThrow("column schema");
  });
});
