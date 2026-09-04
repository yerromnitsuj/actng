import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE } from "../src/sourceManifest.js";
import {
  verifyCommittedDerivatives,
  verifyDerivative,
} from "./verify-derivatives.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(
  resolve(tmpdir(), "actuarial-ts-source-rebuild-"),
);
try {
  await verifyCommittedDerivatives(root);
  const archivePath = resolve(root, ".cache/freclaimset2motor.rda");
  const archive = await readFile(archivePath);
  if (
    archive.byteLength !== SOURCE.sourceByteLength ||
    createHash("sha256").update(archive).digest("hex") !== SOURCE.sourceSha256
  )
    throw new Error(
      "Raw source archive does not match the pinned SHA-256 and byte length",
    );
  const compact = resolve(temporary, "data");
  const full = resolve(temporary, "generated");
  const rscript = process.env.ACTUARIAL_TS_RSCRIPT ?? "Rscript";
  const rebuilt = spawnSync(
    rscript,
    [resolve(root, "scripts/transform-source.R"), archivePath, compact, full],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (rebuilt.error) throw rebuilt.error;
  if (rebuilt.status !== 0)
    throw new Error(
      `source rebuild failed (${rebuilt.status}): ${rebuilt.stderr}`,
    );
  for (const derivative of SOURCE.derivatives) {
    const candidate = await readFile(resolve(temporary, derivative.path));
    verifyDerivative(derivative, candidate);
    if (
      derivative.path.startsWith("data/") &&
      !(await readFile(resolve(root, derivative.path))).equals(candidate)
    )
      throw new Error(
        `${derivative.path}: source rebuild differs from committed derivative`,
      );
  }
  console.log(
    `real-world source rebuild: ${SOURCE.derivatives.length} manifest hashes match; all committed derivatives are byte-identical`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
