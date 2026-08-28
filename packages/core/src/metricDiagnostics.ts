import { compareQuarterPeriods, parseQuarterPeriod } from "./periods.js";
import { ReservingError, type DiagnosticFinding } from "./types.js";
import { safeRatio } from "./util.js";

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyOwnRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const copy = nullRecord<T>();
  for (const key of Object.keys(source)) copy[key] = source[key]!;
  return copy;
}

function nullRecordForKeys<T>(keys: Iterable<string>, value: T): Record<string, T> {
  const record = nullRecord<T>();
  for (const key of keys) record[key] = value;
  return record;
}

function ownRecordValue<T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Stable natural ordering without the host's locale or ICU data. ASCII digit
 * runs compare by numeric magnitude; all other text compares by UTF-16 code
 * units, with the original spelling as a total-order tie breaker.
 */
function compareDeterministicStrings(a: string, b: string): number {
  if (a === b) return 0;
  const left = a.match(/\d+|\D+/g) ?? [""];
  const right = b.match(/\d+|\D+/g) ?? [""];
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index++) {
    const leftPart = left[index]!;
    const rightPart = right[index]!;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftSignificant = leftPart.replace(/^0+(?=\d)/, "");
      const rightSignificant = rightPart.replace(/^0+(?=\d)/, "");
      if (leftSignificant.length !== rightSignificant.length) {
        return leftSignificant.length - rightSignificant.length;
      }
      const magnitude = compareCodeUnits(leftSignificant, rightSignificant);
      if (magnitude !== 0) return magnitude;
      if (leftPart.length !== rightPart.length) return leftPart.length - rightPart.length;
    } else {
      const text = compareCodeUnits(leftPart, rightPart);
      if (text !== 0) return text;
    }
  }
  if (left.length !== right.length) return left.length - right.length;
  return compareCodeUnits(a, b);
}

export type SparseValuePolicy = "preserve-null" | "zero-fill";
export type DiagnosticMeasureMap = Readonly<Record<string, number | null | undefined>>;

export type MeasureExpression =
  | { op: "measure"; measure: string }
  | { op: "add"; terms: readonly MeasureExpression[] }
  | { op: "subtract"; left: MeasureExpression; right: MeasureExpression };

export interface DiagnosticWarning {
  code:
    | "MISSING_COMPONENT"
    | "NON_FINITE_COMPONENT"
    | "NON_FINITE_NUMERATOR"
    | "NON_FINITE_RESULT"
    | "INVALID_DENOMINATOR"
    | "INCOMPLETE_EXPOSURE"
    | "CONFLICTING_EXPOSURE"
    | "DUPLICATE_EXPOSURE_KEY"
    | "PAID_EXCEEDS_INCURRED"
    | (string & {});
  message: string;
  component?: string;
  exposureKey?: string;
}

/** Adapts structured metric warnings to the existing core diagnostic finding vocabulary. */
export function diagnosticWarningToFinding(warning: DiagnosticWarning): DiagnosticFinding {
  return { severity: "warning", code: warning.code, message: warning.message };
}

export interface MetricWarningRule {
  code: "PAID_EXCEEDS_INCURRED";
  when: "numerator-greater-than-denominator";
  message: string;
  tolerance?: number;
}

export interface MetricDefinition {
  id: string;
  version: string;
  displayName: string;
  description: string;
  unit: "count-per-million" | "ratio" | "currency-per-exposure" | "currency-per-claim" | (string & {});
  scale: number;
  numerator: MeasureExpression;
  denominator: MeasureExpression;
  numeratorLabel: string;
  denominatorLabel: string;
  basis: string;
  requiredComponents: readonly string[];
  warningRules?: readonly MetricWarningRule[];
  /** Optional pure caller rule for domain warnings beyond the built-in comparisons. */
  evaluateWarnings?: (context: MetricWarningContext) => readonly DiagnosticWarning[];
}

export interface MetricWarningContext {
  definition: MetricDefinition;
  components: Readonly<Record<string, number | null>>;
  rawNumerator: number | null;
  rawDenominator: number | null;
  value: number | null;
}

