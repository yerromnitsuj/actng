import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./release-evidence.mjs";

const script = "tools/release/run-generalized-diagnostics-gate.sh";
const node22Path = `${process.env.HOME}/.nvm/versions/node/v22.22.0/bin:${process.env.PATH}`;

test("release gate is executable Bash with strict cleanup and the exact npm entrypoint", () => {
  const source = readFileSync(script, "utf8");
  assert.ok(source.startsWith("#!/usr/bin/env bash\nset -euo pipefail"));
  assert.ok(statSync(script).mode & 0o100);
  assert.match(source, /trap cleanup EXIT/);
  assert.equal(
    JSON.parse(readFileSync("package.json", "utf8")).scripts["release:gate"],
    "bash tools/release/run-generalized-diagnostics-gate.sh",
  );
  execFileSync("bash", ["-n", script]);
});
test("dry run preserves every normative phase in order", () => {
  const lines = execFileSync("bash", [script, "--dry-run"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  const manifest = JSON.parse(
    readFileSync("tools/release/release-commands.json", "utf8"),
  );
  assert.deepEqual(lines, manifest.commands);
  // Pin the reviewed manifest itself: deleting or reordering any phase fails,
  // without maintaining a second divergent command array in this self-test.
  assert.equal(
    sha256(readFileSync("tools/release/release-commands.json")),
    "3d3d4d03456d3bea975bbebf35864a0189c2488f638791e2709da4bc24f761f4",
  );
});
test("workflow triggers and runtimes cover docs, release tooling, and the Node support split", () => {
  const python = readFileSync(".github/workflows/py-conformance.yml", "utf8");
  const r = readFileSync(".github/workflows/r-conformance.yml", "utf8");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const rEnvironment = JSON.parse(
    readFileSync("tools/interop/r-environment.json", "utf8"),
  );
  for (const source of [python, r])
    for (const path of [
      "docs/**",
      "tools/docs/**",
      "tools/release/**",
      "tools/validation/**",
      "examples/real-world-loss-run/**",
      "CHANGELOG.md",
      "package.json",
      "package-lock.json",
    ])
      expectText(source, path);
  expectText(python, 'python-version: "3.10"');
  expectText(python, 'python-version: "3.12"');
  expectText(python, "docs:check:py");
  expectText(
    python,
    'echo "SIDECAR_URL=http://127.0.0.1:$SIDECAR_PORT" >> "$GITHUB_ENV"',
  );
  assert.doesNotMatch(python, /SIDECAR_URL:\s*http:\/\/127\.0\.0\.1:8091/);
  expectText(r, 'r-version: "4.4.3"');
  expectText(r, `deriv-${rEnvironment.transitivePackages.Deriv}`);
  expectText(r, "install-r-environment.R");
  expectText(r, "rebuild:compare");
  expectText(r, "docs:check:r");
  expectText(ci, "node-version: 22.22.0");
  expectText(ci, "node-version: 20");
  expectText(ci, "--consume-manifest");
});
function expectText(source, value) {
  assert.ok(source.includes(value), `workflow omits ${value}`);
}
test("preflight rejects an executable that only claims to be Python 3.12", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-python-test-"));
  try {
    const fake = join(dir, "python3.12");
    writeFileSync(
      fake,
      "#!/bin/sh\necho 'requires Python 3.12, got fake' >&2\nexit 1\n",
    );
    chmodSync(fake, 0o755);
    const result = spawnSync("bash", [script, "--preflight-only"], {
      encoding: "utf8",
      env: { ...process.env, PATH: node22Path, ACTUARIAL_TS_PYTHON312: fake },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires Python 3\.12/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("failed actual gate preflight invalidates old evidence, but read-only preflight does not", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-stale-evidence-"));
  try {
    mkdirSync(join(root, "tools/release"), { recursive: true });
    mkdirSync(join(root, ".release"));
    const copiedScript = join(root, script);
    writeFileSync(copiedScript, readFileSync(script));
    const evidence = join(root, ".release/attestation.json");
    const fakePython = join(root, "failed-python");
    writeFileSync(fakePython, "#!/bin/sh\nexit 1\n");
    chmodSync(fakePython, 0o755);
    for (const args of [["--preflight-only"], []]) {
      writeFileSync(evidence, "old evidence");
      const result = spawnSync("bash", [copiedScript, ...args], {
        env: {
          ...process.env,
          PATH: node22Path,
          ACTUARIAL_TS_PYTHON312: fakePython,
        },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(evidence), args.length === 1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("the exact R executable path, including spaces, receives both preflight calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate R path "));
  const log = join(dir, "calls.log");
  try {
    const fakePython = join(dir, "python3.12");
    writeFileSync(fakePython, "#!/bin/sh\nexit 0\n");
    chmodSync(fakePython, 0o755);
    const fake = join(dir, "R script");
    writeFileSync(
      fake,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`,
    );
    chmodSync(fake, 0o755);
    execFileSync("bash", [script, "--preflight-only"], {
      env: {
        ...process.env,
        PATH: node22Path,
        ACTUARIAL_TS_PYTHON312: fakePython,
        ACTUARIAL_TS_RSCRIPT: fake,
      },
    });
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "tools/interop/test-r-environment.R",
      "tools/interop/check-r-environment.R",
    ]);
    const afterResolution = readFileSync(script, "utf8").split(
      'export ACTUARIAL_TS_RSCRIPT="$RSCRIPT_BIN"',
    )[1];
    assert.doesNotMatch(afterResolution, /(^|[^_$])Rscript(?:\s|$)/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const [scenario, expectedStatus] of [
  ["success", 0],
  ["failure", 9],
  ["pre-allocation-interrupt", 130],
  ["post-allocation-interrupt", 130],
]) {
  test(`cleanup removes state and terminates its child: ${scenario}`, () => {
    const result = spawnSync(
      "bash",
      [script, `--cleanup-self-test=${scenario}`],
      {
        encoding: "utf8",
        env: { ...process.env, ACTUARIAL_TS_GATE_TESTING: "1" },
      },
    );
    assert.equal(result.status, expectedStatus);
    const temp = result.stdout.match(/release gate temp: (.+)/)?.[1];
    const pid = result.stdout.match(/release gate child: (\d+)/)?.[1];
    if (scenario !== "pre-allocation-interrupt") {
      assert.ok(temp && pid);
      assert.equal(existsSync(temp), false);
      assert.notEqual(spawnSync("kill", ["-0", pid]).status, 0);
    }
  });
}
