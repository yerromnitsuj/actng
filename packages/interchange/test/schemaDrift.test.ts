import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { INTERCHANGE_SCHEMA_MANIFEST, emitJsonSchema } from "../src/index.js";

/**
 * The CI drift check (spec 3.4): the committed JSON Schemas under
 * schema/interchange/1.0/ must byte-match what the zod source of truth
 * emits. On drift, run:
 *
 *   npm run emit-schema --workspace @actuarial-ts/interchange
 *
 * and commit the regenerated files WITH the schema change that caused it.
 */
const schemaDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "schema/interchange/1.0",
);

describe("emitted JSON Schemas match the committed files", () => {
  const emitted = emitJsonSchema(zodToJsonSchema);

  it("covers every document kind", () => {
    expect(emitted.map((e) => e.kind).sort()).toEqual(
      [...INTERCHANGE_SCHEMA_MANIFEST.map((m) => m.kind)].sort(),
    );
    expect(emitted).toHaveLength(7);
  });

  for (const entry of emitJsonSchema(zodToJsonSchema)) {
    it(`${entry.fileName} is committed and current`, () => {
      const committedPath = join(schemaDir, entry.fileName);
      expect(existsSync(committedPath), `${entry.fileName} is not committed`).toBe(true);
      expect(readFileSync(committedPath, "utf8")).toBe(entry.content);
    });
  }
});