export interface MetricEvaluation {
  metricId: string;
  metricVersion: string;
  value: number | null;
  rawNumerator: number | null;
  rawDenominator: number | null;
  numeratorLabel: string;
  denominatorLabel: string;
  unit: MetricDefinition["unit"];
  scale: number;
  basis: string;
  rawComponents: Record<string, number | null>;
  warnings: DiagnosticWarning[];
}

export interface MeasureAggregateCell {
  sum: number;
  observed: number;
  missing: number;
  nonFinite: number;
}

/** Mergeable sufficient statistics: grouping in stages gives the same result. */
export interface MeasureAggregate {
  components: Record<string, MeasureAggregateCell>;
}

export function aggregateMeasures(rows: readonly DiagnosticMeasureMap[]): MeasureAggregate {
  const components = nullRecord<MeasureAggregateCell>();
  const names = new Set(rows.flatMap((row) => Object.keys(row)));
  for (const name of names) components[name] = { sum: 0, observed: 0, missing: 0, nonFinite: 0 };
  for (const row of rows) {
    for (const name of names) {
      const cell = components[name]!;
      const value = ownRecordValue(row, name);
      if (value === null || value === undefined) cell.missing++;
      else if (!Number.isFinite(value)) cell.nonFinite++;
      else {
        cell.sum += value;
        cell.observed++;
      }
    }
  }
  return { components };
}

export function mergeMeasureAggregates(aggregates: readonly MeasureAggregate[]): MeasureAggregate {
  const components = nullRecord<MeasureAggregateCell>();
  for (const aggregate of aggregates) {
    for (const [name, value] of Object.entries(aggregate.components)) {
      const target = components[name] ?? (components[name] = { sum: 0, observed: 0, missing: 0, nonFinite: 0 });
      target.sum += value.sum;
      target.observed += value.observed;
      target.missing += value.missing;
      target.nonFinite += value.nonFinite;
    }
  }
  return { components };
}

export interface FinalizedMeasures {
  measures: Record<string, number | null>;
  warnings: DiagnosticWarning[];
}

export function finalizeMeasureAggregate(
  aggregate: MeasureAggregate,
  sparsePolicy: SparseValuePolicy = "preserve-null",
): FinalizedMeasures {
  const measures = nullRecord<number | null>();
  const warnings: DiagnosticWarning[] = [];
  for (const [name, cell] of Object.entries(aggregate.components)) {
    if (cell.nonFinite > 0) {
      measures[name] = null;
      warnings.push({
        code: "NON_FINITE_COMPONENT",
        component: name,
        message: `${name} contains ${cell.nonFinite} non-finite value(s)`,
      });
    } else if (!Number.isFinite(cell.sum)) {
      measures[name] = null;
      warnings.push({
        code: "NON_FINITE_COMPONENT",
        component: name,
        message: `${name} aggregate overflowed or is non-finite`,
      });
    } else if (cell.missing > 0 && sparsePolicy === "preserve-null") {
      measures[name] = null;
      warnings.push({
        code: "MISSING_COMPONENT",
        component: name,
        message: `${name} is incomplete: ${cell.missing} contributing value(s) are missing`,
      });
    } else {
      measures[name] = cell.sum;
    }
  }
  return { measures, warnings };
}

export function measureExpressionComponents(expression: MeasureExpression): string[] {
  if (expression.op === "measure") return [expression.measure];
  if (expression.op === "subtract") {
    return [...measureExpressionComponents(expression.left), ...measureExpressionComponents(expression.right)];
  }
  return expression.terms.flatMap(measureExpressionComponents);
}

