/**
 * Phase A conformance fixture generator.
 *
 * Authors, for each of the three Phase A fixtures (Taylor/Ashe, RAA, Mack
 * mortgage), the frozen interchange documents the cross-engine suite runs
 * against:
 *
 *   fixtures/<name>/triangle.json          TriangleDoc
 *   fixtures/<name>/selection.json         volume-weighted-all SelectionDoc
 *   fixtures/<name>/deterministic-cl.json  TS runChainLadder MethodResultDoc
 *   fixtures/<name>/mack1993-vw.json       TS runMack MethodResultDoc
 *   fixtures/<name>/expectations.json      TS-engine totals + integrity tags
 *
 * Deterministic by construction: fixed createdAt, no clock reads, data
 * sourced from packages/core/test/fixtures (never re-transcribed). Running
 * it twice produces identical bytes.
 *
 * THE FIXTURES ARE FROZEN once committed. Rerunning this script is only
 * legitimate after a spec/convention change, with the reason documented —
 * see interop/conformance/README.md. The TS runner fails if the committed
 * files stop matching a fresh authoring run.
 *
 * Run from the repo root (tsx is hoisted from apps/server):
 *
 *   PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npx tsx interop/conformance/generate-fixtures.mts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFORMANCE_FIXTURES, authorFixture, authorWrappedBundleDoc } from "./ts/fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures");

function write(dir: string, name: string, value: unknown): void {
  const file = path.join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

for (const fixture of CONFORMANCE_FIXTURES) {
  const dir = path.join(fixturesRoot, fixture.name);
  mkdirSync(dir, { recursive: true });
  const authored = authorFixture(fixture);
  write(dir, "triangle.json", authored.triangleDoc);
  write(dir, "selection.json", authored.selectionDoc);
  write(dir, "deterministic-cl.json", authored.clResultDoc);
  write(dir, "mack1993-vw.json", authored.mackResultDoc);
  write(dir, "expectations.json", authored.expectations);
  // Phase B (spec 3.2): ONE wrapped reproducibility bundle rides on
  // Taylor/Ashe only — the committed proof document for the Python shore's
  // load_bundle (Task B3). Same freeze policy as every other fixture file.
  if (fixture.name === "taylor-ashe") {
    write(dir, "wrapped-bundle.json", authorWrappedBundleDoc(fixture, authored));
  }
}
