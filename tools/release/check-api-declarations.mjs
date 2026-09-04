import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packWorkspace, workspaces } from "./release-evidence.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const snapshotPath = path.join(root, "tools/release/public-declarations.json");
export function collectPackedDeclarations(root) {
  const temporary = mkdtempSync(path.join(tmpdir(), "actuarial-ts-api-"));
  try {
    const snapshot = {};
    for (const workspace of workspaces) {
      const packed = packWorkspace(root, workspace, temporary);
      const archive = path.join(temporary, packed.filename);
      const declarations = execFileSync("tar", ["-tzf", archive], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter((name) => name.endsWith(".d.ts"))
        .sort();
      assert.ok(
        declarations.includes("package/dist/index.d.ts"),
        `${packed.name} has no public declarations`,
      );
      snapshot[packed.name] = Object.fromEntries(
        declarations.map((name) => [
          name,
          execFileSync("tar", ["-xOzf", archive, name], { encoding: "utf8" }),
        ]),
      );
    }
    return snapshot;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function assertDeclarationSnapshot(actual, expected) {
  assert.deepEqual(
    actual,
    expected,
    "packed public declarations changed; review and explicitly update the snapshot",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const snapshot = collectPackedDeclarations(root);
  if (process.argv.includes("--write")) {
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(
      "Updated complete packed declaration snapshot; review its diff before committing.",
    );
  } else {
    assertDeclarationSnapshot(
      snapshot,
      JSON.parse(readFileSync(snapshotPath, "utf8")),
    );
    console.log(
      "Every declaration in all five packed packages matches the reviewed snapshot.",
    );
  }
}