function evaluateExpression(expression: MeasureExpression, measures: DiagnosticMeasureMap): number | null {
  if (expression.op === "measure") {
    const value = ownRecordValue(measures, expression.measure);
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  }
  if (expression.op === "subtract") {
    const left = evaluateExpression(expression.left, measures);
    const right = evaluateExpression(expression.right, measures);
    return left === null || right === null ? null : left - right;
  }
  let total = 0;
  for (const term of expression.terms) {
    const value = evaluateExpression(term, measures);
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function evaluateMetric(
  definition: MetricDefinition,
  components: DiagnosticMeasureMap,
  inheritedWarnings: readonly DiagnosticWarning[] = [],
): MetricEvaluation {
  if (!Number.isFinite(definition.scale)) {
    throw new ReservingError("BAD_RATIO", `Metric ${definition.id} scale must be finite`);
  }
  const required = new Set([
    ...definition.requiredComponents,
    ...measureExpressionComponents(definition.numerator),
    ...measureExpressionComponents(definition.denominator),
  ]);
  const rawComponents = nullRecord<number | null>();
  const warnings = inheritedWarnings.filter(
    (warning) =>
      warning.component === undefined ||
      required.has(warning.component) ||
      warning.code === "INCOMPLETE_EXPOSURE" ||
      warning.code === "CONFLICTING_EXPOSURE",
  );
  for (const name of required) {
    const value = ownRecordValue(components, name);
    rawComponents[name] = value !== null && value !== undefined && Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) {
      if (!warnings.some((w) => w.code === "MISSING_COMPONENT" && w.component === name)) {
        warnings.push({ code: "MISSING_COMPONENT", component: name, message: `${name} is missing` });
      }
    } else if (!Number.isFinite(value)) {
      if (!warnings.some((w) => w.code === "NON_FINITE_COMPONENT" && w.component === name)) {
        warnings.push({ code: "NON_FINITE_COMPONENT", component: name, message: `${name} is not finite` });
      }
    }
  }
  const evaluatedNumerator = evaluateExpression(definition.numerator, components);
  const numerator = evaluatedNumerator !== null && Number.isFinite(evaluatedNumerator)
    ? evaluatedNumerator
    : null;
  if (evaluatedNumerator !== null && !Number.isFinite(evaluatedNumerator)) {
    warnings.push({
      code: "NON_FINITE_NUMERATOR",
      message: `${definition.numeratorLabel} overflowed or is non-finite`,
    });
  }
  const evaluatedDenominator = evaluateExpression(definition.denominator, components);
  const denominator = evaluatedDenominator !== null && Number.isFinite(evaluatedDenominator)
    ? evaluatedDenominator
    : null;
  let value: number | null = null;
  if (denominator === null || !Number.isFinite(denominator) || denominator <= 0) {
    warnings.push({
      code: "INVALID_DENOMINATOR",
      message: `${definition.denominatorLabel} must be finite and greater than zero`,
    });
  } else if (numerator !== null && Number.isFinite(numerator)) {
    const ratio = safeRatio(numerator, denominator);
    if (ratio === null) {
      warnings.push({
        code: "NON_FINITE_RESULT",
        message: `${definition.displayName} ratio overflowed or is non-finite`,
      });
    } else {
      const scaled = ratio * definition.scale;
      if (Number.isFinite(scaled)) value = scaled;
      else {
        warnings.push({
          code: "NON_FINITE_RESULT",
          message: `${definition.displayName} scaled result overflowed or is non-finite`,
        });
      }
    }
  }
  for (const rule of definition.warningRules ?? []) {
    if (rule.when === "numerator-greater-than-denominator" && numerator !== null && denominator !== null) {
      const tolerance = rule.tolerance ?? 0;
      if (numerator - denominator > tolerance * Math.max(1, Math.abs(numerator), Math.abs(denominator))) {
        warnings.push({ code: rule.code, message: rule.message });
      }
    }
  }
  if (definition.evaluateWarnings) {
    warnings.push(...definition.evaluateWarnings({
      definition,
      components: rawComponents,
      rawNumerator: numerator,
      rawDenominator: denominator,
      value,
    }));
  }
  return {
    metricId: definition.id,
    metricVersion: definition.version,
    value,
    rawNumerator: numerator,
    rawDenominator: denominator,
    numeratorLabel: definition.numeratorLabel,
    denominatorLabel: definition.denominatorLabel,
    unit: definition.unit,
    scale: definition.scale,
    basis: definition.basis,
    rawComponents,
    warnings,
  };
}

export type LayerExpression =
  | { op: "measure"; measure: string }
  | { op: "add"; terms: readonly LayerExpression[] }
  | { op: "claim-cap"; measure: string; limit: number };

export interface AmountLayerDefinition {
  id: string;
  displayName: string;
  paidMeasure: string;
  incurredMeasure: string;
  paid: LayerExpression;
  incurred: LayerExpression;
  /** Documents whether inputs are already limited or this layer caps claim rows. */
  basis: "pre-capped-additive" | "claim-level-cap" | "unlimited-additive";
}

export interface DiagnosticClaimRow<T = unknown> {
  dimensions: T;
  measures: DiagnosticMeasureMap;
}

function evaluateLayerExpression(expression: LayerExpression, measures: DiagnosticMeasureMap): number | null {
  if (expression.op === "measure") {
    const value = ownRecordValue(measures, expression.measure);
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  }
  if (expression.op === "claim-cap") {
    if (!Number.isFinite(expression.limit) || expression.limit <= 0) {
      throw new ReservingError("BAD_CAP", `Claim-level layer cap must be positive; got ${expression.limit}`);
    }
    const value = ownRecordValue(measures, expression.measure);
    return value !== null && value !== undefined && Number.isFinite(value)
      ? Math.min(value, expression.limit)
      : null;
  }
  let total = 0;
  for (const term of expression.terms) {
    const value = evaluateLayerExpression(term, measures);
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Applies claim caps before aggregation; this function intentionally accepts claim rows, not aggregates. */
export function deriveAmountLayers<T>(
  rows: readonly DiagnosticClaimRow<T>[],
  layers: readonly AmountLayerDefinition[],
): DiagnosticClaimRow<T>[] {
  return rows.map((row) => {
    const measures = copyOwnRecord(row.measures);
    for (const layer of layers) {
      measures[layer.paidMeasure] = evaluateLayerExpression(layer.paid, row.measures);
      measures[layer.incurredMeasure] = evaluateLayerExpression(layer.incurred, row.measures);
    }
    return { dimensions: row.dimensions, measures };
  });
}

export interface DiagnosticLossRow<TDimensions = unknown> {
  id: string;
  group: string;
  origin: string;
  valuation: string;
  ageMonths: number;
  /** Optional caller-mapped policy/fiscal period (for example a Q3-Q2 year). */
  policyPeriod?: string;
  /** Optional caller-owned grouping metadata; `group` remains the stable key. */
  dimensions?: TDimensions;
  measures: DiagnosticMeasureMap;
}

export interface DiagnosticExposureRow<TDimensions = unknown> {
  /** Stable exposure identity. Repeated snapshots with the same key count once. */
  key: string;
  group: string;
  origin: string;
  valuation?: string;
  measures: DiagnosticMeasureMap;
  complete?: boolean;
  dimensions?: TDimensions;
}

export interface DiagnosticsFilter {
  groups?: readonly string[];
  origins?: readonly string[];
  originFrom?: string;
  originThrough?: string;
  valuations?: readonly string[];
  valuationFrom?: string;
  valuationThrough?: string;
  policyPeriods?: readonly string[];
  minAgeMonths?: number;
  maxAgeMonths?: number;
}

export interface DiagnosticEmergencePoint<TDimensions = unknown> {
  group: string;
  dimensions?: TDimensions;
  origin: string;
  valuation: string;
  ageMonths: number;
  components: Record<string, number | null>;
  componentWarnings: DiagnosticWarning[];
  metrics: Record<string, MetricEvaluation>;
}

export interface DiagnosticMetricTriangle {
  group: string;
  metricId: string;
  origins: string[];
  ages: number[];
  values: (number | null)[][];
  cells: (MetricEvaluation | null)[][];
}

export interface MetricDiagnosticsResult<TDimensions = unknown> {
  emergence: DiagnosticEmergencePoint<TDimensions>[];
  triangles: DiagnosticMetricTriangle[];
  latestDiagonal: DiagnosticEmergencePoint<TDimensions>[];
}

export interface RunMetricDiagnosticsInput<TDimensions = unknown> {
  losses: readonly DiagnosticLossRow<TDimensions>[];
  exposures?: readonly DiagnosticExposureRow<TDimensions>[];
  metrics: readonly MetricDefinition[];
  sparsePolicy?: SparseValuePolicy;
  filter?: DiagnosticsFilter;
  /** Maps source group keys to requested aggregate keys before summation. */
  groupMap?: Readonly<Record<string, string>>;
  /** Metadata for mapped/combined output groups. */
  groupDimensions?: Readonly<Record<string, TDimensions>>;
}

function rowIncluded<TDimensions>(row: DiagnosticLossRow<TDimensions>, filter: DiagnosticsFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.groups && !filter.groups.includes(row.group)) return false;
  if (filter.origins && !filter.origins.includes(row.origin)) return false;
  if (filter.originFrom && periodCompare(row.origin, filter.originFrom) < 0) return false;
  if (filter.originThrough && periodCompare(row.origin, filter.originThrough) > 0) return false;
  if (filter.valuations && !filter.valuations.includes(row.valuation)) return false;
  if (filter.valuationFrom && periodCompare(row.valuation, filter.valuationFrom) < 0) return false;
  if (filter.valuationThrough && periodCompare(row.valuation, filter.valuationThrough) > 0) return false;
  if (filter.policyPeriods && (row.policyPeriod === undefined || !filter.policyPeriods.includes(row.policyPeriod))) return false;
  if (filter.minAgeMonths !== undefined && row.ageMonths < filter.minAgeMonths) return false;
  if (filter.maxAgeMonths !== undefined && row.ageMonths > filter.maxAgeMonths) return false;
  return true;
}

function sameMeasures(a: DiagnosticMeasureMap, b: DiagnosticMeasureMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(ownRecordValue(a, key) ?? null, ownRecordValue(b, key) ?? null)) return false;
  }
  return true;
}

