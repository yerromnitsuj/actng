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
  canonicalJson,
  type DiagnosticDefinition,
  type DiagnosticReviewRule,
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
const authored =
  docToDiagnosticDefinition(legacyDefinition).definition.definition;
const measure = (measureId: string) => ({ op: "measure" as const, measureId });
const ruleBase = (id: string) => ({
  id,
  code: id,
  description: `Conformance ${id}`,
  severity: "warning" as const,
  missingInput: "not-evaluated" as const,
});
const reviewRules: DiagnosticReviewRule[] = [
  ...(["lt", "lte", "eq", "neq", "gte", "gt"] as const).flatMap((operator) =>
    (["not-evaluated", "finding"] as const).map((missingInput) => ({
      ...ruleBase(`${operator}-${missingInput}`),
      kind: "compare" as const,
      missingInput,
      when: {
        left: measure("gross-paid"),
        operator,
        right: measure("gross-incurred"),
      },
      tolerance: { absolute: 1, relative: 0 },
    })),
  ),
  {
    ...ruleBase("reconcile"),
    kind: "reconcile",
    actual: measure("reported"),
    expected: {
      op: "add",
      terms: [
        measure("open"),
        measure("closed-with-pay"),
        measure("closed-no-pay"),
      ],
    },
  },
  {
    ...ruleBase("monotonic"),
    kind: "monotonic",
    expression: measure("gross-paid"),
    direction: "nondecreasing",
  },
  {
    ...ruleBase("layer-order"),
    kind: "layer-order",
    narrower: measure("net-paid"),
    broader: measure("gross-paid"),
    comparability: {
      kind: "caller-asserted",
      rationaleArtifactId: "source-manifest",
    },
  },
  {
    ...ruleBase("control-total"),
    kind: "control-total",
    expression: measure("insurance-years"),
    expected: 200,
    projection: { kind: "latest-valuation-per-origin" },
    filter: { sourceGroups: ["baseline"] },
  },
  {
    ...ruleBase("valuation-exposure"),
    kind: "control-total",
    expression: measure("current-exposure"),
    expected: 220,
    projection: { kind: "all-cells" },
    filter: { sourceGroups: ["baseline"] },
  },
  {
    ...ruleBase("relative-edge"),
    kind: "compare",
    when: {
      left: measure("gross-paid"),
      operator: "neq",
      right: measure("gross-incurred"),
    },
    tolerance: { relative: 0.1 },
  },
  {
    ...ruleBase("tolerance-overflow"),
    kind: "compare",
    when: {
      left: measure("gross-paid"),
      operator: "neq",
      right: measure("gross-incurred"),
    },
    tolerance: { relative: 1e308 },
  },
  {
    ...ruleBase("overflow"),
    kind: "reconcile",
    actual: {
      op: "add",
      terms: [measure("gross-paid"), measure("gross-incurred")],
    },
    expected: { op: "constant", value: 0 },
  },
  {
    ...ruleBase("cancellation"),
    kind: "reconcile",
    actual: {
      op: "add",
      terms: [
        measure("gross-paid"),
        measure("gross-incurred"),
        measure("cancellation-adjustment"),
      ],
    },
    expected: { op: "constant", value: 1 },
  },
];
const exposure = authored.measures.find(
  (item) => item.id === "insurance-years",
)!;
const amount = authored.measures.find((item) => item.id === "gross-paid")!;
const calendar = compileDiagnosticDefinition({
  ...authored,
  measures: [
    ...authored.measures,
    {
      ...exposure,
      id: "current-exposure",
      exposureTiming: "valuation-specific",
    },
    { ...amount, id: "cancellation-adjustment" },
  ],
  reviewRules,
});
const createdAt = "2026-09-03T12:00:00.000Z";
function diagnosticCorpus(
  definition: ReturnType<typeof compileDiagnosticDefinition>,
  origin: string,
  valuations: readonly [string, string],
) {
  const lossMeasures = Object.fromEntries(
    definition.definition.measures
      .filter((measure) => measure.source === "loss")
      .map((measure) => [measure.id, legacyCell.values[measure.id] ?? null]),
  );
  const exposureMeasures = definition.definition.measures.filter(
    (measure) => measure.source === "exposure",
  );
  const variants: ReadonlyArray<
    readonly [string, Record<string, number | null>]
  > = [
    ["baseline", { "gross-paid": 100, "gross-incurred": 101 }],
    [
      "outside-edge",
      { "gross-paid": 100, "gross-incurred": 101.00000000000001 },
    ],
    ["relative-edge", { "gross-paid": 90, "gross-incurred": 100 }],
    ["missing", { "gross-paid": null, reported: null }],
    ["overflow", { "gross-paid": 1e308, "gross-incurred": 1e308 }],
    [
      "cancellation",
      {
        "gross-paid": 1e16,
        "gross-incurred": 1,
        "cancellation-adjustment": -1e16,
      },
    ],
  ];
  const losses = variants.flatMap(([sourceGroup, overrides]) =>
    valuations.map((valuation, index) => {
      const values: Record<string, number | null> = {
        ...lossMeasures,
        "cancellation-adjustment": 0,
        ...overrides,
      };
      if (sourceGroup === "baseline" && index === 1) values["gross-paid"] = 99;
      if (sourceGroup === "relative-edge" && index === 1)
        values["gross-paid"] = 89.99999999999999;
      if (sourceGroup === "missing" && index === 1) delete values.reported;
      return {
        rowType: "aggregate",
        recordId: `${sourceGroup}-${index}`,
        sourceGroup,
        origin,
        valuation,
        complete: true,
        measures: values,
      };
    }),
  );
  const cells = {
    losses,
    exposures: variants.flatMap(([sourceGroup]) =>
      exposureMeasures.flatMap((measure) =>
        (measure.exposureTiming === "valuation-specific"
          ? valuations
          : [null]
        ).map((valuation, index) => ({
          key: `${sourceGroup}-${measure.id}-${index}`,
          sourceGroup,
          origin,
          ...(valuation === null ? {} : { valuation }),
          measureId: measure.id,
          value:
            sourceGroup === "missing"
              ? null
              : measure.exposureTiming === "valuation-specific"
                ? 100 + 20 * index
                : 200,
          complete: true,
        })),
      ),
    ),
  };
  const prepared = prepareDiagnosticData({ definition, ...cells });
  const result = runMetricDiagnostics({ prepared });
  const reviews = evaluateDiagnosticReviewRules(prepared);
  return {
    cells,
    expected: {
      canonicalDefinitionJson: canonicalJson(definition.definition),
      definitionIntegrity: definition.definitionIntegrity,
      preparationFingerprint: prepared.preparationFingerprint,
      result,
      reviews,
    },
  };
}
const calendarCorpus = diagnosticCorpus(calendar, "2025", ["2025", "2027"]);
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
    valuations: [
      { label: "V1", aliases: ["valuation-one"], coordinate: 1 },
      { label: "V3", aliases: ["valuation-three"], coordinate: 4 },
    ],
  },
};
const ordered = compileDiagnosticDefinition(orderedDefinition);
const orderedCorpus = diagnosticCorpus(ordered, "origin-one", [
  "valuation-one",
  "valuation-three",
]);
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
