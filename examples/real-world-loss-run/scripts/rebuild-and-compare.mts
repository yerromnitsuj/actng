import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE } from "../src/sourceManifest.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(
  resolve(tmpdir(), "actuarial-ts-source-rebuild-"),
);
try {
  const compact = resolve(temporary, "data");
  const full = resolve(temporary, "generated");
  const rscript = process.env.ACTUARIAL_TS_RSCRIPT ?? "Rscript";
  const rebuilt = spawnSync(
    rscript,
    [
      resolve(root, "scripts/transform-source.R"),
      resolve(root, ".cache/freclaimset2motor.rda"),
      compact,
      full,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (rebuilt.error) throw rebuilt.error;
  if (rebuilt.status !== 0)
    throw new Error(
      `source rebuild failed (${rebuilt.status}): ${rebuilt.stderr}`,
    );
  for (const derivative of SOURCE.derivatives) {
    const [committed, candidate] = await Promise.all([
      readFile(resolve(root, derivative.path)),
      readFile(resolve(temporary, derivative.path)),
    ]);
    if (!committed.equals(candidate))
      throw new Error(
        `${derivative.path}: source rebuild differs from committed derivative`,
      );
  }
  console.log(
    `real-world source rebuild: ${SOURCE.derivatives.length} derivatives are byte-identical`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
