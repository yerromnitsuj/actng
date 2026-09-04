import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE } from "../src/sourceManifest.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const item of SOURCE.derivatives) {
  const bytes = await readFile(resolve(root, item.path));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== item.sha256 || bytes.byteLength !== item.byteLength)
    throw new Error(
      `${item.path}: derivative bytes do not match the reviewed manifest`,
    );
  const lines = bytes.toString("utf8").trimEnd().split(/\r?\n/);
  const columns = lines[0]!.replace(/^"|"$/g, "").split(/","|,/);
  if (lines.length - 1 !== item.rowCount)
    throw new Error(
      `${item.path}: expected ${item.rowCount} rows, found ${lines.length - 1}`,
    );
  if (JSON.stringify(columns) !== JSON.stringify(item.columns))
    throw new Error(
      `${item.path}: column schema does not match the reviewed manifest`,
    );
}
console.log(
  `real-world derivatives: ${SOURCE.derivatives.length} files verified`,
);
