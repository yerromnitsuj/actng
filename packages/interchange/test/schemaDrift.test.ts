import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { INTERCHANGE_SCHEMA_MANIFEST, emitJsonSchema } from "../src/index.js";

/**
 * The CI drift check (spec 3.4): the committed JSON Schemas under
 * schema/interchange/1.1/ must byte-match what the zod source of truth
 * emits. On drift, run:
 *
 *   npm run emit-schema --workspace @actuarial-ts/interchange
 *
 * and commit the regenerated files WITH the schema change that caused it.
 */
const schemaDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "schema/interchange/1.1",
);

const frozenV1Dir = join(schemaDir, "..", "1.0");
const frozenV1Hashes: Readonly<Record<string, string>> = {
  "bundle.schema.json": "2a10818800a710d27928a948dab933d48242488115a61efea6f7290cb5470dcd",
  "crosscheck-report.schema.json": "84ff1f828d66e616ed62a375b4dd753a35ba1e4b9f482c9103b7984206986254",
  "jcs-vectors.json": "fa86e32a769af308e41ea0bf939664a4d468c2138e533f6cb326d54d52d0b558",
  "method-result.schema.json": "adbe6ece5b767e618d260d1e138260616473f6bbebd8dad013021f7e337b660e",
  "selection.schema.json": "1804cb2e17b20d2700713769638016fc90c310b134de152014da420ecac2cfd2",
  "stochastic-result.schema.json": "b6c21cae3b866b8e8afec09bda8eaa11db37b38fa70db7b58726b8631d8890e6",
  "study.schema.json": "358239904dc50970fbebfdf7bfa910a8dbae354c38cb635e5261c93a2bf1db16",
  "triangle.schema.json": "3a52a82dc18688528ecb83f174ca7b2b3ee064d913b09a6f6f9e6d598c63b77b",
};

describe("emitted JSON Schemas match the committed files", () => {
  const emitted = emitJsonSchema(zodToJsonSchema);

  it("covers every document kind", () => {
    expect(emitted.map((e) => e.kind).sort()).toEqual(
      [...INTERCHANGE_SCHEMA_MANIFEST.map((m) => m.kind)].sort(),
    );
    expect(emitted).toHaveLength(8);
  });

  for (const entry of emitJsonSchema(zodToJsonSchema)) {
    it(`${entry.fileName} is committed and current`, () => {
      const committedPath = join(schemaDir, entry.fileName);
      expect(existsSync(committedPath), `${entry.fileName} is not committed`).toBe(true);
      expect(readFileSync(committedPath, "utf8")).toBe(entry.content);
    });
  }

  it("keeps the complete 1.0 publication byte-for-byte frozen", () => {
    expect(readdirSync(frozenV1Dir).sort()).toEqual(Object.keys(frozenV1Hashes).sort());
    for (const [file, expected] of Object.entries(frozenV1Hashes)) {
      const actual = createHash("sha256").update(readFileSync(join(frozenV1Dir, file))).digest("hex");
      expect(actual, file).toBe(expected);
    }
  });

  it("does not duplicate the normative JCS vectors in 1.1", () => {
    expect(existsSync(join(schemaDir, "jcs-vectors.json"))).toBe(false);
  });
});