export interface DiagnosticExposureReconciliationFinding {
  code: "DUPLICATE_EXPOSURE_KEY" | "CONFLICTING_EXPOSURE";
  exposureKey: string;
  group: string;
  origin: string;
  message: string;
}

export interface ReconciledDiagnosticExposures<TDimensions = unknown> {
  exposures: DiagnosticExposureRow<TDimensions>[];
  findings: DiagnosticExposureReconciliationFinding[];
}

/**
 * Reconciles stable exposure keys before aggregation. Identical valuation
 * copies collapse to one row. Conflicting copies become one incomplete/null
 * row so exposure-based metrics fail closed rather than using a partial base.
 */
export function reconcileDiagnosticExposureKeys<TDimensions = unknown>(
  rows: readonly DiagnosticExposureRow<TDimensions>[],
): ReconciledDiagnosticExposures<TDimensions> {
  const seen = new Map<string, DiagnosticExposureRow<TDimensions>>();
  const findings: DiagnosticExposureReconciliationFinding[] = [];
  for (const row of rows) {
    const previous = seen.get(row.key);
    if (!previous) {
      seen.set(row.key, { ...row, measures: copyOwnRecord(row.measures) });
      continue;
    }
    const consistent =
      previous.group === row.group &&
      previous.origin === row.origin &&
      sameMeasures(previous.measures, row.measures) &&
      (previous.complete ?? true) === (row.complete ?? true);
    if (consistent) {
      findings.push({
        code: "DUPLICATE_EXPOSURE_KEY",
        exposureKey: row.key,
        group: row.group,
        origin: row.origin,
        message: `Exposure key ${row.key} repeats; identical copies were counted once`,
      });
      continue;
    }
    const names = new Set([...Object.keys(previous.measures), ...Object.keys(row.measures)]);
    seen.set(row.key, {
      ...previous,
      complete: false,
      measures: nullRecordForKeys(names, null),
    });
    if (!findings.some((finding) =>
      finding.code === "CONFLICTING_EXPOSURE" && finding.exposureKey === row.key
    )) {
      findings.push({
        code: "CONFLICTING_EXPOSURE",
        exposureKey: row.key,
        group: previous.group,
        origin: previous.origin,
        message: `Exposure key ${row.key} repeats with inconsistent attributes or measures`,
      });
    }
  }
  return { exposures: [...seen.values()], findings };
}

