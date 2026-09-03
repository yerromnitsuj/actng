import { CASUALTY_FORMULA_TEMPLATES } from "./diagnosticFormulas.js";
import { DiagnosticValidationError } from "./types.js";
import type { DiagnosticMetricInstance, DiagnosticMetricPresentation } from "./diagnosticDefinitions.js";

export { CASUALTY_FORMULA_TEMPLATES };

export interface CasualtyCountBindings { readonly reported: string; readonly open: string; readonly closedNoPay: string; readonly closedWithPay: string }
export interface CasualtyAmountBinding { readonly id: string; readonly paid: string; readonly incurred: string }
export type DiagnosticMetricPresentationOverride = Partial<DiagnosticMetricPresentation>;
export interface CreateCasualtyMetricInstancesInput {
  readonly counts: CasualtyCountBindings;
  readonly exposure: string;
  readonly amountBindings: readonly CasualtyAmountBinding[];
  readonly presentationOverrides?: Readonly<Record<string, DiagnosticMetricPresentationOverride>>;
}

type Spec = readonly [suffix: string, formulaId: string, numerator: import("./diagnosticExpressions.js").DiagnosticMeasureExpression, denominator: import("./diagnosticExpressions.js").DiagnosticMeasureExpression, presentation: DiagnosticMetricPresentation];
const m = (measureId: string) => ({ op: "measure" as const, measureId });
const sub = (left: ReturnType<typeof m>, right: ReturnType<typeof m>) => ({ op: "subtract" as const, left, right });

