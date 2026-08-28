import {
  measureExpressionComponents,
  type AmountLayerDefinition,
  type MeasureExpression,
  type MetricDefinition,
  type MetricWarningRule,
} from "./metricDiagnostics.js";
import { ReservingError } from "./types.js";

const m = (measure: string): MeasureExpression => ({ op: "measure", measure });
const sub = (left: MeasureExpression, right: MeasureExpression): MeasureExpression => ({ op: "subtract", left, right });

function definedProperties<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

export interface CasualtyDiagnosticComponentKeys {
  reported: string;
  open: string;
  closedNoPay: string;
  closedWithPay: string;
  exposure: string;
  paid250: string;
  incurred250: string;
  paidPrimary: string;
  incurredPrimary: string;
}

export const CASUALTY_DIAGNOSTIC_COMPONENTS: Readonly<CasualtyDiagnosticComponentKeys> = {
  reported: "reportedCount",
  open: "openCount",
  closedNoPay: "closedNoPayCount",
  closedWithPay: "closedWithPayCount",
  exposure: "exposure",
  paid250: "paid250",
  incurred250: "incurred250",
  paidPrimary: "paidPrimary",
  incurredPrimary: "incurredPrimary",
} as const;

type MetricDisplayOverride = Partial<Pick<
  MetricDefinition,
  "displayName" | "description" | "unit" | "numeratorLabel" | "denominatorLabel" | "basis"
>>;

export interface CasualtyMetricPresetOptions {
  /** Caller source/output measure keys, including the exposure key. */
  components?: Partial<CasualtyDiagnosticComponentKeys>;
  frequencyScale?: number;
  frequencyUnit?: MetricDefinition["unit"];
  definitionVersion?: string;
  basisLabels?: { limited250?: string; primary?: string; counts?: string };
  /** Per-metric display/basis overrides; formulas remain the documented preset formulas. */
  displayOverrides?: Readonly<Record<string, MetricDisplayOverride>>;
}

function metric(
  id: string,
  displayName: string,
  description: string,
  unit: MetricDefinition["unit"],
  scale: number,
  numerator: MeasureExpression,
  denominator: MeasureExpression,
  numeratorLabel: string,
  denominatorLabel: string,
  basis: string,
  version: string,
  override: MetricDisplayOverride | undefined,
  warningRules?: readonly MetricWarningRule[],
): MetricDefinition {
  const definition: MetricDefinition = {
    id,
    version,
    displayName,
    description,
    unit,
    scale,
    numerator,
    denominator,
    numeratorLabel,
    denominatorLabel,
    basis,
    requiredComponents: [...new Set([
      ...measureExpressionComponents(numerator),
      ...measureExpressionComponents(denominator),
    ])],
    warningRules,
  };
  return { ...definition, ...definedProperties(override) };
}

const paidWarning: readonly MetricWarningRule[] = [{
  code: "PAID_EXCEEDS_INCURRED",
  when: "numerator-greater-than-denominator",
  message: "Paid exceeds incurred on the selected amount basis",
  tolerance: 1e-9,
}];

