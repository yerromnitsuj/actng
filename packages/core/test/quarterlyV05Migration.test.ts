import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  createCasualtyMetricInstances,
  prepareDiagnosticData,
  runMetricDiagnostics,
  type DiagnosticDefinition,
} from "../src/index.js";
import { quarterlyCasualtyV05Golden } from "./fixtures/quarterlyCasualtyV05Golden.js";

// Exact bytes recovered from v0.5.0 (f236442d6a257d6057823a1c55da0b569297b036).
// Type-only legacy imports are erased; the frozen module contains only inputs
// and hand-calculated expectations, with no SDK or I/O implementation.
const legacyBytes = readFileSync(
  new URL("./fixtures/quarterlyCasualtyV05Source.ts.txt", import.meta.url),
);
if (
  createHash("sha256").update(legacyBytes).digest("hex") !==
  "14e5648921f48782356092244db755e9abd284a02a7e053b7667cf0388931aed"
)
  throw new Error("The immutable v0.5.0 quarterly source fixture changed");
const legacy = {} as {
  quarterlyCasualtyLosses: Array<{
    id: string;
    group: string;
    origin: string;
    valuation: string;
    measures: Record<string, number>;
  }>;
  quarterlyCasualtyExposures: Array<{
    key: string;
    group: string;
    origin: string;
    valuation?: string;
    measures: { exposure: number };
  }>;
};
runInNewContext(
  ts.transpileModule(legacyBytes.toString("utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: legacy },
  { timeout: 1000 },
);

const counts = {
  reported: "reported",
  open: "open",
  closedNoPay: "cnp",
  closedWithPay: "cwp",
};
const frequencyIds = [
  "reported-frequency",
  "open-frequency",
  "closed-no-pay-frequency",
  "closed-with-pay-frequency",
  "non-closed-no-pay-frequency",
].map((suffix) => `casualty/count/${suffix}`);
const instances = createCasualtyMetricInstances({
  counts,
  exposure: "exposure",
  amountBindings: [
    { id: "250", paid: "paid250", incurred: "incurred250" },
    { id: "primary", paid: "paidPrimary", incurred: "incurredPrimary" },
  ],
  presentationOverrides: Object.fromEntries(
    frequencyIds.map((id) => [
      id,
      { scale: 1_000_000, displayUnit: "count per million exposure" },
    ]),
  ),
});
const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion: "1.0.0",
  id: "v05-quarterly-migration",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures: [
    {
      id: "reported",
      displayName: "Reported",
      description: "Reported",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "open",
      displayName: "Open",
      description: "Open",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "cnp",
      displayName: "CNP",
      description: "Closed no pay",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    {
      id: "cwp",
      displayName: "CWP",
      description: "Closed with pay",
      source: "loss",
      kind: "count",
      unit: "claim",
      developmentSemantics: "cumulative",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "claims",
    },
    ...["paid250", "incurred250"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss" as const,
      kind: "amount" as const,
      unit: "USD",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      basisId: "250",
    })),
    ...["paidPrimary", "incurredPrimary"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss" as const,
      kind: "amount" as const,
      unit: "USD",
      developmentSemantics: "cumulative" as const,
      aggregation: "sum" as const,
      missing: "unknown" as const,
      basisId: "primary",
    })),
    {
      id: "exposure",
      displayName: "Exposure",
      description: "Exposure",
      source: "exposure",
      kind: "exposure",
      unit: "unit",
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
      description: "Claims",
    },
  ],
  exposureBases: [
    {
      id: "earned",
      displayName: "Exposure",
      basis: "earned",
      unit: "unit",
      description: "Exposure",
    },
  ],
  amountBases: [
    {
      id: "250",
      displayName: "250 layer",
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
              transformationRef: "v05-fixture",
            },
          },
        },
      ],
    },
    {
      id: "primary",
      displayName: "Primary",
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
  ],
  derivedMeasures: [],
  formulas: CASUALTY_FORMULA_TEMPLATES,
  instances,
  reviewRules: [],
  periodAxis: {
    kind: "calendar",
    originCadence: "quarter",
    valuationCadence: "quarter",
    originAnchor: "start",
    valuationAnchor: "end",
    ageUnit: "month",
    ageOffset: 0,
  },
};

const losses = legacy.quarterlyCasualtyLosses.map(
  (row) =>
    [
      row.id,
      row.group,
      row.origin,
      row.valuation,
      {
        reported: row.measures.reportedCount!,
        open: row.measures.openCount!,
        cnp: row.measures.closedNoPayCount!,
        cwp: row.measures.closedWithPayCount!,
        paid250: row.measures.paid250!,
        incurred250: row.measures.incurred250!,
        paidPrimary: row.measures.paidPrimary!,
        incurredPrimary: row.measures.incurredPrimary!,
      },
    ] as const,
);
const exposures = legacy.quarterlyCasualtyExposures.map((row) => ({
  key: row.key,
  sourceGroup: row.group,
  origin: row.origin,
  ...(row.valuation === undefined ? {} : { valuation: row.valuation }),
  measureId: "exposure",
  value: row.measures.exposure,
  complete: true,
}));

