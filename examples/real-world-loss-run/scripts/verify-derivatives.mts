import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE } from "../src/sourceManifest.js";

export function verifyDerivative(
  item: (typeof SOURCE.derivatives)[number],
  bytes: Buffer,
): void {
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

/** The large generated claim-history CSV is release evidence, not a tracked file. */
export async function verifyCommittedDerivatives(
  root: string,
): Promise<number> {
  const committed = SOURCE.derivatives.filter((item) =>
    item.path.startsWith("data/"),
  );
  const files = (await readdir(resolve(root, "data")))
    .filter((name) => name.endsWith(".csv"))
    .map((name) => `data/${name}`)
    .sort();
  if (
    JSON.stringify(files) !==
    JSON.stringify(committed.map((item) => item.path).sort())
  )
    throw new Error(
      "Every committed CSV must have exactly one derivative manifest entry",
    );
  for (const item of committed)
    verifyDerivative(item, await readFile(resolve(root, item.path)));
  return committed.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(
    `real-world derivatives: ${await verifyCommittedDerivatives(root)} committed files verified`,
  );
}
