import {
  CASUALTY_FORMULA_TEMPLATES,
  getPreparedDiagnosticDataIdentity,
  getMetricDiagnosticsResultIdentity,
  type DiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import { createDiagnosticRunIdentity } from "../../src/index.js";

export const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "fleet",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported",
      description: "Reported claims",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "exposure",
      displayName: "Exposure",
      description: "Earned exposure",
      source: "exposure",
      kind: "exposure",
      unit: "vehicle-year",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      exposureBasisId: "earned",
      exposureTiming: "origin-static",
    },
  ],
  countPopulations: [
    {
      id: "claims",
      displayName: "Claims",
      subject: "claim",
      unit: "claim",
      description: "One per claim",
    },
  ],
  exposureBases: [
    {
      id: "earned",
      displayName: "Earned vehicles",
      basis: "earned",
      unit: "vehicle-year",
      description: "Earned vehicle years",
    },
  ],
  amountBases: [],
  derivedMeasures: [],
  formulas: [CASUALTY_FORMULA_TEMPLATES[0]],
  instances: [
    {
      id: "reported-frequency",
      version: "1.0.0",
      formulaId: "frequency",
      bindings: {
        claims: { op: "measure", measureId: "reported" },
        exposure: { op: "measure", measureId: "exposure" },
      },
      presentation: {
        displayName: "Reported frequency",
        description: "Reported per exposure",
        displayUnit: "claim per vehicle-year",
        scale: 1,
        numeratorLabel: "reported",
        denominatorLabel: "exposure",
      },
      rules: [],
    },
  ],
  reviewRules: [],
  periodAxis: {
    kind: "calendar",
    originCadence: "year",
    valuationCadence: "quarter",
    originAnchor: "start",
    valuationAnchor: "end",
    ageUnit: "month",
    ageOffset: 0,
  },
};

export function completedRun(overrides: Record<string, unknown> = {}) {
  const outcome = runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
      definition,
      losses: [
        {
          rowType: "aggregate",
          recordId: "r1",
          sourceGroup: "fleet",
          origin: "2025",
          valuation: "2025Q1",
          complete: true,
          source: { artifactId: "loss-run", sourceRow: 2 },
          measures: { reported: 4 },
        },
      ],
      exposures: [
        {
          key: "e1",
          sourceGroup: "fleet",
          origin: "2025",
          measureId: "exposure",
          value: 20,
          complete: true,
          source: { artifactId: "exposures", sourceRow: 2 },
        },
      ],
      datasetArtifactId: "loss-run",
      runPresetId: "annual-frequency-v1",
      ...overrides,
    }),
  );
  if (outcome.status !== "completed")
    throw new Error("fixture unexpectedly blocked");
  return outcome;
}

export function evidence(run = completedRun()) {
  return {
    completedRun: run,
    inputArtifacts: [
      {
        id: "loss-run",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([1]),
      },
      {
        id: "exposures",
        scope: "input" as const,
        assurance: "sdk-computed" as const,
        bytes: new Uint8Array([2]),
      },
    ],
    preparationArtifacts: [],
    preparationLineage: [],
  };
}

/** Public projections with the exact §15 envelopes; no internal identity builder. */
export async function diagnosticIdentityVectors() {
  const run = completedRun({ expectedCells: [] });
  const provenance = await createDiagnosticRunIdentity(evidence(run));
  const definition = provenance.definition.definition;
  const instance = definition.instances[0]!;
  const calculation = {
    formulaFingerprint: provenance.definition.identities.formulaById.frequency,
    instance: {
      id: instance.id,
      version: instance.version,
      formulaId: instance.formulaId,
      bindings: instance.bindings,
    },
    lossRowGrain: definition.lossRowGrain,
    measures: definition.measures.map(
      ({
        id,
        source,
        kind,
        unit,
        developmentSemantics,
        aggregation,
        missing,
        basisId,
        countPopulationId,
        exposureBasisId,
        exposureTiming,
      }) => ({
        id,
        source,
        kind,
        unit,
        developmentSemantics,
        aggregation,
        missing,
        basisId,
        countPopulationId,
        exposureBasisId,
        exposureTiming,
      }),
    ),
    countPopulations: definition.countPopulations.map(
      ({ id, subject, unit, attributes }) => ({
        id,
        subject,
        unit,
        attributes,
      }),
    ),
    exposureBases: definition.exposureBases.map(
      ({ id, basis, unit, attributes }) => ({ id, basis, unit, attributes }),
    ),
    amountBases: [],
    derivedMeasures: [],
  };
  const preparation = getPreparedDiagnosticDataIdentity(run.prepared);
  const manifest = {
    ...provenance.manifest,
    executionPolicy: {
      gate: provenance.manifest.executionPolicy.gate,
      review: {
        body: provenance.review.identityBody,
        reportFingerprint: provenance.review.reportFingerprint,
      },
    },
  };
  return {
    formula: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-formula",
        formula: definition.formulas[0],
      },
      tag: provenance.definition.identities.formulaById.frequency,
    },
    calculation: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-calculation",
        calculation,
      },
      tag: provenance.definition.identities.calculationByInstanceId[
        instance.id
      ],
    },
    definition: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-definition",
        definition,
      },
      tag: provenance.definition.identities.definition,
    },
    preparation: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-preparation",
        preparation,
      },
      tag: provenance.manifest.preparationFingerprint,
    },
    expectedGrid: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-expected-cell-grid",
        expectedCells: preparation.expectedCells,
      },
      tag: provenance.manifest.expectedCellGridFingerprint,
    },
    review: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-review-report",
        review: provenance.review.identityBody,
      },
      tag: provenance.review.reportFingerprint,
    },
    run: {
      payload: { identityVersion: 1, kind: "diagnostic-run", manifest },
      tag: provenance.runFingerprint,
    },
    result: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-result",
        result: getMetricDiagnosticsResultIdentity(provenance.result),
      },
      tag: provenance.resultFingerprint,
    },
    binding: {
      payload: {
        identityVersion: 1,
        kind: "diagnostic-run-result",
        runFingerprint: provenance.runFingerprint,
        resultFingerprint: provenance.resultFingerprint,
      },
      tag: provenance.runResultFingerprint,
    },
  };
}
