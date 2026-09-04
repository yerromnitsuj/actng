import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const workspaces = [
  "core",
  "interchange",
  "data",
  "compliance",
  "agents",
];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const commandManifestPath = "tools/release/release-commands.json";
const sourceManifestPath = "tools/validation/source-reconciliation.json";
const hashFile = (root, file) => sha256(readFileSync(path.join(root, file)));
const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export function cleanSourceSha(root) {
  if (git(root, "status", "--porcelain", "--untracked-files=all") !== "")
    throw new Error("release evidence requires a clean Git tree");
  return git(root, "rev-parse", "HEAD");
}

export function readCommands(root) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, commandManifestPath), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.commands) ||
    manifest.commands.length === 0 ||
    manifest.commands.some(
      (c) => typeof c !== "string" || !c.trim() || /[\r\n]/.test(c),
    )
  )
    throw new Error("invalid release command manifest");
  return manifest.commands;
}

export function packWorkspace(root, workspace, destination) {
  const directory = path.join(root, "packages", workspace);
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        directory,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        destination,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  return {
    name: manifest.name,
    version: manifest.version,
    filename: packed.filename,
    sha256: hashFile(destination, packed.filename),
  };
}

function validateExecution(execution, commands) {
  if (
    !execution ||
    !Array.isArray(execution.phases) ||
    execution.phases.length !== commands.length
  )
    throw new Error("release evidence is incomplete: missing gate phases");
  for (const [i, command] of commands.entries()) {
    const phase = execution.phases[i];
    if (phase?.command !== command || phase.exitCode !== 0)
      throw new Error(`release evidence is incomplete: phase ${i + 1}`);
  }
}

/** Invoked by the gate controller only after its complete successful execution. */
export function createAttestation(root, execution) {
  const commands = readCommands(root);
  if (execution.gitSha !== cleanSourceSha(root))
    throw new Error("source SHA changed during release gate");
  if (execution.commandManifestSha256 !== hashFile(root, commandManifestPath))
    throw new Error("command manifest changed during release gate");
  validateExecution(execution, commands);
  const directory = path.join(root, ".release");
  const tarballs = path.join(directory, "tarballs");
  mkdirSync(tarballs, { recursive: true });
  const packages = {};
  for (const workspace of workspaces) {
    const { name, ...evidence } = packWorkspace(root, workspace, tarballs);
    if (name !== `@actuarial-ts/${workspace}`)
      throw new Error("unexpected package name");
    packages[name] = evidence;
  }
  const versions = new Set(Object.values(packages).map((p) => p.version));
  if (versions.size !== 1)
    throw new Error("release packages are not lockstep-versioned");
  const attestation = {
    attestationVersion: 2,
    version: [...versions][0],
    gitSha: execution.gitSha,
    cleanTree: true,
    commandManifestSha256: execution.commandManifestSha256,
    sourceReconciliationManifestSha256: hashFile(root, sourceManifestPath),
    execution,
    packages,
  };
  if (cleanSourceSha(root) !== execution.gitSha)
    throw new Error("source SHA changed while packing release archives");
  writeFileSync(
    path.join(directory, "attestation.json"),
    `${JSON.stringify(attestation, null, 2)}\n`,
  );
  return attestation;
}

export function verifyAttestation(root, packageName, { repack = true } = {}) {
  const attestation = JSON.parse(
    readFileSync(path.join(root, ".release/attestation.json"), "utf8"),
  );
  if (
    attestation.attestationVersion !== 2 ||
    attestation.cleanTree !== true ||
    typeof attestation.version !== "string" ||
    !/^[0-9a-f]{40}$/.test(attestation.gitSha)
  )
    throw new Error("invalid release attestation structure");
  if (cleanSourceSha(root) !== attestation.gitSha)
    throw new Error("release attestation is stale: Git SHA changed");
  for (const [file, expected] of [
    [commandManifestPath, attestation.commandManifestSha256],
    [sourceManifestPath, attestation.sourceReconciliationManifestSha256],
  ]) {
    if (hashFile(root, file) !== expected)
      throw new Error(`release attestation is stale: ${file} changed`);
  }
  if (
    attestation.execution?.gitSha !== attestation.gitSha ||
    attestation.execution?.commandManifestSha256 !==
      attestation.commandManifestSha256
  )
    throw new Error("release execution identity mismatch");
  validateExecution(attestation.execution, readCommands(root));
  const names = workspaces.map((w) => `@actuarial-ts/${w}`);
  if (
    !attestation.packages ||
    JSON.stringify(Object.keys(attestation.packages).sort()) !==
      JSON.stringify([...names].sort())
  )
    throw new Error(
      "release attestation must contain exactly all five packages",
    );
  if (packageName !== undefined && !names.includes(packageName))
    throw new Error("unknown release package");
  const temporary = repack
    ? mkdtempSync(path.join(tmpdir(), "actuarial-ts-verify-"))
    : undefined;
  try {
    for (const name of packageName ? [packageName] : names) {
      const evidence = attestation.packages[name];
      const workspace = name.slice("@actuarial-ts/".length);
      const manifest = JSON.parse(
        readFileSync(
          path.join(root, "packages", workspace, "package.json"),
          "utf8",
        ),
      );
      if (
        !evidence ||
        evidence.version !== attestation.version ||
        manifest.version !== evidence.version ||
        manifest.name !== name ||
        evidence.filename !==
          `actuarial-ts-${workspace}-${attestation.version}.tgz` ||
        !/^[0-9a-f]{64}$/.test(evidence.sha256)
      )
        throw new Error("release attestation package identity mismatch");
      if (
        hashFile(path.join(root, ".release/tarballs"), evidence.filename) !==
        evidence.sha256
      )
        throw new Error(
          "release attestation is stale: attested tarball bytes changed",
        );
      if (
        repack &&
        packWorkspace(root, workspace, temporary).sha256 !== evidence.sha256
      )
        throw new Error(
          "release attestation is stale: packed package bytes changed",
        );
    }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
  return attestation;
}
