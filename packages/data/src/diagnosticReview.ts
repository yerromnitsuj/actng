import {
  developmentAgeMonths,
  parseQuarterPeriod,
  type DevelopmentAgeConvention,
  type DiagnosticExposureRow,
  type DiagnosticLossRow,
  type DiagnosticMeasureMap,
} from "@actuarial-ts/core";
import {
  createNotEvaluatedDataCheck,
  createStructuredDataCheck,
  summarizeDataChecks,
  type DataCheck,
  type DataFinding,
  type DataFindingContext,
  type DataReviewReport,
} from "./review.js";

export interface DiagnosticReviewSnapshot extends DiagnosticLossRow {
  source?: Pick<DataFindingContext, "sourceFile" | "sourceRow">;
}

export interface DiagnosticReviewExposure extends DiagnosticExposureRow {
  source?: Pick<DataFindingContext, "sourceFile" | "sourceRow">;
}

export interface DiagnosticAmountPair {
  id: string;
  paidMeasure: string;
  incurredMeasure: string;
}

export interface DiagnosticLayerReviewDefinition extends DiagnosticAmountPair {
  /** This layer must be no greater than the named broader layer. */
  broaderLayerId?: string;
}

export interface DiagnosticLayerControlTotal {
  id: string;
  measure: string;
  expected: number;
  group?: string;
  origin?: string;
  valuation?: string;
}

export interface LegacyDiagnosticGroupingAssignment {
  key: string;
  group: string;
  source?: Pick<DataFindingContext, "sourceFile" | "sourceRow">;
}

export interface CachedFormulaProvenance {
  id: string;
  sourceFile?: string;
  sourceRow?: number;
  /** Formula text when the source cell is formula-backed. */
  formula?: string;
  /** A cached numeric value imported from the workbook. */
  cachedValue?: number | null;
  declaredFormulaSource: boolean;
}

export const DIAGNOSTIC_REVIEW_CHECK_CODES = [
  "duplicate-aggregate-snapshot",
  "duplicate-exposure-key",
  "invalid-development-age",
  "development-age-mismatch",
  "valuation-before-origin",
  "count-reconciliation",
  "closed-no-pay-exceeds-reported",
  "paid-exceeds-incurred",
  "cumulative-paid-decreasing",
  "cumulative-reported-decreasing",
  "closed-reopen-signal",
  "layer-order",
  "layer-control-reconciliation",
  "loss-without-exposure",
  "exposure-without-loss",
  "zero-exposure",
  "incomplete-exposure",
  "inconsistent-group-mapping",
  "cached-formula-provenance",
] as const;

export type DiagnosticReviewCheckCode = (typeof DIAGNOSTIC_REVIEW_CHECK_CODES)[number];

export interface ReviewDiagnosticDataOptions {
  reportedMeasure?: string;
  openMeasure?: string;
  closedNoPayMeasure?: string;
  closedWithPayMeasure?: string;
  exposureMeasure?: string;
  amountPairs?: readonly DiagnosticAmountPair[];
  layers?: readonly DiagnosticLayerReviewDefinition[];
  controlTotals?: readonly DiagnosticLayerControlTotal[];
  groupingAssignments?: readonly LegacyDiagnosticGroupingAssignment[];
  cachedFormulaProvenance?: readonly CachedFormulaProvenance[];
  ageConvention?: DevelopmentAgeConvention;
  tolerance?: { absolute?: number; relative?: number; ageMonths?: number };
  severities?: Partial<Record<DiagnosticReviewCheckCode, "warning" | "fail">>;
}

