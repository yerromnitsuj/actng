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

test("a single-package drift is rejected", () => {
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
    manifest.version = "0.7.1";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.ok(
      checkVersionSync(temp).some((message) => message.includes("version")),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