/** Builds the optional 20-metric reference preset from caller-selected keys and display metadata. */
export function createCasualtyQuarterlyMetrics(
  options: CasualtyMetricPresetOptions = {},
): readonly MetricDefinition[] {
  const C = {
    ...CASUALTY_DIAGNOSTIC_COMPONENTS,
    ...definedProperties(options.components),
  };
  const frequencyScale = options.frequencyScale ?? 1_000_000;
  if (!Number.isFinite(frequencyScale) || frequencyScale <= 0) {
    throw new ReservingError("BAD_RATIO", `Casualty frequency scale must be positive; got ${frequencyScale}`);
  }
  const version = options.definitionVersion ?? "casualty-quarterly-v1";
  const frequencyUnit = options.frequencyUnit ?? (frequencyScale === 1_000_000
    ? "count-per-million"
    : "count-per-exposure-scale");
  const limitedBasis = options.basisLabels?.limited250 ?? "$250K pre-capped total";
  const primaryBasis = options.basisLabels?.primary ?? "$1M capped indemnity plus unlimited expense";
  const countBasis = options.basisLabels?.counts ?? "count";
  const override = (id: string) => options.displayOverrides?.[id];
  const nonClosedNoPay = sub(m(C.reported), m(C.closedNoPay));
  return [
    metric("reported-frequency", "Reported claim frequency", "Reported claims per scaled exposure units", frequencyUnit, frequencyScale, m(C.reported), m(C.exposure), "reported claims", "exposure", countBasis, version, override("reported-frequency")),
    metric("open-frequency", "Open claim frequency", "Open claims per scaled exposure units", frequencyUnit, frequencyScale, m(C.open), m(C.exposure), "open claims", "exposure", countBasis, version, override("open-frequency")),
    metric("closed-no-pay-frequency", "Closed-no-pay frequency", "Closed-no-pay claims per scaled exposure units", frequencyUnit, frequencyScale, m(C.closedNoPay), m(C.exposure), "closed-no-pay claims", "exposure", countBasis, version, override("closed-no-pay-frequency")),
    metric("closed-with-pay-frequency", "Closed-with-pay frequency", "Closed-with-pay claims per scaled exposure units", frequencyUnit, frequencyScale, m(C.closedWithPay), m(C.exposure), "closed-with-pay claims", "exposure", countBasis, version, override("closed-with-pay-frequency")),
    metric("non-closed-no-pay-frequency", "Non-closed-no-pay frequency", "Reported less closed-no-pay claims per scaled exposure units", frequencyUnit, frequencyScale, nonClosedNoPay, m(C.exposure), "reported less closed-no-pay claims", "exposure", countBasis, version, override("non-closed-no-pay-frequency")),
    metric("closed-no-pay-share", "Closed-no-pay share", "Closed-no-pay claims divided by reported claims", "ratio", 1, m(C.closedNoPay), m(C.reported), "closed-no-pay claims", "reported claims", countBasis, version, override("closed-no-pay-share")),
    metric("closed-with-pay-share", "Closed-with-pay share", "Closed-with-pay claims divided by reported claims", "ratio", 1, m(C.closedWithPay), m(C.reported), "closed-with-pay claims", "reported claims", countBasis, version, override("closed-with-pay-share")),
    metric("open-share", "Open share", "Open claims divided by reported claims", "ratio", 1, m(C.open), m(C.reported), "open claims", "reported claims", countBasis, version, override("open-share")),
    metric("paid-to-incurred-250", "Paid-to-incurred ($250K)", "Paid divided by incurred on the pre-capped $250K basis", "ratio", 1, m(C.paid250), m(C.incurred250), "$250K paid", "$250K incurred", limitedBasis, version, override("paid-to-incurred-250"), paidWarning),
    metric("paid-to-incurred-primary", "Paid-to-incurred (primary)", "Paid divided by incurred on the primary basis", "ratio", 1, m(C.paidPrimary), m(C.incurredPrimary), "primary paid", "primary incurred", primaryBasis, version, override("paid-to-incurred-primary"), paidWarning),
    metric("incurred-250-per-exposure", "Incurred per exposure ($250K)", "$250K incurred divided by exposure", "currency-per-exposure", 1, m(C.incurred250), m(C.exposure), "$250K incurred", "exposure", limitedBasis, version, override("incurred-250-per-exposure")),
    metric("incurred-primary-per-exposure", "Incurred per exposure (primary)", "Primary incurred divided by exposure", "currency-per-exposure", 1, m(C.incurredPrimary), m(C.exposure), "primary incurred", "exposure", primaryBasis, version, override("incurred-primary-per-exposure")),
    metric("incurred-250-per-non-cnp", "Incurred severity ($250K)", "$250K incurred divided by reported less closed-no-pay claims", "currency-per-claim", 1, m(C.incurred250), nonClosedNoPay, "$250K incurred", "reported less closed-no-pay claims", limitedBasis, version, override("incurred-250-per-non-cnp")),
    metric("incurred-primary-per-non-cnp", "Incurred severity (primary)", "Primary incurred divided by reported less closed-no-pay claims", "currency-per-claim", 1, m(C.incurredPrimary), nonClosedNoPay, "primary incurred", "reported less closed-no-pay claims", primaryBasis, version, override("incurred-primary-per-non-cnp")),
    metric("paid-250-per-exposure", "Paid per exposure ($250K)", "$250K paid divided by exposure", "currency-per-exposure", 1, m(C.paid250), m(C.exposure), "$250K paid", "exposure", limitedBasis, version, override("paid-250-per-exposure")),
    metric("paid-primary-per-exposure", "Paid per exposure (primary)", "Primary paid divided by exposure", "currency-per-exposure", 1, m(C.paidPrimary), m(C.exposure), "primary paid", "exposure", primaryBasis, version, override("paid-primary-per-exposure")),
    metric("paid-250-per-closed-with-pay", "Paid severity ($250K)", "$250K paid divided by closed-with-pay claims", "currency-per-claim", 1, m(C.paid250), m(C.closedWithPay), "$250K paid", "closed-with-pay claims", limitedBasis, version, override("paid-250-per-closed-with-pay")),
    metric("paid-primary-per-closed-with-pay", "Paid severity (primary)", "Primary paid divided by closed-with-pay claims", "currency-per-claim", 1, m(C.paidPrimary), m(C.closedWithPay), "primary paid", "closed-with-pay claims", primaryBasis, version, override("paid-primary-per-closed-with-pay")),
    metric("case-250-per-open", "Case reserve per open claim ($250K)", "$250K incurred less paid divided by open claims", "currency-per-claim", 1, sub(m(C.incurred250), m(C.paid250)), m(C.open), "$250K incurred less paid", "open claims", limitedBasis, version, override("case-250-per-open")),
    metric("case-primary-per-open", "Case reserve per open claim (primary)", "Primary incurred less paid divided by open claims", "currency-per-claim", 1, sub(m(C.incurredPrimary), m(C.paidPrimary)), m(C.open), "primary incurred less paid", "open claims", primaryBasis, version, override("case-primary-per-open")),
  ];
}

