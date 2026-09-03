import {
  CASUALTY_DIAGNOSTIC_COMPONENTS as C,
  CASUALTY_QUARTERLY_METRICS,
  createCasualtyQuarterlyMetrics,
  runMetricDiagnostics,
  type DiagnosticLossRow,
  type MetricDefinition,
} from "@actuarial-ts/core";
import { reviewDiagnosticData, runValidatedMetricDiagnostics } from "@actuarial-ts/data";
import {
  INTERCHANGE_PACKAGE_VERSION,
  INTERCHANGE_SPEC_VERSION,
  stampIntegrity,
} from "@actuarial-ts/interchange";
import { createDiagnosticsProvenance } from "@actuarial-ts/compliance";
import { defineActuarialTool } from "@actuarial-ts/agents";

const losses: DiagnosticLossRow[] = [{
  id: "fleet-a-2024q4-at-2024q4",
  group: "fleet-a",
  origin: "2024Q4",
  valuation: "2024Q4",
  ageMonths: 3,
  measures: {
    [C.reported]: 40,
    [C.open]: 18,
    [C.closedNoPay]: 8,
    [C.closedWithPay]: 14,
    [C.paid250]: 280_000,
    [C.incurred250]: 520_000,
    [C.paidPrimary]: 360_000,
    [C.incurredPrimary]: 710_000,
  },
}];

const metrics: readonly MetricDefinition[] = createCasualtyQuarterlyMetrics();
const result = runMetricDiagnostics({ losses, metrics: CASUALTY_QUARTERLY_METRICS });
runValidatedMetricDiagnostics({ losses }, { metrics });
reviewDiagnosticData(losses, [], { exposureMeasure: C.exposure });

const provenance = createDiagnosticsProvenance({
  packageVersions: { "@actuarial-ts/core": "0.5.0" },
  formulaPack: { id: "casualty-quarterly", version: "1" },
  metrics,
  exposure: { basis: "earned exposure", frequencyScale: 1_000_000 },
  sparsePolicy: "preserve-null",
  ageConvention: "quarter-end inclusive",
  completePeriodCutoffs: { through: "2025Q1" },
  inputReferences: [{ id: "loss-run" }],
});

const legacyOpaqueEnvelope = stampIntegrity({
  interchangeVersion: INTERCHANGE_SPEC_VERSION,
  kind: "triangle",
  generator: { name: "migration-fixture", version: INTERCHANGE_PACKAGE_VERSION },
  createdAt: "2026-09-03T00:00:00Z",
  extensions: { diagnostics: provenance },
  triangle: { id: "placeholder" },
});

const legacyToolFactory: typeof defineActuarialTool = defineActuarialTool;

void result;
void legacyOpaqueEnvelope;
void legacyToolFactory;
