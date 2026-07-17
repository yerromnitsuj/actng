/**
 * Regenerates the committed JSON Schemas under schema/interchange/1.0/
 * from the zod source of truth (spec 3.4). Run via:
 *
 *   npm run emit-schema --workspace @actuarial-ts/interchange
 *
 * (the script imports the BUILT package, so the npm script builds first).
 * CI does not run this; the drift check is test/schemaDrift.test.ts, which
 * regenerates in-memory and diffs against the committed files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { emitJsonSchema } from "../dist/index.js";

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "schema/interchange/1.0",
);
mkdirSync(outDir, { recursive: true });

for (const emitted of emitJsonSchema(zodToJsonSchema)) {
  writeFileSync(join(outDir, emitted.fileName), emitted.content);
  console.log(`wrote ${emitted.fileName} (${emitted.content.length} bytes)`);
}
