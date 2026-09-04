/** Explicit host-owned inputs for extracted documentation fragments.
 * Copied into an isolated npm consumer and checked against packed public types.
 * No workspace implementation or test fixture can resolve from that consumer.
 */
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  createCasualtyMetricInstances,
  type ClaimSnapshot,
  type DiagnosticDefinition,
  type DiagnosticExposureObservation,
  type DiagnosticLossInput,
} from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import {
  createLedger,
  createDiagnosticRunIdentity,
  type EstimateMetadata,
  type MethodUse,
} from "@actuarial-ts/compliance";

export const claims: ClaimSnapshot[] = [
  [100, 180, 240, 280, 300],
  [120, 210, 290, 340],
  [150, 270, 350],
  [180, 300],
  [220],
].flatMap((row, originIndex) =>
  row.map((paidToDate, ageIndex) => ({
    claimId: `claim-${originIndex}`,
    accidentDate: `${2021 + originIndex}-01-01`,
    reportDate: `${2021 + originIndex}-01-02`,
    evaluationDate: `${2021 + originIndex + ageIndex}-12-31`,
    paidToDate,
    caseReserve: 100,
    status: "open" as const,
  })),
);
export const claimSnapshots = claims;
export const generatedAt = "2026-09-03T00:00:00Z";
export const ledger = createLedger();
export const methods: MethodUse[] = [{ methodId: "chainLadder" }];
export const metadata: EstimateMetadata = {
  intendedPurpose: "Documentation example, not an actuarial opinion",
  intendedMeasure: { kind: "central-estimate" },
  basis: { grossNet: "gross", laeTreatment: "excluding-lae" },
  accountingDate: "2025-12-31",
  valuationDate: "2025-12-31",
};

