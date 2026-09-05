import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersionSync } from "./check-version-sync.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("the release stamps are synchronized", () => {
  assert.deepEqual(checkVersionSync(root), []);
});

test("single-package and individual README link drift are rejected", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "actuarial-ts-version-"));
  try {
    for (const path of [
      "package.json",
      "package-lock.json",
      "packages",
      "interop/python/pyproject.toml",
      "interop/python/actuarial_interchange/documents.py",
      "tools/interop/actuarialInterchange.R",
      "tools/interop/r-environment.json",
      "schema/interchange/1.1",
    ])
      cpSync(resolve(root, path), resolve(temp, path), { recursive: true });
    const path = resolve(temp, "packages/core/package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const releaseVersion = manifest.version;
    manifest.version = "0.7.2";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.ok(
      checkVersionSync(temp).some((message) => message.includes("version")),
    );
    manifest.version = releaseVersion;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.deepEqual(checkVersionSync(temp), []);
    const readmePath = resolve(temp, "packages/core/README.md");
    const originalReadme = readFileSync(readmePath, "utf8");
    for (const target of [
      "docs/reference/diagnostic-formulas.md",
      "docs/migrations/0.6-generalized-diagnostics.md",
      "docs/migrations/0.7-compact-diagnostics.md",
      "docs/reference/diagnostic-replay-stream.md",
    ]) {
      const current = `https://github.com/yerromnitsuj/actng/blob/v${releaseVersion}/${target}`;
      const stale = `https://github.com/yerromnitsuj/actng/blob/v0.7.0/${target}`;
      assert.ok(originalReadme.includes(current));
      writeFileSync(readmePath, originalReadme.replace(current, stale));
      // Other correct versioned URLs remain, so a prefix-only check would miss this.
      assert.deepEqual(checkVersionSync(temp), [
        `core README must link ${target} at tag v${releaseVersion}`,
      ]);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
