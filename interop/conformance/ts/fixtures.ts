import {
  type LdfSelections,
  type Triangle,
  computeDevelopmentFactors,
  runChainLadder,
  runMack,
  triangleFromGrid,
} from "@actuarial-ts/core";
import {
  CONVENTION_PROFILES,
  type MethodResultDoc,
  type SelectionDoc,
  type TriangleDoc,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
} from "../../../packages/interchange/src/index.js";
import {
  type WrappedBundleDoc,
  createBundle,
} from "../../../packages/compliance/src/index.js";
import { mortgage, taylorAshe } from "../../../packages/core/test/fixtures/mack1993.js";
import { raa } from "../../../packages/core/test/fixtures/mack1994raa.js";

/**
 * The three Phase A conformance fixtures (spec 10 / 13) and the ONE
 * authoring path that produces their frozen interchange documents. The
 * generator (`../generate-fixtures.mts`) writes what these functions
 * author; the TS runner (`conformance.test.ts`) asserts the committed
 * files still equal a fresh authoring run — so the fixtures can never
 * drift from the code without the suite going red.
 *
 * Origin labels are YEARS, not Mack's 1..10 row numbers: cross-engine
 * origin identity requires labels every engine derives identically, and
 * chainladder-python regenerates labels from origin start dates (a
 * year-labelled annual origin survives the hop; "1" does not). Taylor/Ashe
 * uses 2001-2010 — chainladder-python's own presentation of this exact
 * triangle (its `genins` sample); the mortgage data uses synthetic
 * 2001-2009 on the same rule; RAA keeps its real accident years 1981-1990.
 *
 * `createdAt` is a fixed constant (purity rule): the suite never reads a
 * clock, so regeneration is byte-deterministic.
 */

export const CREATED_AT = "2026-07-17T00:00:00Z";

/**
 * Provenance stamps PINNED to the release that authored this frozen corpus,
 * for exactly the same reason `CREATED_AT` is pinned rather than read from the
 * clock: the fixtures are byte-frozen, so every byte must be reproducible
 * forever, and a value that tracks the live build is not.
 *
 * These state WHAT AUTHORED THE CORPUS. They are deliberately NOT re-derived
 * from the packages' current versions (the same rule
 * `WRAPPED_BUNDLE_SDK_VERSIONS` below already follows). Without this pin, the
 * generator and engine stamps would follow every npm release, the stamps would
 * change the integrity tags they sit inside, and a routine version bump would
 * break the freeze on every release — churn that says nothing about
 * conformance and that the freeze policy (interop/conformance/README.md) does
 * not accept as grounds for regeneration.
 *
 * Live SDK runs are unaffected: `resultToDoc`/`triangleToDoc`/`selectionsToDoc`
 * still stamp the real current version by default, so real analyses carry
 * truthful provenance. Only this historical corpus is pinned.
 *
 * Bump these ONLY as part of a deliberate, documented corpus regeneration.
 */
export const CORPUS_GENERATOR = {
  name: "@actuarial-ts/interchange",
  version: "0.1.0",
} as const;

export const CORPUS_ENGINE = {
  name: "actuarial-ts",
  version: "0.1.0",
} as const;

/** Requested-parameter echo for the deterministic-cl TS run. */
export const CL_PARAMETERS = {
  selections: "volume-weighted all-period factors per the linked SelectionDoc",
  tailFactor: 1,
} as const;

/** Requested-parameter echo for the mack1993-vw TS run. */
export const MACK_PARAMETERS = {
  selected: "omitted (volume-weighted per Mack 1993)",
  sigma: "Mack last-column extrapolation (built in)",
  tailFactor: 1,
} as const;

export interface ConformanceFixture {
  /** Directory name under interop/conformance/fixtures/. */
  name: string;
  /** Provenance note carried into expectations.json. */
  source: string;
  triangle: Triangle;
  valuationDate: string;
}

function relabeledToYears(tri: Triangle, firstYear: number): Triangle {
  return triangleFromGrid(
    tri.kind,
    tri.origins.map((_, i) => String(firstYear + i)),
    [...tri.ages],
    tri.values.map((row) => [...row]),
  );
}

export const CONFORMANCE_FIXTURES: ConformanceFixture[] = [
  {
    name: "taylor-ashe",
    source:
      "Mack (1993) Table 1: Taylor/Ashe run-off triangle (packages/core/test/fixtures/mack1993.ts), " +
      "origins relabelled 2001-2010 per chainladder-python's genins presentation of the same data",
    triangle: relabeledToYears(taylorAshe, 2001),
    valuationDate: "2010-12-31",
  },
  {
    name: "raa",
    source:
      "Mack (1994) running example: RAA Automatic Facultative GL triangle " +
      "(packages/core/test/fixtures/mack1994raa.ts), real accident years 1981-1990",
    triangle: relabeledToYears(raa, 1981),
    valuationDate: "1990-12-31",
  },
  {
    name: "mortgage",
    source:
      "Mack (1993) Table 4: Sanders mortgage guarantee triangle (packages/core/test/fixtures/mack1993.ts), " +
      "origins relabelled 2001-2009 (cross-engine origin identity requires year labels)",
    triangle: relabeledToYears(mortgage, 2001),
    valuationDate: "2009-12-31",
  },
];

/** The all-period volume-weighted selections for a triangle (coherent with
 * the "all-wtd" intent by construction). */
export function allWtdSelections(tri: Triangle): LdfSelections {
  const dev = computeDevelopmentFactors(tri);
  const allWtd = dev.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) {
    throw new Error("computeDevelopmentFactors did not produce the all-wtd average");
  }
  return { selected: [...allWtd.values], tailFactor: 1 };
}