export const measures: DiagnosticDefinition["measures"] = [
  ...["reported", "open", "closed-no-pay", "closed-with-pay"].map((id) => ({
    id,
    displayName: id,
    description: id,
    source: "loss" as const,
    kind: "count" as const,
    unit: "claim",
    developmentSemantics:
      id === "open" ? ("point-in-time" as const) : ("cumulative" as const),
    aggregation: "sum" as const,
    missing: "unknown" as const,
    countPopulationId: "claims",
  })),
  ...["gross-paid", "gross-incurred", "primary-paid", "primary-incurred"].map(
    (id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss" as const,
      kind: "amount" as const,
      unit: "USD",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      basisId: id.startsWith("gross") ? "gross" : "primary-250k",
    }),
  ),
  {
    id: "earned-vehicle-years",
    displayName: "Exposure",
    description: "Earned vehicle years",
    source: "exposure",
    kind: "exposure",
    unit: "vehicle-year",
    developmentSemantics: "point-in-time",
    aggregation: "sum",
    missing: "unknown",
    exposureBasisId: "earned",
    exposureTiming: "origin-static",
  },
];
export const countPopulations: DiagnosticDefinition["countPopulations"] = [
  {
    id: "claims",
    displayName: "Claims",
    subject: "claim",
    unit: "claim",
    description: "Claims",
  },
];
export const exposureBases: DiagnosticDefinition["exposureBases"] = [
  {
    id: "earned",
    displayName: "Earned exposure",
    basis: "earned",
    unit: "vehicle-year",
    description: "Earned vehicle years",
  },
];
export const amountBases: DiagnosticDefinition["amountBases"] = [
  {
    id: "gross",
    displayName: "Gross",
    currency: "USD",
    perspective: "gross",
    components: [
      {
        id: "indemnity",
        treatment: "included",
        limitation: { kind: "unlimited" },
      },
    ],
  },
  {
    id: "primary-250k",
    displayName: "Primary $250k",
    currency: "USD",
    perspective: "gross",
    components: [
      {
        id: "indemnity",
        treatment: "included",
        limitation: {
          kind: "pre-limited",
          attachment: 0,
          limit: 250_000,
          application: "source-defined",
          derivation: {
            kind: "external",
            actor: "source",
            transformationRef: "transform-script",
          },
        },
      },
    ],
  },
];
export const reviewRules: DiagnosticDefinition["reviewRules"] = [];
export const periodAxis: DiagnosticDefinition["periodAxis"] = {
  kind: "calendar",
  originCadence: "year",
  valuationCadence: "quarter",
  originAnchor: "start",
  valuationAnchor: "end",
  ageUnit: "month",
  ageOffset: 0,
};
export const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "fleet-diagnostics",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures,
  countPopulations,
  exposureBases,
  amountBases,
  derivedMeasures: [],
  formulas: CASUALTY_FORMULA_TEMPLATES,
  instances: createCasualtyMetricInstances({
    counts: {
      reported: "reported",
      open: "open",
      closedNoPay: "closed-no-pay",
      closedWithPay: "closed-with-pay",
    },
    exposure: "earned-vehicle-years",
    amountBindings: [
      { id: "gross", paid: "gross-paid", incurred: "gross-incurred" },
      {
        id: "primary-250k",
        paid: "primary-paid",
        incurred: "primary-incurred",
      },
    ],
  }),
  reviewRules,
  periodAxis,
};
export const compiledDefinition = compileDiagnosticDefinition(definition);
export const losses: DiagnosticLossInput[] = [
  {
    rowType: "aggregate",
    recordId: "row-1",
    sourceGroup: "fleet",
    origin: "2025",
    valuation: "2025-Q1",
    complete: true,
    source: { artifactId: "loss-run", sourceRow: 2 },
    measures: {
      reported: 4,
      open: 2,
      "closed-no-pay": 1,
      "closed-with-pay": 1,
      "gross-paid": 100,
      "gross-incurred": 160,
      "primary-paid": 80,
      "primary-incurred": 140,
    },
  },
];
export const exposures: DiagnosticExposureObservation[] = [
  {
    key: "exp-2025",
    sourceGroup: "fleet",
    origin: "2025",
    measureId: "earned-vehicle-years",
    value: 20,
    complete: true,
    source: { artifactId: "exposures", sourceRow: 2 },
  },
];
export const lossRunBytes = new TextEncoder().encode(JSON.stringify(losses));
export const exposureBytes = new TextEncoder().encode(
  JSON.stringify(exposures),
);
export const archiveSha256 = "0".repeat(64);
export const transformCommit = "1".repeat(40);
export const inputs = { losses, exposures };
export const parameters = { purpose: "documentation verification" };
export const outcome = runValidatedMetricDiagnostics(
  validateDiagnosticRunInput({
    definition,
    losses,
    exposures,
    filter: { instanceIds: ["casualty/count/reported-frequency"] },
    runPresetId: "annual-review-v1",
    datasetArtifactId: "loss-run",
  }),
);
export async function runApprovedPreset(input: {
  tenantId: string;
  instanceIds: readonly string[];
}) {
  if (input.tenantId !== "documentation-tenant")
    throw new Error("Unexpected tenant");
  const completedRun = runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
      definition,
      losses,
      exposures,
      filter: { instanceIds: input.instanceIds },
      runPresetId: "annual-review-v1",
      datasetArtifactId: "loss-run",
    }),
  );
  if (completedRun.status !== "completed")
    throw new Error("Documentation fixture unexpectedly blocked");
  return createDiagnosticRunIdentity({
    completedRun,
    inputArtifacts: [
      {
        id: "loss-run",
        scope: "input",
        assurance: "sdk-computed",
        bytes: lossRunBytes,
      },
      {
        id: "exposures",
        scope: "input",
        assurance: "sdk-computed",
        bytes: exposureBytes,
      },
    ],
    preparationArtifacts: [
      {
        id: "transform-script",
        scope: "preparation",
        assurance: "caller-declared",
        algorithm: "git-sha",
        value: transformCommit,
      },
    ],
    preparationLineage: [],
  });
}