function validToken(value: string): boolean {
  if (value.length === 0 || /^[\t-\r ]|[\t-\r ]$/.test(value) || value.includes("\0")) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function encodeBindingId(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }

function presentation(displayName: string, description: string, displayUnit: string, numeratorLabel: string, denominatorLabel: string): DiagnosticMetricPresentation {
  return { displayName, description, displayUnit, scale: 1, numeratorLabel, denominatorLabel };
}

function overridePresentation(id: string, base: DiagnosticMetricPresentation, overrides: CreateCasualtyMetricInstancesInput["presentationOverrides"]): DiagnosticMetricPresentation {
  const override = overrides?.[id];
  if (!override) return base;
  for (const [key, value] of Object.entries(override)) if (value === undefined) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-type", path: `$.presentationOverrides[${JSON.stringify(id)}].${key}`, message: "Presentation override cannot contain undefined" }]);
  const result = { ...base, ...override };
  if (!Number.isFinite(result.scale) || result.scale <= 0) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-number", path: `$.presentationOverrides[${JSON.stringify(id)}].scale`, message: "Presentation scale must be finite and positive" }]);
  return result;
}

export function createCasualtyMetricInstances(input: CreateCasualtyMetricInstancesInput): readonly DiagnosticMetricInstance[] {
  for (const [key, value] of Object.entries({ ...input.counts, exposure: input.exposure })) if (!validToken(value)) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-string", path: `$.${key}`, message: "Measure binding must be a token" }]);
  const ids = new Set<string>();
  for (const [index, binding] of input.amountBindings.entries()) {
    if (!validToken(binding.id) || !validToken(binding.paid) || !validToken(binding.incurred)) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-string", path: `$.amountBindings[${index}]`, message: "Amount binding fields must be tokens" }]);
    if (ids.has(binding.id)) throw new DiagnosticValidationError([{ domain: "configuration", code: "duplicate-id", path: `$.amountBindings[${index}].id`, message: `Duplicate amount binding ${binding.id}` }]);
    ids.add(binding.id);
  }
  const nonClosedNoPay = sub(m(input.counts.reported), m(input.counts.closedNoPay));
  const countSpecs: Spec[] = [
    ["reported-frequency", "frequency", m(input.counts.reported), m(input.exposure), presentation("Reported frequency", "Reported count divided by exposure", "count per exposure", "reported", "exposure")],
    ["open-frequency", "frequency", m(input.counts.open), m(input.exposure), presentation("Open frequency", "Open count divided by exposure", "count per exposure", "open", "exposure")],
    ["closed-no-pay-frequency", "frequency", m(input.counts.closedNoPay), m(input.exposure), presentation("Closed-no-pay frequency", "Closed-no-pay count divided by exposure", "count per exposure", "closed-no-pay", "exposure")],
    ["closed-with-pay-frequency", "frequency", m(input.counts.closedWithPay), m(input.exposure), presentation("Closed-with-pay frequency", "Closed-with-pay count divided by exposure", "count per exposure", "closed-with-pay", "exposure")],
    ["non-closed-no-pay-frequency", "frequency", nonClosedNoPay, m(input.exposure), presentation("Non-closed-no-pay frequency", "Reported less closed-no-pay count divided by exposure", "count per exposure", "reported less closed-no-pay", "exposure")],
    ["closed-no-pay-share", "share", m(input.counts.closedNoPay), m(input.counts.reported), presentation("Closed-no-pay share", "Closed-no-pay count divided by reported count", "ratio", "closed-no-pay", "reported")],
    ["closed-with-pay-share", "share", m(input.counts.closedWithPay), m(input.counts.reported), presentation("Closed-with-pay share", "Closed-with-pay count divided by reported count", "ratio", "closed-with-pay", "reported")],
    ["closed-with-pay-share-of-non-closed-no-pay", "share", m(input.counts.closedWithPay), nonClosedNoPay, presentation("Closed-with-pay share of non-closed-no-pay", "Closed-with-pay count divided by reported less closed-no-pay count", "ratio", "closed-with-pay", "reported less closed-no-pay")],
    ["open-share", "share", m(input.counts.open), m(input.counts.reported), presentation("Open share", "Open count divided by reported count", "ratio", "open", "reported")],
    ["open-share-of-non-closed-no-pay", "share", m(input.counts.open), nonClosedNoPay, presentation("Open share of non-closed-no-pay", "Open count divided by reported less closed-no-pay count", "ratio", "open", "reported less closed-no-pay")],
  ];
  const specs: { id: string; formulaId: string; bindings: Record<string, import("./diagnosticExpressions.js").DiagnosticMeasureExpression>; presentation: DiagnosticMetricPresentation; rules: DiagnosticMetricInstance["rules"] }[] = [];
  for (const [suffix, formulaId, numerator, denominator, display] of countSpecs) {
    const id = `casualty/count/${suffix}`;
    const bindings: Record<string, import("./diagnosticExpressions.js").DiagnosticMeasureExpression> = formulaId === "frequency"
      ? { claims: numerator, exposure: denominator }
      : { part: numerator, whole: denominator };
    specs.push({ id, formulaId, bindings, presentation: display, rules: [] });
  }
  for (const binding of input.amountBindings) {
    const prefix = `casualty/amount/${encodeBindingId(binding.id)}`;
    const amountSpecs = [
      ["paid-to-incurred", "paid-to-incurred", { paid: m(binding.paid), incurred: m(binding.incurred) }, presentation("Paid to incurred", "Paid divided by incurred on the bound amount basis", "ratio", "paid", "incurred")],
      ["incurred-per-exposure", "amount-per-exposure", { amount: m(binding.incurred), exposure: m(input.exposure) }, presentation("Incurred per exposure", "Incurred divided by exposure", "amount per exposure", "incurred", "exposure")],
      ["incurred-per-non-closed-no-pay-claim", "amount-per-claim", { amount: m(binding.incurred), claims: nonClosedNoPay }, presentation("Incurred per non-closed-no-pay claim", "Incurred divided by reported less closed-no-pay count", "amount per claim", "incurred", "reported less closed-no-pay")],
      ["paid-per-exposure", "amount-per-exposure", { amount: m(binding.paid), exposure: m(input.exposure) }, presentation("Paid per exposure", "Paid divided by exposure", "amount per exposure", "paid", "exposure")],
      ["paid-per-closed-with-pay-claim", "amount-per-claim", { amount: m(binding.paid), claims: m(input.counts.closedWithPay) }, presentation("Paid per closed-with-pay claim", "Paid divided by closed-with-pay count", "amount per claim", "paid", "closed-with-pay")],
      ["case-per-open-claim", "case-per-open", { incurred: m(binding.incurred), paid: m(binding.paid), open: m(input.counts.open) }, presentation("Case reserve per open claim", "Incurred less paid divided by open count", "amount per claim", "incurred less paid", "open")],
    ] as const;
    for (const [suffix, formulaId, bindings, display] of amountSpecs) {
      const id = `${prefix}/${suffix}`;
      const rules = suffix === "paid-to-incurred" ? [{ id: `${id}/rule/paid-exceeds-incurred`, code: "paid-exceeds-incurred", message: "Paid exceeds incurred on the bound amount basis", severity: "warning" as const, when: { left: { source: "calculation" as const, field: "numerator" as const }, operator: "gt" as const, right: { source: "calculation" as const, field: "denominator" as const }, tolerance: { absolute: 0, relative: 0 } } }] : suffix === "case-per-open-claim" ? [{ id: `${id}/rule/negative-case`, code: "negative-case", message: "Incurred less paid is negative on the bound amount basis", severity: "warning" as const, when: { left: { source: "calculation" as const, field: "numerator" as const }, operator: "lt" as const, right: { source: "constant" as const, value: 0 }, tolerance: { absolute: 0, relative: 0 } } }] : [];
      specs.push({ id, formulaId, bindings: { ...bindings }, presentation: display, rules });
    }
  }
  const validIds = new Set(specs.map((spec) => spec.id));
  for (const key of Object.keys(input.presentationOverrides ?? {})) if (!validIds.has(key)) throw new DiagnosticValidationError([{ domain: "configuration", code: "unknown-reference", path: `$.presentationOverrides[${JSON.stringify(key)}]`, message: "Presentation override names an unknown generated instance" }]);
  return Object.freeze(specs.map((spec) => Object.freeze({ id: spec.id, version: "1.0.0", formulaId: spec.formulaId, bindings: spec.bindings, presentation: overridePresentation(spec.id, spec.presentation, input.presentationOverrides), rules: spec.rules })));
}
