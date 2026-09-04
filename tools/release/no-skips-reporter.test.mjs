import test from "node:test";
import assert from "node:assert/strict";
import { unapprovedSkips } from "./no-skips-reporter.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("every standalone Vitest gate phase uses the skip-failing reporter", () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  for (const name of [
    "validation:reconciliation",
    "diagnostics:legacy:test",
    "docs:check:test",
  ])
    assert.ok(
      scripts[name].includes(
        "--reporter=./tools/release/no-skips-reporter.mjs",
      ),
      `${name} must not silently skip tests`,
    );
});

test("skip guard rejects skipped and todo cases, including nested suites", () => {
  const files = [
    {
      filepath: "/repo/test/math.test.ts",
      tasks: [
        {
          type: "suite",
          name: "source",
          tasks: [
            { type: "test", name: "published-value", mode: "skip" },
            { type: "test", name: "reconcile", mode: "todo" },
            { type: "test", name: "active", mode: "run" },
          ],
        },
      ],
    },
  ];
  assert.equal(unapprovedSkips(files).length, 2);
});

test("only the explicitly non-release paid model evaluation is exempt", () => {
  const file = {
    filepath: "/repo/packages/agents/test/divergence.test.ts",
    tasks: [
      {
        type: "suite",
        name: "live divergence explainer (opt-in)",
        tasks: [
          {
            type: "test",
            mode: "skip",
            name: "names sigma_interpolation as the misaligned flag on the committed misaligned pair",
          },
        ],
      },
    ],
  };
  assert.deepEqual(unapprovedSkips([file]), []);
  file.tasks[0].tasks[0].name = "any other test";
  assert.equal(unapprovedSkips([file]).length, 1);
});

test("the real Vitest reporter makes a skipped suite fail the process", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "actuarial-ts-skip-test-"));
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  try {
    writeFileSync(
      path.join(directory, "skipped.test.mjs"),
      "describe.skip('source anchor', () => { it('published value', () => {}); });\n",
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        directory,
        "--globals",
        "--reporter=default",
        `--reporter=${path.join(root, "tools/release/no-skips-reporter.mjs")}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Release tests may not skip applicable cases/);
    assert.match(result.stderr, /published value/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