function periodCompare(a: string, b: string): number {
  try {
    parseQuarterPeriod(a);
    parseQuarterPeriod(b);
    return compareQuarterPeriods(a, b);
  } catch {
    return compareDeterministicStrings(a, b);
  }
}

interface ExposureBucket {
  aggregate: MeasureAggregate;
  warnings: DiagnosticWarning[];
  /** Exposure components that must fail closed even when loss sparsity is zero-filled. */
  nullComponents: ReadonlySet<string>;
}

type ExpectedExposureSources = ReadonlyMap<string, ReadonlySet<string>>;

function aggregateExposures<TDimensions>(
  rows: readonly DiagnosticExposureRow<TDimensions>[],
  filter: DiagnosticsFilter | undefined,
  groupMap: Readonly<Record<string, string>> | undefined,
  expectedSources: ExpectedExposureSources,
): Map<string, ExposureBucket> {
  const eligible = rows.filter((row) =>
    (!filter?.groups || filter.groups.includes(row.group)) &&
    (!filter?.origins || filter.origins.includes(row.origin)) &&
    (!filter?.originFrom || periodCompare(row.origin, filter.originFrom) >= 0) &&
    (!filter?.originThrough || periodCompare(row.origin, filter.originThrough) <= 0) &&
    (row.valuation === undefined || !filter?.valuations || filter.valuations.includes(row.valuation)) &&
    (row.valuation === undefined || !filter?.valuationFrom || periodCompare(row.valuation, filter.valuationFrom) >= 0) &&
    (row.valuation === undefined || !filter?.valuationThrough || periodCompare(row.valuation, filter.valuationThrough) <= 0)
  );
  const reconciled = reconcileDiagnosticExposureKeys(eligible);
  const findingsByKey = new Map<string, DiagnosticExposureReconciliationFinding[]>();
  for (const finding of reconciled.findings) {
    const list = findingsByKey.get(finding.exposureKey) ?? [];
    list.push(finding);
    findingsByKey.set(finding.exposureKey, list);
  }
  const byCell = new Map<string, DiagnosticExposureRow<TDimensions>[]>();
  const sourceKeysByCell = new Map<string, Set<string>>();
  for (const row of reconciled.exposures) {
    const group = ownRecordValue(groupMap, row.group) ?? row.group;
    const key = `${group}\u0000${row.origin}`;
    const list = byCell.get(key) ?? [];
    list.push(row);
    byCell.set(key, list);
    const sourceKeys = sourceKeysByCell.get(key) ?? new Set<string>();
    sourceKeys.add(`${row.group}\u0000${row.origin}`);
    sourceKeysByCell.set(key, sourceKeys);
  }
  const result = new Map<string, ExposureBucket>();
  const cellKeys = new Set([...byCell.keys(), ...expectedSources.keys()]);
  for (const key of cellKeys) {
    const cellRows = byCell.get(key) ?? [];
    const warnings: DiagnosticWarning[] = [];
    const nullComponents = new Set<string>();
    const safeRows = cellRows.map((row) => {
      warnings.push(...(findingsByKey.get(row.key) ?? []).map((finding) => ({
        code: finding.code,
        exposureKey: finding.exposureKey,
        message: finding.message,
      })));
      if (row.complete === false) {
        const componentNames = Object.keys(row.measures);
        for (const name of componentNames) nullComponents.add(name);
        warnings.push({
          code: "INCOMPLETE_EXPOSURE",
          exposureKey: row.key,
          message: `Exposure key ${row.key} is marked incomplete`,
        });
        return nullRecordForKeys(componentNames, null);
      }
      return row.measures;
    });
    const missingSourceKeys = [...(expectedSources.get(key) ?? [])]
      .filter((sourceKey) => !sourceKeysByCell.get(key)?.has(sourceKey));
    if (missingSourceKeys.length > 0) {
      for (const sourceKey of missingSourceKeys) {
        const [sourceGroup, origin] = sourceKey.split("\u0000");
        warnings.push({
          code: "INCOMPLETE_EXPOSURE",
          message: `No exposure row was supplied for source group ${sourceGroup} and origin ${origin}`,
        });
      }
      const exposureMeasures = new Set(cellRows.flatMap((row) => Object.keys(row.measures)));
      if (exposureMeasures.size > 0) {
        for (const name of exposureMeasures) nullComponents.add(name);
        safeRows.push(nullRecordForKeys(exposureMeasures, null));
      }
    }
    const aggregate = aggregateMeasures(safeRows);
    for (const [name, cell] of Object.entries(aggregate.components)) {
      if (cell.missing > 0) nullComponents.add(name);
    }
    result.set(key, { aggregate, warnings, nullComponents });
  }
  return result;
}

