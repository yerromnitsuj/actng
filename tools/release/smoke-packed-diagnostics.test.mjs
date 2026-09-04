import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ALL_PACKAGES, RUNTIME_FOUR, externalProfiles, packageSet, parseArguments,
  peerFloor, satisfiesRange, validateHandoffManifest, validatePackedReadme,
} from "./smoke-packed-diagnostics.mjs";

test("package sets are explicit and agents never enters runtime-four", () => {
  assert.deepEqual(packageSet("all-five"), ALL_PACKAGES);
  assert.deepEqual(packageSet("runtime-four"), RUNTIME_FOUR);
  assert.ok(!RUNTIME_FOUR.includes("agents"));
  assert.throws(() => packageSet("other"));
});
test("CLI accepts equals and separate-value forms", () => {
  assert.deepEqual(parseArguments(["--package-set=runtime-four", "--pack-only", "--handoff-dir", "/tmp/a b"]), { "--package-set": "runtime-four", "--pack-only": true, "--handoff-dir": "/tmp/a b" });
  assert.throws(() => parseArguments(["value"]), /unexpected/);
  assert.throws(() => parseArguments(["--handoff-dir"]), /requires/);
});
test("peer floors and range checks are exact and fail closed", () => {
  assert.equal(peerFloor(">=1.51.0 <2"), "1.51.0");
  assert.equal(peerFloor("^3.25.76"), "3.25.76");
  assert.throws(() => peerFloor("latest"), /lower bound/);
  assert.equal(satisfiesRange("3.25.76", "^3.25.76"), true);
  assert.equal(satisfiesRange("4.0.0", "^3.25.76"), false);
  assert.equal(satisfiesRange("1.51.0", ">=1.51.0 <2"), true);
  assert.equal(satisfiesRange("2.0.0", ">=1.51.0 <2"), false);
});
test("lock and minimum profiles are independently constructed", () => {
  const lock = { packages: { "node_modules/zod": { version: "3.25.76" }, "node_modules/@mastra/core": { version: "1.51.0" }, "node_modules/@mastra/mcp": { version: "1.14.0" } } };
  const agents = { peerDependencies: { zod: "^3.25.76", "@mastra/core": ">=1.51.0 <2", "@mastra/mcp": ">=1.14.0 <2" } };
  assert.deepEqual(externalProfiles(ALL_PACKAGES, lock, agents).map((item) => item.name), ["lock", "minimum"]);
  assert.deepEqual(externalProfiles(RUNTIME_FOUR, lock, agents), [{ name: "runtime-four", coordinates: ["zod@3.25.76"] }]);
});
test("manifest verification rejects ordering, extras, missing files, and tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "packed-manifest-test-"));
  try {
    const tarballs = RUNTIME_FOUR.map((name) => {
      const filename = `actuarial-ts-${name}-0.6.0.tgz`; const bytes = `tar-${name}`; writeFileSync(join(dir, filename), bytes);
      return { name: `@actuarial-ts/${name}`, version: "0.6.0", filename, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    const manifest = { schemaVersion: 1, packageSet: "runtime-four", tarballs, externalDependencies: { zod: "zod@3.25.76" } };
    assert.equal(validateHandoffManifest(manifest, dir, "runtime-four").tarballs.length, 4);
    assert.throws(() => validateHandoffManifest({ ...manifest, tarballs: [...tarballs].reverse() }, dir, "runtime-four"), /ordering/);
    writeFileSync(join(dir, "extra.tgz"), "extra");
    assert.throws(() => validateHandoffManifest(manifest, dir, "runtime-four"), /extra or missing/);
    rmSync(join(dir, "extra.tgz")); writeFileSync(join(dir, tarballs[0].filename), "changed");
    assert.throws(() => validateHandoffManifest(manifest, dir, "runtime-four"), /tampered/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("packed README links must stay inside and exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "packed-readme-test-"));
  try {
    writeFileSync(join(dir, "README.md"), "[source](src/index.ts) [repo](https://github.com/yerromnitsuj/actng)"); mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/index.ts"), "");
    validatePackedReadme(dir);
    writeFileSync(join(dir, "README.md"), "[missing](../docs/guide.md)");
    assert.throws(() => validatePackedReadme(dir), /unavailable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
