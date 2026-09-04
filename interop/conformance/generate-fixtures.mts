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
 * Run from the repo root (tsx is a root devDependency):
 *
 *   PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npx tsx interop/conformance/generate-fixtures.mts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_FIXTURES,
  authorFixture,
  authorWrappedBundleDoc,
} from "./ts/fixtures.js";
import {
  compileDiagnosticDefinition,
  evaluateDiagnosticReviewRules,
  prepareDiagnosticData,
  runMetricDiagnostics,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
} from "../../packages/interchange/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures");

function write(dir: string, name: string, value: unknown): void {
  const file = path.join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

// The historical triangle corpus is byte-frozen at interchange 1.0. It is
// regenerated only when a maintainer deliberately opts in; the default run
// authors the current diagnostic corpus without touching those old bytes.
if (process.argv.includes("--legacy"))
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
      write(
        dir,
        "wrapped-bundle.json",
        authorWrappedBundleDoc(fixture, authored),
      );
    }
  }

const diagnosticDir = path.join(
  fixturesRoot,
  "diagnostics",
  "generalized-casualty",
);
const legacyDefinition = JSON.parse(
  readFileSync(path.join(diagnosticDir, "definition.json"), "utf8"),
);
const legacyCell = JSON.parse(
  readFileSync(path.join(diagnosticDir, "cell.json"), "utf8"),
) as { values: Record<string, number | null> };
const calendar = compileDiagnosticDefinition(
  docToDiagnosticDefinition(legacyDefinition).definition.definition,
);
const createdAt = "2026-09-03T12:00:00.000Z";
function diagnosticCorpus(
  definition: ReturnType<typeof compileDiagnosticDefinition>,
  origin: string,
  valuation: string,
) {
  const lossMeasures = Object.fromEntries(
    definition.definition.measures
      .filter((measure) => measure.source === "loss")
      .map((measure) => [measure.id, legacyCell.values[measure.id] ?? null]),
  );
  const exposureMeasures = definition.definition.measures.filter(
    (measure) => measure.source === "exposure",
  );
  const cells = {
    losses: [
      {
        rowType: "aggregate",
        recordId: "cell-1",
        sourceGroup: "all",
        origin,
        valuation,
        complete: true,
        measures: lossMeasures,
      },
    ],
    exposures: exposureMeasures.map((measure) => ({
      key: `${measure.id}-1`,
      sourceGroup: "all",
      origin,
      ...(measure.exposureTiming === "valuation-specific" ? { valuation } : {}),
      measureId: measure.id,
      value: legacyCell.values[measure.id] ?? null,
      complete: true,
    })),
  };
  const prepared = prepareDiagnosticData({ definition, ...cells });
  const result = runMetricDiagnostics({ prepared });
  const reviews = evaluateDiagnosticReviewRules(prepared);
  return {
    cells,
    expected: {
      definitionIntegrity: definition.definitionIntegrity,
      preparationFingerprint: prepared.preparationFingerprint,
      result,
      reviews,
    },
  };
}
const calendarCorpus = diagnosticCorpus(calendar, "2025", "2025");
write(
  diagnosticDir,
  "calendar-definition.json",
  diagnosticDefinitionToDoc(calendar, { createdAt }),
);
write(diagnosticDir, "calendar-aggregate-cells.json", calendarCorpus.cells);
write(diagnosticDir, "calendar-expected-output.json", calendarCorpus.expected);
const orderedDefinition: DiagnosticDefinition = {
  ...calendar.definition,
  periodAxis: {
    kind: "ordered",
    id: "ordered-conformance",
    version: "1.0.0",
    ageUnit: "step",
    ageOffset: 0,
    origins: [{ label: "O1", aliases: ["origin-one"], coordinate: 0 }],
    valuations: [{ label: "V1", aliases: ["valuation-one"], coordinate: 1 }],
  },
};
const ordered = compileDiagnosticDefinition(orderedDefinition);
const orderedCorpus = diagnosticCorpus(ordered, "origin-one", "valuation-one");
write(
  diagnosticDir,
  "ordered-axis-definition.json",
  diagnosticDefinitionToDoc(ordered, { createdAt }),
);
write(diagnosticDir, "ordered-axis-aggregate-cells.json", orderedCorpus.cells);
write(
  diagnosticDir,
  "ordered-axis-expected-output.json",
  orderedCorpus.expected,
);