export function authorTriangleDoc(fixture: ConformanceFixture): TriangleDoc {
  return triangleToDoc(fixture.triangle, {
    createdAt: CREATED_AT,
    valuationDate: fixture.valuationDate,
    generator: { ...CORPUS_GENERATOR },
  });
}

export function authorSelectionDoc(
  fixture: ConformanceFixture,
  triangleDoc: TriangleDoc,
  selections: LdfSelections,
): SelectionDoc {
  return selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
    generator: { ...CORPUS_GENERATOR },
  }).doc;
}

/** runChainLadder on the volume-weighted selections → deterministic-cl doc. */
export function authorClResultDoc(
  fixture: ConformanceFixture,
  triangleDoc: TriangleDoc,
  selectionDoc: SelectionDoc,
  selections: LdfSelections,
): MethodResultDoc {
  return resultToDoc(runChainLadder(fixture.triangle, selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { ...CL_PARAMETERS },
    generator: { ...CORPUS_GENERATOR },
    engine: { ...CORPUS_ENGINE },
  });
}

/** runMack as published (volume-weighted, Mack sigma) → mack1993-vw doc.
 * No SelectionDoc: Mack runs on its own volume-weighted factors, so
 * `selectionIntegrity` is null (matching the Python side's Mack run). */
export function authorMackResultDoc(
  fixture: ConformanceFixture,
  triangleDoc: TriangleDoc,
): MethodResultDoc {
  return resultToDoc(runMack(fixture.triangle, {}), {
    triangleDoc,
    selectionDoc: null,
    createdAt: CREATED_AT,
    conventionProfile: "mack1993-vw",
    parameters: { ...MACK_PARAMETERS },
    generator: { ...CORPUS_GENERATOR },
    engine: { ...CORPUS_ENGINE },
  });
}

export interface AuthoredFixture {
  triangleDoc: TriangleDoc;
  selectionDoc: SelectionDoc;
  clResultDoc: MethodResultDoc;
  mackResultDoc: MethodResultDoc;
  expectations: Record<string, unknown>;
}

/** Authors every committed document (and expectations.json) for a fixture. */
export function authorFixture(fixture: ConformanceFixture): AuthoredFixture {
  const triangleDoc = authorTriangleDoc(fixture);
  const selections = allWtdSelections(fixture.triangle);
  const selectionDoc = authorSelectionDoc(fixture, triangleDoc, selections);
  const clResultDoc = authorClResultDoc(fixture, triangleDoc, selectionDoc, selections);
  const mackResultDoc = authorMackResultDoc(fixture, triangleDoc);

  const clProfile = CONVENTION_PROFILES["deterministic-cl"]!;
  const mackProfile = CONVENTION_PROFILES["mack1993-vw"]!;
  const expectations = {
    fixture: fixture.name,
    source: fixture.source,
    generatedBy: "interop/conformance/generate-fixtures.mts (frozen; see interop/conformance/README.md)",
    integrity: {
      triangle: triangleDoc.integrity,
      selection: selectionDoc.integrity,
      "deterministic-cl": clResultDoc.integrity,
      "mack1993-vw": mackResultDoc.integrity,
    },
    "deterministic-cl": {
      totals: { ...clResultDoc.result.totals },
      tolerance: { ...clProfile.tolerance },
    },
    "mack1993-vw": {
      totals: { ...mackResultDoc.result.totals },
      tolerance: { ...mackProfile.tolerance },
    },
  };

  return { triangleDoc, selectionDoc, clResultDoc, mackResultDoc, expectations };
}

/**
 * SDK-version echo frozen into the wrapped bundle's inner body (the fixture
 * is byte-frozen, so these are part of the public bytes; they state what
 * authored the run, they are not re-derived at read time).
 */
export const WRAPPED_BUNDLE_SDK_VERSIONS = {
  "@actuarial-ts/compliance": "0.1.0",
  "@actuarial-ts/core": "0.1.0",
} as const;

/**
 * Phase B: the wrapped reproducibility bundle (spec 3.2) for a fixture —
 * the committed proof document the Python shore's `load_bundle` (Task B3)
 * runs against. The inner bundle body is a MINIMAL inputs/parameters/results
 * payload keyed to the fixture documents by integrity tag; the interchange
 * mirror carries the triangle, the selection, and BOTH TS result docs, so a
 * non-TS consumer never parses the TS-native canonical payload. Same
 * authoring rules as everything else here: fixed createdAt, no clock reads,
 * byte-deterministic regeneration.
 */
export function authorWrappedBundleDoc(
  fixture: ConformanceFixture,
  authored: AuthoredFixture,
): WrappedBundleDoc {
  const { wrapped } = createBundle({
    inputs: {
      source: `interop/conformance/fixtures/${fixture.name}`,
      triangleIntegrity: authored.triangleDoc.integrity,
    },
    parameters: {
      selectionIntegrity: authored.selectionDoc.integrity,
      tailFactor: 1,
    },
    results: {
      "deterministic-cl": {
        integrity: authored.clResultDoc.integrity,
        totals: { ...authored.clResultDoc.result.totals },
      },
      "mack1993-vw": {
        integrity: authored.mackResultDoc.integrity,
        totals: { ...authored.mackResultDoc.result.totals },
      },
    },
    sdkVersions: { ...WRAPPED_BUNDLE_SDK_VERSIONS },
    createdAt: CREATED_AT,
    generator: { name: "@actuarial-ts/compliance", version: CORPUS_GENERATOR.version },
    wrap: {
      triangles: [authored.triangleDoc],
      selections: [authored.selectionDoc],
      results: [authored.clResultDoc, authored.mackResultDoc],
    },
  });
  return wrapped;
}