/**
 * Generic quarterly diagnostics engine. Loss rows aggregate by
 * group/origin/valuation; exposure rows aggregate once by stable exposure key;
 * every metric then divides the aggregated expressions exactly once.
 */
export function runMetricDiagnostics<TDimensions = unknown>(
  input: RunMetricDiagnosticsInput<TDimensions>,
): MetricDiagnosticsResult<TDimensions> {
  const sparsePolicy = input.sparsePolicy ?? "preserve-null";
  const lossIds = new Set<string>();
  for (const row of input.losses) {
    if (lossIds.has(row.id)) throw new ReservingError("BAD_TABLE", `Duplicate loss row id ${row.id}`);
    lossIds.add(row.id);
  }
  const metricIds = new Set<string>();
  for (const metric of input.metrics) {
    if (metricIds.has(metric.id)) throw new ReservingError("BAD_TABLE", `Duplicate metric id ${metric.id}`);
    metricIds.add(metric.id);
  }
  const lossBuckets = new Map<string, {
    group: string;
    dimensions?: TDimensions;
    origin: string;
    valuation: string;
    ageMonths: number;
    rows: DiagnosticMeasureMap[];
  }>();
  const expectedExposureSources = new Map<string, Set<string>>();
  for (const row of input.losses) {
    if (!rowIncluded(row, input.filter)) continue;
    if (!Number.isFinite(row.ageMonths) || row.ageMonths < 0) {
      throw new ReservingError("BAD_DATE", `Loss row ${row.id} has invalid development age ${row.ageMonths}`);
    }
    const group = ownRecordValue(input.groupMap, row.group) ?? row.group;
    if (input.exposures !== undefined) {
      const exposureCellKey = `${group}\u0000${row.origin}`;
      const sourceKeys = expectedExposureSources.get(exposureCellKey) ?? new Set<string>();
      sourceKeys.add(`${row.group}\u0000${row.origin}`);
      expectedExposureSources.set(exposureCellKey, sourceKeys);
    }
    const key = `${group}\u0000${row.origin}\u0000${row.valuation}`;
    const bucket = lossBuckets.get(key);
    if (bucket) {
      if (bucket.ageMonths !== row.ageMonths) {
        throw new ReservingError(
          "BAD_DATE",
          `Aggregate snapshot ${group}/${row.origin}/${row.valuation} has inconsistent ages ${bucket.ageMonths} and ${row.ageMonths}`,
        );
      }
      bucket.rows.push(row.measures);
    } else {
      const dimensions = ownRecordValue(input.groupDimensions, group) ?? (group === row.group ? row.dimensions : undefined);
      lossBuckets.set(key, {
        group,
        ...(dimensions !== undefined ? { dimensions } : {}),
        origin: row.origin,
        valuation: row.valuation,
        ageMonths: row.ageMonths,
        rows: [row.measures],
      });
    }
  }
  const exposures = aggregateExposures(
    input.exposures ?? [],
    input.filter,
    input.groupMap,
    expectedExposureSources,
  );
  const emergence: DiagnosticEmergencePoint<TDimensions>[] = [];
  for (const bucket of lossBuckets.values()) {
    const loss = aggregateMeasures(bucket.rows);
    const exposure = exposures.get(`${bucket.group}\u0000${bucket.origin}`);
    const aggregate = exposure ? mergeMeasureAggregates([loss, exposure.aggregate]) : loss;
    const finalized = finalizeMeasureAggregate(aggregate, sparsePolicy);
    const componentWarnings = [...finalized.warnings, ...(exposure?.warnings ?? [])];
    for (const name of exposure?.nullComponents ?? []) {
      finalized.measures[name] = null;
      if (!componentWarnings.some((warning) => warning.code === "MISSING_COMPONENT" && warning.component === name)) {
        componentWarnings.push({
          code: "MISSING_COMPONENT",
          component: name,
          message: `${name} exposure is incomplete and remains null`,
        });
      }
    }
    const metrics = nullRecord<MetricEvaluation>();
    for (const definition of input.metrics) {
      metrics[definition.id] = evaluateMetric(definition, finalized.measures, componentWarnings);
    }
    emergence.push({
      group: bucket.group,
      ...(bucket.dimensions !== undefined ? { dimensions: bucket.dimensions } : {}),
      origin: bucket.origin,
      valuation: bucket.valuation,
      ageMonths: bucket.ageMonths,
      components: finalized.measures,
      componentWarnings,
      metrics,
    });
  }
  emergence.sort((a, b) =>
    compareDeterministicStrings(a.group, b.group) || periodCompare(a.origin, b.origin) || a.ageMonths - b.ageMonths || periodCompare(a.valuation, b.valuation),
  );

  const triangles: DiagnosticMetricTriangle[] = [];
  for (const group of [...new Set(emergence.map((point) => point.group))].sort(compareDeterministicStrings)) {
    const groupPoints = emergence.filter((point) => point.group === group);
    for (const metric of input.metrics) triangles.push(metricTriangleFromEmergence(groupPoints, metric.id));
  }
  const latestByOrigin = new Map<string, DiagnosticEmergencePoint<TDimensions>>();
  for (const point of emergence) {
    const key = `${point.group}\u0000${point.origin}`;
    const previous = latestByOrigin.get(key);
    if (!previous || point.ageMonths > previous.ageMonths) latestByOrigin.set(key, point);
  }
  return {
    emergence,
    triangles,
    latestDiagonal: [...latestByOrigin.values()],
  };
}