const DESCRIPTIONS: Record<DiagnosticReviewCheckCode, string> = {
  "duplicate-aggregate-snapshot": "No group/origin/valuation aggregate snapshot key appears twice",
  "duplicate-exposure-key": "Every exposure key is unique (repeated valuation copies remain reviewable)",
  "invalid-development-age": "Development ages are finite, non-negative quarterly month counts",
  "development-age-mismatch": "Recorded age agrees with origin, valuation, and the selected age convention",
  "valuation-before-origin": "No valuation quarter precedes its origin quarter",
  "count-reconciliation": "Reported count equals open plus closed-no-pay plus closed-with-pay count",
  "closed-no-pay-exceeds-reported": "Closed-no-pay count does not exceed reported count",
  "paid-exceeds-incurred": "Paid does not exceed incurred on any configured amount basis",
  "cumulative-paid-decreasing": "Cumulative paid does not decrease across valuation snapshots",
  "cumulative-reported-decreasing": "Cumulative reported count does not decrease across valuation snapshots",
  "closed-reopen-signal": "Cumulative closed count does not decrease without a reopen explanation",
  "layer-order": "Narrower layer amounts do not exceed their configured broader layers",
  "layer-control-reconciliation": "Layer measures reconcile to caller-supplied control totals",
  "loss-without-exposure": "Every group/origin loss key has exposure",
  "exposure-without-loss": "Every group/origin exposure key has loss data",
  "zero-exposure": "Exposure is not explicitly zero",
  "incomplete-exposure": "Exposure records are complete and carry the configured measure",
  "inconsistent-group-mapping": "Each caller grouping key maps to exactly one group",
  "cached-formula-provenance": "Cached workbook values retain formula provenance when declared formula-derived",
};

const DEFAULT_SEVERITY: Record<DiagnosticReviewCheckCode, "warning" | "fail"> = {
  "duplicate-aggregate-snapshot": "fail",
  "duplicate-exposure-key": "fail",
  "invalid-development-age": "fail",
  "development-age-mismatch": "fail",
  "valuation-before-origin": "fail",
  "count-reconciliation": "fail",
  "closed-no-pay-exceeds-reported": "fail",
  "paid-exceeds-incurred": "fail",
  "cumulative-paid-decreasing": "warning",
  "cumulative-reported-decreasing": "fail",
  "closed-reopen-signal": "warning",
  "layer-order": "fail",
  "layer-control-reconciliation": "fail",
  "loss-without-exposure": "warning",
  "exposure-without-loss": "warning",
  "zero-exposure": "fail",
  "incomplete-exposure": "fail",
  "inconsistent-group-mapping": "fail",
  "cached-formula-provenance": "warning",
};

function context(row: DiagnosticReviewSnapshot | DiagnosticReviewExposure): DataFindingContext {
  return {
    origin: row.origin,
    group: row.group,
    ...( "valuation" in row && row.valuation !== undefined ? { valuation: row.valuation } : {}),
    ...( "ageMonths" in row ? { ageMonths: row.ageMonths } : {}),
    ...row.source,
  };
}

function finding(code: DiagnosticReviewCheckCode, message: string, ctx?: DataFindingContext): DataFinding {
  return { code, message, ...(ctx && Object.values(ctx).some((value) => value !== undefined) ? { context: ctx } : {}) };
}

