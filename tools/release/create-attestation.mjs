import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packages = ["core", "interchange", "data", "compliance", "agents"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=all") !== "")
  throw new Error("release attestation requires a clean Git tree");
const gitSha = git("rev-parse", "HEAD");
const releaseDir = path.join(root, ".release");
const tarballDir = path.join(releaseDir, "tarballs");
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(tarballDir, { recursive: true });
const packageEvidence = {};
for (const workspace of packages) {
  const directory = path.join(root, "packages", workspace);
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const output = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        directory,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        tarballDir,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const filename = output[0].filename;
  packageEvidence[manifest.name] = {
    version: manifest.version,
    filename,
    sha256: sha256(readFileSync(path.join(tarballDir, filename))),
  };
}
const versions = new Set(
  Object.values(packageEvidence).map((item) => item.version),
);
if (versions.size !== 1)
  throw new Error("release packages are not lockstep-versioned");
const attestation = {
  attestationVersion: 1,
  version: [...versions][0],
  gitSha,
  cleanTree: true,
  commandManifestSha256: sha256(
    readFileSync(path.join(root, "tools/release/release-commands.json")),
  ),
  sourceReconciliationManifestSha256: sha256(
    readFileSync(
      path.join(root, "tools/validation/source-reconciliation.json"),
    ),
  ),
  packages: packageEvidence,
};
writeFileSync(
  path.join(releaseDir, "attestation.json"),
  `${JSON.stringify(attestation, null, 2)}\n`,
);
console.log(
  `release attestation created for ${attestation.version} at ${gitSha}`,
);
