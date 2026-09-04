import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanSourceSha,
  commandManifestPath,
  createAttestation,
  readCommands,
  sha256,
} from "./release-evidence.mjs";

export function executePhases(commands, execute) {
  const phases = [];
  for (const command of commands) {
    const exitCode = execute(command);
    if (exitCode !== 0)
      throw new Error(`release phase failed (${exitCode}): ${command}`);
    phases.push({ command, exitCode });
  }
  return phases;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  rmSync(path.join(root, ".release/attestation.json"), { force: true });
  const commands = readCommands(root);
  const execution = {
    gitSha: cleanSourceSha(root),
    commandManifestSha256: sha256(
      readFileSync(path.join(root, commandManifestPath)),
    ),
  };
  const python = process.env.ACTUARIAL_TS_GATE_PYTHON;
  const rscript = process.env.ACTUARIAL_TS_RSCRIPT;
  if (!python || !rscript)
    throw new Error(
      "run through npm run release:gate to provision both language runtimes",
    );
  execution.phases = executePhases(commands, (command) => {
    console.log(`>>> ${command}`);
    let executable = "bash";
    let args = ["-c", command];
    if (command === "pytest:all") {
      executable = python;
      args = [
        "-m",
        "pytest",
        "-p",
        "reject_skips",
        "interop/python/tests",
        "interop/conformance/py",
        "interop/sidecar/tests",
        "-q",
      ];
    } else if (command.startsWith("R:")) {
      executable = rscript;
      const scripts = {
        "R:conformance": "tools/interop/conformance.R",
        "R:read-document": "tools/interop/test-read-document.R",
        "R:mack-1999-tail": "tools/interop/test-mack-1999-tail.R",
      };
      if (!Object.hasOwn(scripts, command))
        throw new Error(`Unknown R gate command ${command}`);
      args = [scripts[command]];
    }
    const result = spawnSync(executable, args, {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONPATH: [path.join(root, "tools/release"), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
        ACTUARIAL_TS_PYTHON: python,
        ACTUARIAL_TS_RELEASE_GATE: "1",
      },
    });
    return result.status ?? 1;
  });
  const attestation = createAttestation(root, execution);
  console.log(
    `release attestation created for ${attestation.version} at ${attestation.gitSha}`,
  );
}