export function metricTriangleFromEmergence(
  points: readonly DiagnosticEmergencePoint<unknown>[],
  metricId: string,
): DiagnosticMetricTriangle {
  const groups = new Set(points.map((point) => point.group));
  if (groups.size > 1) throw new ReservingError("SHAPE", "A metric triangle can contain only one group");
  const origins = [...new Set(points.map((point) => point.origin))].sort(periodCompare);
  const ages = [...new Set(points.map((point) => point.ageMonths))].sort((a, b) => a - b);
  const originIndex = new Map(origins.map((origin, index) => [origin, index]));
  const ageIndex = new Map(ages.map((age, index) => [age, index]));
  const cells: (MetricEvaluation | null)[][] = origins.map(() => ages.map(() => null));
  for (const point of points) {
    const metric = ownRecordValue(point.metrics, metricId);
    if (!metric) throw new ReservingError("BAD_TABLE", `Emergence point has no metric ${metricId}`);
    const i = originIndex.get(point.origin)!;
    const j = ageIndex.get(point.ageMonths)!;
    if (cells[i]![j] !== null) {
      throw new ReservingError(
        "SHAPE",
        `Duplicate diagnostic cell after aggregation for group ${point.group}, origin ${point.origin}, age ${point.ageMonths}`,
      );
    }
    cells[i]![j] = metric;
  }
  return {
    group: points[0]?.group ?? "",
    metricId,
    origins,
    ages,
    values: cells.map((row) => row.map((cell) => cell?.value ?? null)),
    cells,
  };
}

