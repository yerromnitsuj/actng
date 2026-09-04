import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const attestation = JSON.parse(
  readFileSync(path.join(root, ".release/attestation.json"), "utf8"),
);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (
  !attestation.cleanTree ||
  git("status", "--porcelain", "--untracked-files=all") !== ""
)
  throw new Error("release attestation is invalid: Git tree is dirty");
if (git("rev-parse", "HEAD") !== attestation.gitSha)
  throw new Error("release attestation is invalid: Git SHA changed");
for (const [file, expected] of [
  ["tools/release/release-commands.json", attestation.commandManifestSha256],
  [
    "tools/validation/source-reconciliation.json",
    attestation.sourceReconciliationManifestSha256,
  ],
]) {
  if (sha256(readFileSync(path.join(root, file))) !== expected)
    throw new Error(`release attestation is invalid: ${file} changed`);
}
const packageName = process.argv[2] ?? process.env.npm_package_name;
if (typeof packageName !== "string" || !(packageName in attestation.packages))
  throw new Error(
    `release attestation has no evidence for ${packageName ?? "this package"}`,
  );
const evidence = attestation.packages[packageName];
const workspace = packageName.slice("@actuarial-ts/".length);
const directory = path.join(root, "packages", workspace);
const manifest = JSON.parse(
  readFileSync(path.join(directory, "package.json"), "utf8"),
);
if (
  manifest.version !== attestation.version ||
  manifest.version !== evidence.version
)
  throw new Error("release attestation is invalid: package version changed");
const temporary = mkdtempSync(path.join(tmpdir(), "actuarial-ts-pack-"));
try {
  const output = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        directory,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporary,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const actual = sha256(readFileSync(path.join(temporary, output[0].filename)));
  if (actual !== evidence.sha256)
    throw new Error(
      "release attestation is invalid: packed package bytes changed",
    );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log(
  `release attestation verified for ${packageName}@${manifest.version}`,
);
