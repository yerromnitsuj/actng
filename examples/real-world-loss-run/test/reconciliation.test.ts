import { describe, expect, it } from "vitest";
import {
  registerSourceFile,
  sourceExpected,
} from "../../../tools/validation/source-contract.js";
import { readFileSync } from "node:fs";
import {
  parseCsv,
  parseExposureCsv,
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
} from "@actuarial-ts/data";
import { buildRealWorldDiagnosticDefinition } from "../src/main.js";
registerSourceFile(import.meta.url);
const sourceControls = sourceExpected<Record<string, number>>(
  "casdatasets-freclaimset2motor",
  "controls",
);

const table = parseCsv(
  readFileSync(
    new URL("../data/diagnostic-snapshots.csv", import.meta.url),
    "utf8",
  ),
);
const columns = table.rows[0]!;
const sourceRows = table.rows
  .slice(1)
  .map((cells) =>
    Object.fromEntries(
      columns.map((column, index) => [column, Number(cells[index])]),
    ),
  );
const sourceLosses = sourceRows.map((row, index) => ({
  rowType: "aggregate" as const,
  recordId: `diagnostic-row-${index + 2}`,
  sourceGroup: "motor",
  origin: String(row.origin),
  valuation: String(row.valuation),
  complete: true,
  source: {
    artifactId: "diagnostic-snapshots",
    sourceFile: "data/diagnostic-snapshots.csv",
    sourceRow: index + 2,
  },
  measures: {
    reported: row.reported!,
    open: row.open!,
    "closed-no-pay": row.closed_no_pay!,
    "closed-with-pay": row.closed_with_pay!,
    "gross-paid": row.gross_paid!,
    "gross-incurred": row.gross_incurred!,
    "net-paid": row.net_paid!,
    "net-incurred": row.net_incurred!,
  } as Record<string, number>,
}));
const sourceExposures = parseExposureCsv(
  readFileSync(new URL("../data/exposures.csv", import.meta.url), "utf8"),
).exposures.map((row, index) => ({
  key: `exposure-${row.origin}`,
  sourceGroup: "motor",
  origin: row.origin,
  measureId: "insurance-years",
  value: row.exposureUnits!,
  complete: true,
  source: {
    artifactId: "exposures",
    sourceFile: "data/exposures.csv",
    sourceRow: index + 2,
  },
}));
const coordinate = (row: (typeof sourceLosses)[number]) => ({
  sourceGroup: "motor",
  origin: row.origin,
  valuation: row.valuation,
  developmentAge: (Number(row.valuation) - Number(row.origin) + 1) * 12,
  ageUnit: "month",
});

function run(
  ruleId?: string,
  losses = sourceLosses,
  exposures = sourceExposures,
  fail = false,
) {
  const definition = buildRealWorldDiagnosticDefinition();
  return runValidatedMetricDiagnostics(
    validateDiagnosticRunInput({
      definition: {
        ...definition,
        reviewRules: definition.reviewRules
          .filter((rule) => ruleId === undefined || rule.id === ruleId)
          .map((rule) => (fail ? { ...rule, severity: "fail" } : rule)),
      },
      losses,
      exposures,
    }),
  );
}

