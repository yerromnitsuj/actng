import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertDeclarationSnapshot,
  collectPackedDeclarations,
} from "./check-api-declarations.mjs";
import { workspaces } from "./release-evidence.mjs";

test("packed API snapshot covers nested declarations in every package and rejects additions, removals, and changed signatures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "api-snapshot-test-"));
  try {
    const expected = {};
    for (const workspace of workspaces) {
      const directory = path.join(root, "packages", workspace);
      mkdirSync(path.join(directory, "dist/nested"), { recursive: true });
      const name = `@actuarial-ts/${workspace}`;
      writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ name, version: "1.0.0", files: ["dist"] }),
      );
      const files = {
        "package/dist/index.d.ts":
          'export { value } from "./nested/helper.js";\n',
        "package/dist/nested/helper.d.ts":
          "export declare const value: number;\n",
      };
      for (const [file, content] of Object.entries(files))
        writeFileSync(
          path.join(directory, file.replace("package/", "")),
          content,
        );
      expected[name] = files;
    }
    const actual = collectPackedDeclarations(root);
    assertDeclarationSnapshot(actual, expected);
    const mutations = [
      (value) => {
        delete value["@actuarial-ts/agents"];
      },
      (value) => {
        delete value["@actuarial-ts/core"]["package/dist/nested/helper.d.ts"];
      },
      (value) => {
        value["@actuarial-ts/core"]["package/dist/new.d.ts"] =
          "export declare const added: true;";
      },
      (value) => {
        value["@actuarial-ts/core"]["package/dist/nested/helper.d.ts"] =
          "export declare const value: string;";
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(actual);
      mutate(changed);
      assert.throws(
        () => assertDeclarationSnapshot(changed, expected),
        /packed public declarations changed/,
      );
    }
    rmSync(path.join(root, "packages/core/dist/index.d.ts"));
    assert.throws(
      () => collectPackedDeclarations(root),
      /has no public declarations/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