export const CASUALTY_QUARTERLY_METRICS = createCasualtyQuarterlyMetrics();

export interface CasualtyAmountLayerOptions {
  components?: Partial<Pick<CasualtyDiagnosticComponentKeys, "paid250" | "incurred250" | "paidPrimary" | "incurredPrimary">>;
  limited250?: {
    id?: string;
    displayName?: string;
    paidSourceMeasure?: string;
    incurredSourceMeasure?: string;
  };
  primary?: {
    id?: string;
    displayName?: string;
    indemnityPaidMeasure?: string;
    indemnityIncurredMeasure?: string;
    expensePaidMeasure?: string;
    expenseIncurredMeasure?: string;
    indemnityLimit?: number;
  };
}

export function createCasualtyAmountLayers(
  options: CasualtyAmountLayerOptions = {},
): readonly AmountLayerDefinition[] {
  const C = {
    ...CASUALTY_DIAGNOSTIC_COMPONENTS,
    ...definedProperties(options.components),
  };
  const limit = options.primary?.indemnityLimit ?? 1_000_000;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new ReservingError("BAD_CAP", `Primary indemnity limit must be positive; got ${limit}`);
  }
  return [
  {
    id: options.limited250?.id ?? "250k-pre-capped-total",
    displayName: options.limited250?.displayName ?? "$250K pre-capped total",
    paidMeasure: C.paid250,
    incurredMeasure: C.incurred250,
    paid: { op: "measure", measure: options.limited250?.paidSourceMeasure ?? "preCapped250Paid" },
    incurred: { op: "measure", measure: options.limited250?.incurredSourceMeasure ?? "preCapped250Incurred" },
    basis: "pre-capped-additive",
  },
  {
    id: options.primary?.id ?? "primary-1m-indemnity-plus-expense",
    displayName: options.primary?.displayName ?? "Primary: $1M capped indemnity plus unlimited expense",
    paidMeasure: C.paidPrimary,
    incurredMeasure: C.incurredPrimary,
    paid: { op: "add", terms: [{ op: "claim-cap", measure: options.primary?.indemnityPaidMeasure ?? "indemnityPaid", limit }, { op: "measure", measure: options.primary?.expensePaidMeasure ?? "expensePaid" }] },
    incurred: { op: "add", terms: [{ op: "claim-cap", measure: options.primary?.indemnityIncurredMeasure ?? "indemnityIncurred", limit }, { op: "measure", measure: options.primary?.expenseIncurredMeasure ?? "expenseIncurred" }] },
    basis: "claim-level-cap",
  },
  ];
}

export const CASUALTY_AMOUNT_LAYERS = createCasualtyAmountLayers();