export function sameMaturity<TDimensions>(
  result: MetricDiagnosticsResult<TDimensions>,
  ageMonths: number,
  groups?: readonly string[],
): DiagnosticEmergencePoint<TDimensions>[] {
  return result.emergence.filter(
    (point) => point.ageMonths === ageMonths && (!groups || groups.includes(point.group)),
  );
}

export interface CommonMaturityResult<TDimensions = unknown> {
  ageMonths: number | null;
  points: DiagnosticEmergencePoint<TDimensions>[];
}

/** Latest maturity present in every selected group; selection is caller-defined. */
export function commonMaturity<TDimensions>(
  result: MetricDiagnosticsResult<TDimensions>,
  groups: readonly string[],
): CommonMaturityResult<TDimensions> {
  if (groups.length === 0) return { ageMonths: null, points: [] };
  let common: Set<number> | null = null;
  for (const group of groups) {
    const ages = new Set(result.emergence.filter((point) => point.group === group).map((point) => point.ageMonths));
    if (common === null) common = ages;
    else {
      const intersection = new Set<number>();
      for (const age of common) if (ages.has(age)) intersection.add(age);
      common = intersection;
    }
  }
  const ageMonths = common && common.size > 0 ? Math.max(...common) : null;
  return { ageMonths, points: ageMonths === null ? [] : sameMaturity(result, ageMonths, groups) };
}
