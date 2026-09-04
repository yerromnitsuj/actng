import test from "node:test";
import assert from "node:assert/strict";
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
import {
  cleanSourceSha,
  commandManifestPath,
  createAttestation,
  readCommands,
  sha256,
  verifyAttestation,
  workspaces,
} from "./release-evidence.mjs";
import { executePhases } from "./execute-gate.mjs";

test("gate dispatch executes each manifest phase once and stops at every possible failure", () => {
  const commands = readCommands(process.cwd());
  const visited = [];
  const phases = executePhases(commands, (command) => {
    visited.push(command);
    return 0;
  });
  assert.deepEqual(visited, commands);
  assert.deepEqual(
    phases,
    commands.map((command) => ({ command, exitCode: 0 })),
  );
  for (let i = 0; i < commands.length; i++) {
    let calls = 0;
    assert.throws(
      () => executePhases(commands, () => (calls++ === i ? 1 : 0)),
      /release phase failed/,
    );
    assert.equal(calls, i + 1);
  }
});

test("attestation rejects missing phases, dirty source, other commits, changed archives and changed dist", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "release-evidence-test-"));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    write(".gitignore", ".release/\npackages/*/dist/\n");
    write(
      commandManifestPath,
      JSON.stringify({ version: 1, commands: ["test fixture phase"] }),
    );
    write("tools/validation/source-reconciliation.json", "{}\n");
    for (const workspace of workspaces) {
      write(
        `packages/${workspace}/package.json`,
        JSON.stringify({
          name: `@actuarial-ts/${workspace}`,
          version: "1.2.3",
          files: ["dist"],
        }),
      );
      write(
        `packages/${workspace}/dist/index.js`,
        "export const ready = true;\n",
      );
    }
    git("init");
    git("config", "user.email", "release-test@example.invalid");
    git("config", "user.name", "Release Test");
    git("add", ".");
    git("commit", "-m", "fixture");
    const execution = {
      gitSha: cleanSourceSha(root),
      commandManifestSha256: sha256(
        readFileSync(path.join(root, commandManifestPath)),
      ),
      phases: [{ command: "test fixture phase", exitCode: 0 }],
    };
    assert.throws(
      () => createAttestation(root, { ...execution, phases: [] }),
      /missing gate phases/,
    );
    assert.throws(
      () =>
        createAttestation(root, {
          ...execution,
          phases: [{ command: "test fixture phase", exitCode: 1 }],
        }),
      /phase 1/,
    );
    const attestation = createAttestation(root, execution);
    const evidenceText = readFileSync(
      path.join(root, ".release/attestation.json"),
      "utf8",
    );
    assert.equal(verifyAttestation(root).version, "1.2.3");
    await t.test("dirty source and untracked inputs", () => {
      write("untracked.txt", "unexpected");
      assert.throws(() => verifyAttestation(root), /clean Git tree/);
      rmSync(path.join(root, "untracked.txt"));
    });
    await t.test("different SHA", () => {
      git("commit", "--allow-empty", "-m", "different source identity");
      assert.throws(() => verifyAttestation(root), /Git SHA changed/);
      // This repository is an isolated test fixture, never the user's checkout.
      git("reset", "--soft", execution.gitSha);
    });
    await t.test("changed archive", () => {
      const filename = `.release/tarballs/${attestation.packages["@actuarial-ts/core"].filename}`;
      const original = readFileSync(path.join(root, filename));
      write(filename, "changed");
      assert.throws(
        () => verifyAttestation(root),
        /attested tarball bytes changed/,
      );
      write(filename, original);
    });
    await t.test("changed ignored build output", () => {
      write("packages/core/dist/index.js", "export const ready = false;\n");
      assert.throws(
        () => verifyAttestation(root),
        /packed package bytes changed/,
      );
      write("packages/core/dist/index.js", "export const ready = true;\n");
    });
    for (const [name, mutate, error] of [
      ["legacy format", (a) => (a.attestationVersion = 1), /structure/],
      ["missing phase", (a) => a.execution.phases.pop(), /missing gate phases/],
      [
        "missing package",
        (a) => delete a.packages["@actuarial-ts/data"],
        /all five/,
      ],
      [
        "changed command evidence",
        (a) => (a.commandManifestSha256 = "0".repeat(64)),
        /release-commands/,
      ],
      [
        "changed reconciliation evidence",
        (a) => (a.sourceReconciliationManifestSha256 = "0".repeat(64)),
        /source-reconciliation/,
      ],
      [
        "path traversal",
        (a) => (a.packages["@actuarial-ts/core"].filename = "../../other.tgz"),
        /package identity/,
      ],
    ])
      await t.test(name, () => {
        const changed = JSON.parse(evidenceText);
        mutate(changed);
        write(".release/attestation.json", JSON.stringify(changed));
        assert.throws(() => verifyAttestation(root), error);
        write(".release/attestation.json", evidenceText);
      });
    assert.throws(
      () => verifyAttestation(root, "__proto__"),
      /unknown release package/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