function finite(measures: DiagnosticMeasureMap, name: string): number | null {
  const value = measures[name];
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function exceeds(a: number, b: number, absolute: number, relative: number): boolean {
  return a - b > absolute + relative * Math.max(1, Math.abs(a), Math.abs(b));
}

function differs(a: number, b: number, absolute: number, relative: number): boolean {
  return Math.abs(a - b) > absolute + relative * Math.max(1, Math.abs(a), Math.abs(b));
}

function make(
  code: DiagnosticReviewCheckCode,
  findings: readonly DataFinding[],
  options: ReviewDiagnosticDataOptions,
): DataCheck {
  return createStructuredDataCheck(
    code,
    DESCRIPTIONS[code],
    options.severities?.[code] ?? DEFAULT_SEVERITY[code],
    findings,
  );
}

function notEvaluated(code: DiagnosticReviewCheckCode, reason: string): DataCheck {
  return createNotEvaluatedDataCheck(code, DESCRIPTIONS[code], reason);
}

interface MeasureCoverage {
  applicable: boolean;
  findings: DataFinding[];
}

function reviewMeasureCoverage(
  code: DiagnosticReviewCheckCode,
  snapshots: readonly DiagnosticReviewSnapshot[],
  measureNames: readonly string[],
): MeasureCoverage {
  const required = [...new Set(measureNames)];
  const applicable = snapshots.some((row) => required.some(
    (name) => Object.prototype.hasOwnProperty.call(row.measures, name),
  ));
  if (!applicable) return { applicable: false, findings: [] };

  const findings: DataFinding[] = [];
  for (const row of snapshots) {
    const unavailable = required.filter((name) => finite(row.measures, name) === null);
    if (unavailable.length > 0) findings.push(finding(
      code,
      `Required measure${unavailable.length === 1 ? "" : "s"} missing or non-finite: ${unavailable.join(", ")}`,
      context(row),
    ));
  }
  return { applicable: true, findings };
}

/** Known violations and incomplete inputs remain reportable; absent inputs do not pass. */
function makeWithCoverage(
  code: DiagnosticReviewCheckCode,
  findings: readonly DataFinding[],
  coverage: MeasureCoverage,
  noApplicableReason: string,
  options: ReviewDiagnosticDataOptions,
): DataCheck {
  const combined = [...findings, ...coverage.findings];
  if (combined.length > 0 || coverage.applicable) return make(code, combined, options);
  return notEvaluated(code, noApplicableReason);
}

/**
 * Quarterly aggregate diagnostics review using the existing DataReviewReport
 * status model. Every check remains listed, including checks that could not be
 * evaluated because the caller supplied no applicable configuration.
 */
export function reviewDiagnosticData(
  snapshots: readonly DiagnosticReviewSnapshot[],
  exposures: readonly DiagnosticReviewExposure[],
  options: ReviewDiagnosticDataOptions = {},
): DataReviewReport {
  const reported = options.reportedMeasure ?? "reportedCount";
  const open = options.openMeasure ?? "openCount";
  const cnp = options.closedNoPayMeasure ?? "closedNoPayCount";
  const cwp = options.closedWithPayMeasure ?? "closedWithPayCount";
  const exposureMeasure = options.exposureMeasure ?? "exposure";
  const absolute = options.tolerance?.absolute ?? 1e-9;
  const relative = options.tolerance?.relative ?? 1e-9;
  const ageTolerance = options.tolerance?.ageMonths ?? 0;
  const amountPairs = options.amountPairs ?? [];

  const duplicateSnapshots: DataFinding[] = [];
  const seenSnapshots = new Set<string>();
  for (const row of snapshots) {
    const key = `${row.group}\u0000${row.origin}\u0000${row.valuation}`;
    if (seenSnapshots.has(key)) duplicateSnapshots.push(finding(
      "duplicate-aggregate-snapshot",
      `Duplicate aggregate snapshot ${row.group}/${row.origin}/${row.valuation}`,
      context(row),
    ));
    seenSnapshots.add(key);
  }

  const duplicateExposures: DataFinding[] = [];
  const seenExposure = new Set<string>();
  for (const row of exposures) {
    if (seenExposure.has(row.key)) duplicateExposures.push(finding(
      "duplicate-exposure-key",
      `Duplicate exposure key ${row.key}`,
      { ...context(row), ...(row.source ?? {}) },
    ));
    seenExposure.add(row.key);
  }

  const invalidAge: DataFinding[] = [];
  const ageMismatch: DataFinding[] = [];
  const valuationBefore: DataFinding[] = [];
  for (const row of snapshots) {
    if (!Number.isFinite(row.ageMonths) || row.ageMonths < 0 || !Number.isInteger(row.ageMonths) || row.ageMonths % 3 !== 0) {
      invalidAge.push(finding("invalid-development-age", `Invalid quarterly development age ${row.ageMonths}`, context(row)));
    }
    try {
      parseQuarterPeriod(row.origin);
      parseQuarterPeriod(row.valuation);
      let expected: number;
      try {
        expected = developmentAgeMonths(row.origin, row.valuation, options.ageConvention);
      } catch (error) {
        valuationBefore.push(finding("valuation-before-origin", error instanceof Error ? error.message : String(error), context(row)));
        continue;
      }
      if (Number.isFinite(row.ageMonths) && Math.abs(row.ageMonths - expected) > ageTolerance) {
        ageMismatch.push(finding(
          "development-age-mismatch",
          `Recorded age ${row.ageMonths} differs from expected age ${expected}`,
          context(row),
        ));
      }
    } catch (error) {
      ageMismatch.push(finding(
        "development-age-mismatch",
        `Origin/valuation period is not parseable: ${error instanceof Error ? error.message : String(error)}`,
        context(row),
      ));
    }
  }

  const countReconciliation: DataFinding[] = [];
  const cnpExceeds: DataFinding[] = [];
  for (const row of snapshots) {
    const r = finite(row.measures, reported);
    const o = finite(row.measures, open);
    const n = finite(row.measures, cnp);
    const w = finite(row.measures, cwp);
    if (r !== null && o !== null && n !== null && w !== null && differs(r, o + n + w, absolute, relative)) {
      countReconciliation.push(finding(
        "count-reconciliation",
        `${reported} ${r} != ${open} ${o} + ${cnp} ${n} + ${cwp} ${w}`,
        context(row),
      ));
    }
    if (r !== null && n !== null && exceeds(n, r, absolute, relative)) {
      cnpExceeds.push(finding("closed-no-pay-exceeds-reported", `${cnp} ${n} > ${reported} ${r}`, context(row)));
    }
  }

  const paidExceeds: DataFinding[] = [];
  for (const row of snapshots) {
    for (const pair of amountPairs) {
      const paid = finite(row.measures, pair.paidMeasure);
      const incurred = finite(row.measures, pair.incurredMeasure);
      if (paid !== null && incurred !== null && exceeds(paid, incurred, absolute, relative)) {
        paidExceeds.push(finding(
          "paid-exceeds-incurred",
          `${pair.id}: ${pair.paidMeasure} ${paid} > ${pair.incurredMeasure} ${incurred}`,
          context(row),
        ));
      }
    }
  }

  const byTimeline = new Map<string, DiagnosticReviewSnapshot[]>();
  for (const row of snapshots) {
    const key = `${row.group}\u0000${row.origin}`;
    const list = byTimeline.get(key) ?? [];
    list.push(row);
    byTimeline.set(key, list);
  }
  const paidDecreasing: DataFinding[] = [];
  const reportedDecreasing: DataFinding[] = [];
  const closedDecreasing: DataFinding[] = [];
  for (const timeline of byTimeline.values()) {
    const sorted = [...timeline].sort((a, b) => a.ageMonths - b.ageMonths);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      for (const pair of amountPairs) {
        const before = finite(previous.measures, pair.paidMeasure);
        const after = finite(current.measures, pair.paidMeasure);
        if (before !== null && after !== null && exceeds(before, after, absolute, relative)) {
          paidDecreasing.push(finding(
            "cumulative-paid-decreasing",
            `${pair.id}: ${pair.paidMeasure} decreased ${before} -> ${after}`,
            context(current),
          ));
        }
      }
      const beforeReported = finite(previous.measures, reported);
      const afterReported = finite(current.measures, reported);
      if (beforeReported !== null && afterReported !== null && exceeds(beforeReported, afterReported, absolute, relative)) {
        reportedDecreasing.push(finding(
          "cumulative-reported-decreasing",
          `${reported} decreased ${beforeReported} -> ${afterReported}`,
          context(current),
        ));
      }
      const previousCnp = finite(previous.measures, cnp);
      const previousCwp = finite(previous.measures, cwp);
      const currentCnp = finite(current.measures, cnp);
      const currentCwp = finite(current.measures, cwp);
      if (previousCnp !== null && previousCwp !== null && currentCnp !== null && currentCwp !== null) {
        const beforeClosed = previousCnp + previousCwp;
        const afterClosed = currentCnp + currentCwp;
        if (exceeds(beforeClosed, afterClosed, absolute, relative)) {
          closedDecreasing.push(finding(
            "closed-reopen-signal",
            `Total closed count decreased ${beforeClosed} -> ${afterClosed}; investigate reopen activity`,
            context(current),
          ));
        }
      }
    }
  }

  const layerOrder: DataFinding[] = [];
  const layerById = new Map((options.layers ?? []).map((layer) => [layer.id, layer]));
  for (const layer of options.layers ?? []) {
    if (!layer.broaderLayerId) continue;
    const broader = layerById.get(layer.broaderLayerId);
    if (!broader) {
      layerOrder.push(finding("layer-order", `Layer ${layer.id} names unknown broader layer ${layer.broaderLayerId}`));
      continue;
    }
    for (const row of snapshots) {
      for (const [narrowName, broadName, label] of [
        [layer.paidMeasure, broader.paidMeasure, "paid"],
        [layer.incurredMeasure, broader.incurredMeasure, "incurred"],
      ] as const) {
        const narrow = finite(row.measures, narrowName);
        const broad = finite(row.measures, broadName);
        if (narrow !== null && broad !== null && exceeds(narrow, broad, absolute, relative)) {
          layerOrder.push(finding(
            "layer-order",
            `${layer.id} ${label} ${narrow} > broader ${broader.id} ${label} ${broad}`,
            context(row),
          ));
        }
      }
    }
  }

  const controlReconciliation: DataFinding[] = [];
  for (const control of options.controlTotals ?? []) {
    let actual = 0;
    let observed = 0;
    for (const row of snapshots) {
      if (control.group !== undefined && row.group !== control.group) continue;
      if (control.origin !== undefined && row.origin !== control.origin) continue;
      if (control.valuation !== undefined && row.valuation !== control.valuation) continue;
      const value = finite(row.measures, control.measure);
      if (value !== null) { actual += value; observed++; }
    }
    if (observed === 0 || differs(actual, control.expected, absolute, relative)) {
      controlReconciliation.push(finding(
        "layer-control-reconciliation",
        `${control.id}: ${control.measure} actual ${observed === 0 ? "missing" : actual} != control ${control.expected}`,
        { group: control.group, origin: control.origin, valuation: control.valuation },
      ));
    }
  }

  const lossKeys = new Set(snapshots.map((row) => `${row.group}\u0000${row.origin}`));
  const exposureKeys = new Set(exposures.map((row) => `${row.group}\u0000${row.origin}`));
  const lossWithoutExposure: DataFinding[] = [];
  for (const key of lossKeys) if (!exposureKeys.has(key)) {
    const [group, origin] = key.split("\u0000") as [string, string];
    lossWithoutExposure.push(finding("loss-without-exposure", `Loss key ${group}/${origin} has no exposure`, { group, origin }));
  }
  const exposureWithoutLoss: DataFinding[] = [];
  for (const key of exposureKeys) if (!lossKeys.has(key)) {
    const [group, origin] = key.split("\u0000") as [string, string];
    exposureWithoutLoss.push(finding("exposure-without-loss", `Exposure key ${group}/${origin} has no loss data`, { group, origin }));
  }

  const zeroExposure: DataFinding[] = [];
  const incompleteExposure: DataFinding[] = [];
  for (const row of exposures) {
    const value = row.measures[exposureMeasure];
    if (value === 0) zeroExposure.push(finding("zero-exposure", `Exposure key ${row.key} has explicit zero ${exposureMeasure}`, context(row)));
    if (row.complete === false || value === null || value === undefined || !Number.isFinite(value)) {
      incompleteExposure.push(finding("incomplete-exposure", `Exposure key ${row.key} has incomplete ${exposureMeasure}`, context(row)));
    }
  }

  const inconsistentGrouping: DataFinding[] = [];
  const groupByKey = new Map<string, LegacyDiagnosticGroupingAssignment>();
  for (const assignment of options.groupingAssignments ?? []) {
    const previous = groupByKey.get(assignment.key);
    if (previous && previous.group !== assignment.group) {
      inconsistentGrouping.push(finding(
        "inconsistent-group-mapping",
        `Grouping key ${assignment.key} maps to both ${previous.group} and ${assignment.group}`,
        { group: assignment.group, ...assignment.source },
      ));
    } else groupByKey.set(assignment.key, assignment);
  }

  const formulaProvenance: DataFinding[] = [];
  for (const item of options.cachedFormulaProvenance ?? []) {
    if (item.declaredFormulaSource && item.cachedValue !== undefined && (!item.formula || item.formula.trim() === "")) {
      formulaProvenance.push(finding(
        "cached-formula-provenance",
        `Cached formula value ${item.id} has no retained formula text`,
        { sourceFile: item.sourceFile, sourceRow: item.sourceRow },
      ));
    }
  }

  const countMeasures = [reported, open, cnp, cwp];
  const amountMeasures = amountPairs.flatMap((pair) => [pair.paidMeasure, pair.incurredMeasure]);
  const paidMeasures = amountPairs.map((pair) => pair.paidMeasure);
  const comparableSnapshots = [...byTimeline.values()]
    .filter((timeline) => timeline.length > 1)
    .flat();
  const layerComparisons = (options.layers ?? []).flatMap((layer) => {
    if (!layer.broaderLayerId) return [];
    const broader = layerById.get(layer.broaderLayerId);
    return broader === undefined ? [] : [
      layer.paidMeasure,
      broader.paidMeasure,
      layer.incurredMeasure,
      broader.incurredMeasure,
    ];
  });

  const checks: DataCheck[] = [
    make("duplicate-aggregate-snapshot", duplicateSnapshots, options),
    make("duplicate-exposure-key", duplicateExposures, options),
    make("invalid-development-age", invalidAge, options),
    make("development-age-mismatch", ageMismatch, options),
    make("valuation-before-origin", valuationBefore, options),
    makeWithCoverage("count-reconciliation", countReconciliation, reviewMeasureCoverage("count-reconciliation", snapshots, countMeasures), "no snapshots contain the configured count measures", options),
    makeWithCoverage("closed-no-pay-exceeds-reported", cnpExceeds, reviewMeasureCoverage("closed-no-pay-exceeds-reported", snapshots, [reported, cnp]), `no snapshots contain ${reported} or ${cnp}`, options),
    amountPairs.length > 0
      ? makeWithCoverage("paid-exceeds-incurred", paidExceeds, reviewMeasureCoverage("paid-exceeds-incurred", snapshots, amountMeasures), "no snapshots contain the configured paid/incurred measures", options)
      : notEvaluated("paid-exceeds-incurred", "no amountPairs configured"),
    amountPairs.length > 0
      ? comparableSnapshots.length > 0
        ? makeWithCoverage("cumulative-paid-decreasing", paidDecreasing, reviewMeasureCoverage("cumulative-paid-decreasing", comparableSnapshots, paidMeasures), "no comparable snapshots contain the configured paid measures", options)
        : notEvaluated("cumulative-paid-decreasing", "no group/origin timeline has multiple snapshots")
      : notEvaluated("cumulative-paid-decreasing", "no amountPairs configured"),
    comparableSnapshots.length > 0
      ? makeWithCoverage("cumulative-reported-decreasing", reportedDecreasing, reviewMeasureCoverage("cumulative-reported-decreasing", comparableSnapshots, [reported]), `no comparable snapshots contain ${reported}`, options)
      : notEvaluated("cumulative-reported-decreasing", "no group/origin timeline has multiple snapshots"),
    comparableSnapshots.length > 0
      ? makeWithCoverage("closed-reopen-signal", closedDecreasing, reviewMeasureCoverage("closed-reopen-signal", comparableSnapshots, [cnp, cwp]), `no comparable snapshots contain ${cnp} or ${cwp}`, options)
      : notEvaluated("closed-reopen-signal", "no group/origin timeline has multiple snapshots"),
    (options.layers?.length ?? 0) > 0
      ? makeWithCoverage(
        "layer-order",
        layerOrder,
        reviewMeasureCoverage("layer-order", snapshots, layerComparisons),
        "no snapshots contain measures for a valid broader-layer relationship",
        options,
      )
      : notEvaluated("layer-order", "no layer definitions configured"),
    (options.controlTotals?.length ?? 0) > 0 ? make("layer-control-reconciliation", controlReconciliation, options) : notEvaluated("layer-control-reconciliation", "no control totals configured"),
    make("loss-without-exposure", lossWithoutExposure, options),
    make("exposure-without-loss", exposureWithoutLoss, options),
    make("zero-exposure", zeroExposure, options),
    make("incomplete-exposure", incompleteExposure, options),
    (options.groupingAssignments?.length ?? 0) > 0 ? make("inconsistent-group-mapping", inconsistentGrouping, options) : notEvaluated("inconsistent-group-mapping", "no grouping assignments configured"),
    (options.cachedFormulaProvenance?.length ?? 0) > 0 ? make("cached-formula-provenance", formulaProvenance, options) : notEvaluated("cached-formula-provenance", "no cached formula provenance supplied"),
  ];
  return summarizeDataChecks(checks);
}