const oldToNew: Readonly<Record<string, string>> = {
  "reported-frequency": "casualty/count/reported-frequency",
  "open-frequency": "casualty/count/open-frequency",
  "closed-no-pay-frequency": "casualty/count/closed-no-pay-frequency",
  "closed-with-pay-frequency": "casualty/count/closed-with-pay-frequency",
  "non-closed-no-pay-frequency": "casualty/count/non-closed-no-pay-frequency",
  "closed-no-pay-share": "casualty/count/closed-no-pay-share",
  "closed-with-pay-share": "casualty/count/closed-with-pay-share",
  "closed-with-pay-share-of-non-cnp":
    "casualty/count/closed-with-pay-share-of-non-closed-no-pay",
  "open-share": "casualty/count/open-share",
  "open-share-of-non-cnp": "casualty/count/open-share-of-non-closed-no-pay",
  "paid-to-incurred-250": "casualty/amount/250/paid-to-incurred",
  "incurred-250-per-exposure": "casualty/amount/250/incurred-per-exposure",
  "incurred-250-per-non-cnp":
    "casualty/amount/250/incurred-per-non-closed-no-pay-claim",
  "paid-250-per-exposure": "casualty/amount/250/paid-per-exposure",
  "paid-250-per-closed-with-pay":
    "casualty/amount/250/paid-per-closed-with-pay-claim",
  "case-250-per-open": "casualty/amount/250/case-per-open-claim",
  "paid-to-incurred-primary": "casualty/amount/primary/paid-to-incurred",
  "incurred-primary-per-exposure":
    "casualty/amount/primary/incurred-per-exposure",
  "incurred-primary-per-non-cnp":
    "casualty/amount/primary/incurred-per-non-closed-no-pay-claim",
  "paid-primary-per-exposure": "casualty/amount/primary/paid-per-exposure",
  "paid-primary-per-closed-with-pay":
    "casualty/amount/primary/paid-per-closed-with-pay-claim",
  "case-primary-per-open": "casualty/amount/primary/case-per-open-claim",
};

describe("v0.5 quarterly casualty migration reconciliation", () => {
  it("reproduces all 110 frozen records through generalized formulas", () => {
    expect(
      createHash("sha256")
        .update(
          readFileSync(
            new URL(
              "./fixtures/quarterlyCasualtyV05Golden.ts",
              import.meta.url,
            ),
          ),
        )
        .digest("hex"),
    ).toBe("42e21e829de009e4b51183a9f477b0799881a703f3a2f179eeff526ec5a1fcf3");
    const compiled = compileDiagnosticDefinition(definition);
    const prepared = prepareDiagnosticData({
      definition: compiled,
      losses: losses.map(
        ([recordId, sourceGroup, origin, valuation, measures]) => ({
          rowType: "aggregate" as const,
          recordId,
          sourceGroup,
          origin,
          valuation,
          complete: true,
          measures,
        }),
      ),
      exposures,
    });
    const result = runMetricDiagnostics({ prepared });
    expect(compiled.definition.formulas).toHaveLength(6);
    expect(compiled.definition.instances).toHaveLength(22);
    expect(result.emergence).toHaveLength(5);
    expect(result.triangles).toHaveLength(44);
    expect(
      result.latestDiagonal.map(
        ({ group, origin, valuation, developmentAge }) => ({
          group,
          origin,
          valuation,
          developmentAge,
        }),
      ),
    ).toEqual([
      {
        group: "fleet-a",
        origin: "2024-Q4",
        valuation: "2025-Q1",
        developmentAge: 6,
      },
      {
        group: "fleet-a",
        origin: "2025-Q1",
        valuation: "2025-Q1",
        developmentAge: 3,
      },
      {
        group: "fleet-b",
        origin: "2024-Q4",
        valuation: "2025-Q1",
        developmentAge: 6,
      },
    ]);
    expect(
      prepared.exposures.map((item) => ({
        key: item.key,
        status: item.status,
        value: item.value,
        deduplicated: item.status === "valid" ? item.deduplicated : null,
      })),
    ).toEqual([
      {
        key: "fleet-a-unit-2024q4",
        status: "valid",
        value: 820000,
        deduplicated: 1,
      },
      {
        key: "fleet-a-unit-2025q1",
        status: "valid",
        value: 850000,
        deduplicated: 0,
      },
      {
        key: "fleet-b-unit-2024q4",
        status: "valid",
        value: 430000,
        deduplicated: 0,
      },
    ]);
    const actual = result.emergence
      .flatMap((point) =>
        Object.values(point.metrics).map((metric) => ({
          group: point.group,
          origin: point.origin.replace("-Q", "Q"),
          valuation: point.valuation.replace("-Q", "Q"),
          ageMonths: point.developmentAge,
          metricId: Object.entries(oldToNew).find(
            ([, id]) => id === metric.instanceId,
          )![0],
          rawNumerator: metric.calculation.numerator.value,
          rawDenominator: metric.calculation.denominator.value,
          value: metric.presentation.value,
          warningCodes: point.findings
            .filter(
              (finding) => finding.code === "diagnostic-exposure-deduplicated",
            )
            .map(() => "DUPLICATE_EXPOSURE_KEY"),
        })),
      )
      .sort((a, b) =>
        `${a.group}|${a.origin}|${a.valuation}|${a.metricId}`.localeCompare(
          `${b.group}|${b.origin}|${b.valuation}|${b.metricId}`,
        ),
      );
    const expected = [...quarterlyCasualtyV05Golden].sort((a, b) =>
      `${a.group}|${a.origin}|${a.valuation}|${a.metricId}`.localeCompare(
        `${b.group}|${b.origin}|${b.valuation}|${b.metricId}`,
      ),
    );
    expect(actual).toEqual(expected);
  });
});
