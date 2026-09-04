import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const registryPath = path.join(
  root,
  "tools/validation/source-reconciliation.json",
);
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
  version: number;
  entries: Array<{
    id: string;
    fixture: { path: string; sha256: string };
    test: { path: string; implementationId: string };
    shores: string[];
    lanes: string[];
  }>;
};
if (registry.version !== 1 || !Array.isArray(registry.entries))
  throw new Error("Unsupported source-reconciliation registry");
const ids = new Set<string>();
for (const [index, entry] of registry.entries.entries()) {
  if (ids.has(entry.id))
    throw new Error(`Duplicate source reconciliation id ${entry.id}`);
  ids.add(entry.id);
  const bytes = readFileSync(path.join(root, entry.fixture.path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== entry.fixture.sha256)
    throw new Error(
      `${entry.id}: fixture SHA-256 changed (${actual}); review source evidence and update deliberately`,
    );
  const test = readFileSync(path.join(root, entry.test.path), "utf8");
  if (!test.includes(entry.test.implementationId))
    throw new Error(
      `${entry.id}: test implementation ${entry.test.implementationId} is missing`,
    );
  for (const lane of ["npm test", "validation:source", "release:gate"])
    if (!entry.lanes.includes(lane))
      throw new Error(`${entry.id}: missing required lane ${lane}`);
  if (entry.shores.length === 0)
    throw new Error(`${entry.id}: no applicable shore declared`);
  if (index === registry.entries.length - 1 && entry.id !== "jcs-fnv-vectors")
    throw new Error("Registry order changed; keep stable reviewed ordering");
}
const required = [
  "mack-1993-taylor-ashe",
  "mack-1993-mortgage",
  "mack-1999-tail",
  "mack-1994-raa-diagnostics",
  "mack-2000-benktander",
  "clark-2003",
  "gluck-1997",
  "england-verrall-2002",
  "quarg-mack-2004",
  "merz-wuthrich-2008",
  "conger-nolibos-2003",
  "jcs-fnv-vectors",
];
for (const id of required)
  if (!ids.has(id))
    throw new Error(`Missing mandatory source reconciliation ${id}`);
console.log(
  `source reconciliation registry: ${registry.entries.length} anchors verified`,
);