describe("CASdatasets source reconciliation", () => {
  it("independently reconciles all source cell counts, layers, exposure years, and latest controls", () => {
    expect(table.warnings).toEqual([]);
    expect(sourceRows).toHaveLength(sourceControls.triangleCells!);
    for (const row of sourceRows) {
      expect(row.reported).toBe(
        row.open! + row.closed_no_pay! + row.closed_with_pay!,
      );
      expect(row.closed_no_pay).toBeLessThanOrEqual(row.reported!);
      expect(row.net_paid).toBeLessThanOrEqual(row.gross_paid!);
      expect(row.net_incurred).toBeLessThanOrEqual(row.gross_incurred!);
      expect(Object.values(row).every(Number.isFinite)).toBe(true);
    }
    expect(sourceExposures.map((row) => Number(row.origin))).toEqual(
      Array.from({ length: 20 }, (_, i) => 1995 + i),
    );
    expect(sourceExposures.every((row) => row.value > 0)).toBe(true);
    expect(sourceExposures.reduce((sum, row) => sum + row.value, 0)).toBe(
      sourceControls.exposureTotal,
    );
    const latest = sourceRows.filter((row) => row.valuation === 2014);
    expect(latest).toHaveLength(20);
    expect(
      Object.fromEntries(
        ["gross_paid", "gross_incurred", "net_paid", "net_incurred"].map(
          (key) => [key, latest.reduce((sum, row) => sum + row[key]!, 0)],
        ),
      ),
    ).toEqual(
      sourceExpected("casdatasets-freclaimset2motor", "latestControls"),
    );
  });

  it("reconstructs the exact 73 finding coordinates and source arrays independently from the frozen CSV", () => {
    const expected = [];
    const signals = [
      [
        "casualty/review/closed-reopen-signal",
        (row: (typeof sourceLosses)[number]) =>
          row.measures["closed-no-pay"]! + row.measures["closed-with-pay"]!,
      ],
      [
        "casualty/review/gross-incurred-monotonic",
        (row: (typeof sourceLosses)[number]) => row.measures["gross-incurred"]!,
      ],
      [
        "casualty/review/net-incurred-monotonic",
        (row: (typeof sourceLosses)[number]) => row.measures["net-incurred"]!,
      ],
    ] as const;
    for (const [ruleId, value] of signals) {
      for (let year = 1995; year <= 2014; year++) {
        const rows = sourceLosses
          .filter((row) => row.origin === String(year))
          .sort((a, b) => Number(a.valuation) - Number(b.valuation));
        for (let i = 1; i < rows.length; i++) {
          const previous = rows[i - 1]!,
            current = rows[i]!;
          if (value(current) < value(previous))
            expected.push({
              ruleId,
              scope: {
                kind: "valuation-pair",
                previous: coordinate(previous),
                current: coordinate(current),
                sources: [previous.source, current.source],
              },
            });
        }
      }
    }
    expect(expected).toHaveLength(sourceControls.findings!);
    const outcome = run();
    expect(outcome.status).toBe("completed");
    expect(
      outcome.review.evaluations
        .filter((evaluation) => evaluation.status === "triggered")
        .map(({ ruleId, scope }) => ({ ruleId, scope })),
    ).toEqual(expected);
  });

  const ruleIds = buildRealWorldDiagnosticDefinition().reviewRules.map(
    (rule) => rule.id,
  );
  it.each(ruleIds)(
    "a controlled source error triggers %s and its fail severity blocks the default gate",
    (ruleId) => {
      const definition = buildRealWorldDiagnosticDefinition();
      const rule = definition.reviewRules.find(
        (candidate) => candidate.id === ruleId,
      )!;
      const pairOnly = rule.kind === "monotonic";
      const losses = structuredClone(
        pairOnly
          ? sourceLosses.filter(
              (row) => row.origin === "1995" && Number(row.valuation) <= 1996,
            )
          : sourceLosses,
      );
      const exposures = structuredClone(
        pairOnly
          ? sourceExposures.filter((row) => row.origin === "1995")
          : sourceExposures,
      );
      expect(run(ruleId, losses, exposures, true).status).toBe("completed");
      const current = pairOnly
        ? losses[1]!
        : rule.kind === "control-total"
          ? losses.at(-1)!
          : losses[0]!;
      if (ruleId.endsWith("count-reconciliation")) current.measures.reported!++;
      else if (ruleId.endsWith("closed-no-pay-bound"))
        current.measures["closed-no-pay"] = current.measures.reported! + 1;
      else if (ruleId.endsWith("positive-exposure")) exposures[0]!.value = 0;
      else if (ruleId.endsWith("closed-reopen-signal"))
        current.measures["closed-with-pay"] =
          losses[0]!.measures["closed-no-pay"]! +
          losses[0]!.measures["closed-with-pay"]! -
          current.measures["closed-no-pay"]! -
          1;
      else if (rule.kind === "monotonic") {
        const key = ruleId.includes("gross")
          ? "gross-incurred"
          : "net-incurred";
        current.measures[key] = losses[0]!.measures[key]! - 1;
      } else if (rule.kind === "layer-order") {
        const suffix = ruleId.includes("paid") ? "paid" : "incurred";
        current.measures[`net-${suffix}`] =
          current.measures[`gross-${suffix}`]! + 1;
      } else if (ruleId.endsWith("exposure-control")) exposures[0]!.value++;
      else if (
        rule.kind === "control-total" &&
        rule.expression.op === "measure"
      )
        current.measures[rule.expression.measureId]!++;
      else throw new Error(`Uncovered reconciliation ${ruleId}`);
      const outcome = run(ruleId, losses, exposures, true);
      expect(outcome.status).toBe("blocked");
      expect(outcome.gate.reviewGate).toBe("blocked");
      const triggered = outcome.review.evaluations.filter(
        (evaluation) => evaluation.status === "triggered",
      );
      expect([
        ...new Set(triggered.map((evaluation) => evaluation.ruleId)),
      ]).toEqual([ruleId]);
      expect(
        triggered.every((evaluation) => evaluation.severity === "fail"),
      ).toBe(true);
      if (rule.kind === "control-total") {
        expect(triggered).toHaveLength(1);
        expect(triggered[0]!.left).toBe(rule.expected + 1);
        expect(triggered[0]!.right).toBe(rule.expected);
      } else if (rule.kind === "monotonic") {
        expect(triggered.map((evaluation) => evaluation.scope)).toEqual([
          {
            kind: "valuation-pair",
            previous: coordinate(losses[0]!),
            current: coordinate(current),
            sources: [losses[0]!.source, current.source],
          },
        ]);
      } else if (!ruleId.endsWith("positive-exposure")) {
        expect(triggered.map((evaluation) => evaluation.scope)).toEqual([
          {
            kind: "cell",
            cell: coordinate(current),
            sources: [current.source],
          },
        ]);
      } else {
        expect(triggered).toHaveLength(20);
        expect(
          triggered.every(
            (evaluation) =>
              evaluation.scope.kind === "cell" &&
              evaluation.scope.cell.origin === "1995",
          ),
        ).toBe(true);
      }
    },
    30_000,
  );
});
