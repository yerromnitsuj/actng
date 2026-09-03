import type { DiagnosticDeepReadonly, DiagnosticMeasureDefinition, DiagnosticMetricPresentation, DiagnosticsFilter, JsonValue } from "./diagnosticDefinitions.js";
import { getCompiledDiagnosticDefinitionInternals } from "./diagnosticDefinitions.js";
import { applyDiagnosticPresentation, diagnosticRawRatio, evaluateDiagnosticMeasureExpression, evaluateDiagnosticRoleExpression, type DiagnosticMetricFinding, type DiagnosticQuantity, type FinalizedDiagnosticMeasure } from "./diagnosticFormulas.js";
import { classifyDiagnosticComparison, diagnosticPredicateMatches, type DiagnosticRuleEvaluation } from "./diagnosticRules.js";
import { assertPreparedDiagnosticData, type PreparedDiagnosticData } from "./diagnosticPreparation.js";
import type { DiagnosticMeasureStats } from "./diagnosticDefinitions.js";
import { DiagnosticValidationError } from "./types.js";

export interface RunMetricDiagnosticsInput { readonly prepared: PreparedDiagnosticData; readonly groupMap?: Readonly<Record<string, string>>; readonly groupDimensions?: Readonly<Record<string, JsonValue>> }
export interface DiagnosticMetricEvaluation {
  readonly instanceId: string; readonly instanceVersion: string; readonly formulaId: string; readonly formulaVersion: string;
  readonly semanticReferences: { readonly amountBasisIds: readonly string[]; readonly countPopulationIds: readonly string[]; readonly exposureBasisIds: readonly string[] };
  readonly formulaFingerprint: string; readonly calculationFingerprint: string; readonly definitionIntegrity: string;
  readonly calculation: { readonly numerator: DiagnosticQuantity; readonly denominator: DiagnosticQuantity; readonly value: number | null };
  readonly presentation: DiagnosticMetricPresentation & { readonly value: number | null };
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly rules: readonly DiagnosticRuleEvaluation[];
  readonly findings: readonly DiagnosticMetricFinding[];
}
export interface DiagnosticEmergencePoint { readonly group: string; readonly sourceGroups: readonly string[]; readonly dimensions?: JsonValue; readonly origin: string; readonly valuation: string; readonly developmentAge: number; readonly ageUnit: string; readonly components: Readonly<Record<string, DiagnosticMeasureStats>>; readonly metrics: Readonly<Record<string, DiagnosticMetricEvaluation>>; readonly findings: readonly DiagnosticMetricFinding[] }
export interface DiagnosticMetricTriangleCell { readonly origin: string; readonly valuation: string; readonly developmentAge: number; readonly ageUnit: string; readonly evaluation: DiagnosticMetricEvaluation }
export interface DiagnosticMetricTriangle { readonly group: string; readonly instanceId: string; readonly origins: readonly string[]; readonly developmentAges: readonly number[]; readonly ageUnit: string; readonly calculationValues: readonly (readonly (number | null)[])[]; readonly presentationValues: readonly (readonly (number | null)[])[]; readonly cells: readonly (readonly (DiagnosticMetricTriangleCell | null)[])[] }
export interface MetricDiagnosticsResult { readonly definitionIntegrity: string; readonly preparationFingerprint: string; readonly ageUnit: string; readonly emergence: readonly DiagnosticEmergencePoint[]; readonly triangles: readonly DiagnosticMetricTriangle[]; readonly latestDiagonal: readonly DiagnosticEmergencePoint[]; readonly findings: readonly DiagnosticMetricFinding[] }
export interface CommonMaturityResult { readonly developmentAge: number | null; readonly ageUnit: string; readonly points: readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[] }
export type NormalizedDiagnosticResultIdentity = DiagnosticDeepReadonly<MetricDiagnosticsResult>;

function codeUnit(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DiagnosticDeepReadonly<T> { if (value === null || typeof value !== "object" || seen.has(value)) return value as DiagnosticDeepReadonly<T>; seen.add(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen); return Object.freeze(value) as DiagnosticDeepReadonly<T> }
function quantity(measure: DiagnosticMeasureDefinition, value: number | null): DiagnosticQuantity { return { kind: measure.kind, unit: measure.unit, ...(measure.basisId ? { basisId: measure.basisId } : {}), ...(measure.countPopulationId ? { countPopulationId: measure.countPopulationId } : {}), ...(measure.exposureBasisId ? { exposureBasisId: measure.exposureBasisId } : {}), value } }

export function validateDiagnosticGroupingConfiguration(input: RunMetricDiagnosticsInput): void {
  assertPreparedDiagnosticData(input.prepared);
  const sourceGroups = new Set(input.prepared.cells.map((cell) => cell.sourceGroup));
  for (const [source, target] of Object.entries(input.groupMap ?? {})) {
    if (!sourceGroups.has(source)) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-configuration", path: `$.groupMap[${JSON.stringify(source)}]`, message: "Group map contains an unused source group" }]);
    if (target.length === 0 || /^[\t-\r ]|[\t-\r ]$/.test(target)) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-string", path: `$.groupMap[${JSON.stringify(source)}]`, message: "Output group must be a nonempty token" }]);
  }
  const outputGroups = new Set([...sourceGroups].map((source) => input.groupMap?.[source] ?? source));
  for (const group of Object.keys(input.groupDimensions ?? {})) if (!outputGroups.has(group)) throw new DiagnosticValidationError([{ domain: "configuration", code: "invalid-configuration", path: `$.groupDimensions[${JSON.stringify(group)}]`, message: "Dimensions contain an unused output group" }]);
  for (const group of input.prepared.filter?.outputGroups ?? []) if (!outputGroups.has(group)) throw new DiagnosticValidationError([{ domain: "configuration", code: "unknown-reference", path: "$.prepared.filter.outputGroups", message: `Unknown output group ${group}` }]);
}

function mergeStats(stats: readonly DiagnosticMeasureStats[]): DiagnosticMeasureStats {
  if (stats.length === 0) return { value: null, sum: 0, observed: 0, missing: 0, nonFinite: 0, imputedZero: 0, deduplicated: 0, structural: 0 };
  const count = (key: "observed" | "missing" | "nonFinite" | "imputedZero" | "deduplicated" | "structural") => stats.reduce((sum, item) => sum + item[key], 0);
  const structural = count("structural"); const nonFinite = count("nonFinite");
  const sums = stats.map((item) => item.sum);
  const sum = structural > 0 || nonFinite > 0 || sums.some((value) => value === null) ? null : sums.reduce<number>((total, value) => total + value!, 0);
  return { value: sum === null || stats.some((item) => item.value === null) ? null : sum, sum, observed: count("observed"), missing: count("missing"), nonFinite, imputedZero: count("imputedZero"), deduplicated: count("deduplicated"), structural };
}

function inferExpressionMeasure(expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression, measures: ReadonlyMap<string, DiagnosticMeasureDefinition>): DiagnosticMeasureDefinition {
  const id = expression.op === "measure" ? expression.measureId : expression.op === "add" ? inferExpressionMeasure(expression.terms[0]!, measures).id : inferExpressionMeasure(expression.left, measures).id;
  return measures.get(id)!;
}

function evaluatePoint(prepared: PreparedDiagnosticData, components: Readonly<Record<string, DiagnosticMeasureStats>>, instanceId: string): DiagnosticMetricEvaluation {
  const definition = prepared.definition;
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const instance = definition.definition.instances.find((item) => item.id === instanceId)!;
  const formula = definition.definition.formulas.find((item) => item.id === instance.formulaId)!;
  const measureStates: Record<string, FinalizedDiagnosticMeasure> = Object.create(null);
  for (const [measureId, stats] of Object.entries(components)) {
    const measure = internals.measuresById.get(measureId)!;
    const readiness = [...(stats.missing > 0 ? [stats.imputedZero > 0 ? "imputed" as const : "missing" as const] : []), ...(stats.nonFinite > 0 ? ["non-finite" as const] : []), ...(stats.structural > 0 ? ["structural-ambiguity" as const] : []), ...(stats.sum === null && stats.nonFinite === 0 && stats.structural === 0 ? ["aggregation-overflow" as const] : [])];
    measureStates[measureId] = { quantity: quantity(measure, stats.value), stats, readiness };
  }
  const bindings = Object.fromEntries(Object.entries(instance.bindings).map(([role, expression]) => [role, evaluateDiagnosticMeasureExpression(expression, measureStates, `$.instances[${JSON.stringify(instance.id)}].bindings[${JSON.stringify(role)}]`)]));
  const numeratorResult = evaluateDiagnosticRoleExpression(formula.numerator, bindings, `$.formulas[${JSON.stringify(formula.id)}].numerator`);
  const denominatorResult = evaluateDiagnosticRoleExpression(formula.denominator, bindings, `$.formulas[${JSON.stringify(formula.id)}].denominator`);
  const raw = diagnosticRawRatio(numeratorResult.value, denominatorResult.value);
  const presented = applyDiagnosticPresentation(raw, instance.presentation);
  const numeratorMeasure = inferExpressionMeasure(instance.bindings[(formula.numerator.op === "role" ? formula.numerator.role : formula.numerator.op === "subtract" && formula.numerator.left.op === "role" ? formula.numerator.left.role : Object.keys(instance.bindings)[0])!]!, internals.measuresById);
  const denominatorMeasure = inferExpressionMeasure(instance.bindings[(formula.denominator.op === "role" ? formula.denominator.role : Object.keys(instance.bindings)[0])!]!, internals.measuresById);
  const ruleEvaluations: DiagnosticRuleEvaluation[] = [];
  const findings: DiagnosticMetricFinding[] = presented.finding ? [{ ...presented.finding, instanceId: instance.id }] : [];
  const operand = (item: typeof instance.rules[number]["when"]["left"]): number | null => item.source === "constant" ? item.value : item.source === "calculation" ? (item.field === "numerator" ? numeratorResult.value : denominatorResult.value) : evaluateDiagnosticMeasureExpression(item.expression, measureStates, "$.rule").value;
  for (const rule of instance.rules) {
    const left = operand(rule.when.left); const right = operand(rule.when.right); const classified = classifyDiagnosticComparison(left, right, rule.when.tolerance);
    if (classified.status === "not-evaluated") ruleEvaluations.push({ ruleId: rule.id, status: "not-evaluated", severity: rule.severity, left: Number.isFinite(left) ? left : null, right: Number.isFinite(right) ? right : null, relation: null, notEvaluatedReasons: [classified.reason], expressionOverflows: [], code: "diagnostic-rule-not-evaluated", message: "Diagnostic metric rule was not evaluated" });
    else {
      const triggered = diagnosticPredicateMatches(rule.when.operator, classified.relation);
      ruleEvaluations.push({ ruleId: rule.id, status: triggered ? "triggered" : "pass", severity: rule.severity, left, right, relation: classified.relation, notEvaluatedReasons: [], expressionOverflows: [], code: triggered ? rule.code : null, message: triggered ? rule.message : null });
      if (triggered) findings.push({ code: rule.code, message: rule.message, severity: rule.severity, category: "rule", ruleId: rule.id, instanceId: instance.id, sources: [] });
    }
  }
  const deps = internals.evaluationDependenciesByInstanceId.get(instance.id) ?? [];
  const refs = { amountBasisIds: [...new Set(deps.flatMap((id) => internals.measuresById.get(id)?.basisId ? [internals.measuresById.get(id)!.basisId!] : []))].sort(codeUnit), countPopulationIds: [...new Set(deps.flatMap((id) => internals.measuresById.get(id)?.countPopulationId ? [internals.measuresById.get(id)!.countPopulationId!] : []))].sort(codeUnit), exposureBasisIds: [...new Set(deps.flatMap((id) => internals.measuresById.get(id)?.exposureBasisId ? [internals.measuresById.get(id)!.exposureBasisId!] : []))].sort(codeUnit) };
  return deepFreeze({ instanceId: instance.id, instanceVersion: instance.version, formulaId: formula.id, formulaVersion: formula.version, semanticReferences: refs, formulaFingerprint: definition.formulaFingerprints[formula.id]!, calculationFingerprint: definition.calculationFingerprints[instance.id]!, definitionIntegrity: definition.definitionIntegrity, calculation: { numerator: quantity(numeratorMeasure, numeratorResult.value), denominator: quantity(denominatorMeasure, denominatorResult.value), value: raw }, presentation: { ...instance.presentation, value: presented.value }, components: Object.fromEntries(deps.map((id) => [id, components[id]!])), rules: ruleEvaluations, findings });
}

export function runMetricDiagnostics(input: RunMetricDiagnosticsInput): DiagnosticDeepReadonly<MetricDiagnosticsResult> {
  validateDiagnosticGroupingConfiguration(input);
  const prepared = input.prepared;
  const buckets = new Map<string, typeof prepared.cells>();
  for (const cell of prepared.cells) { const group = input.groupMap?.[cell.sourceGroup] ?? cell.sourceGroup; if (prepared.filter?.outputGroups !== undefined && !prepared.filter.outputGroups.includes(group)) continue; const key = `${group}\u0000${cell.origin}\u0000${cell.valuation}`; buckets.set(key, [...(buckets.get(key) ?? []), cell]); }
  const selectedInstances = prepared.definition.definition.instances.filter((instance) => prepared.filter?.instanceIds === undefined || prepared.filter.instanceIds.includes(instance.id));
  const emergence: DiagnosticEmergencePoint[] = [];
  for (const [key, cells] of buckets) { const [group, origin, valuation] = key.split("\u0000") as [string,string,string]; const components = Object.fromEntries(prepared.definition.definition.measures.map((measure) => [measure.id, mergeStats(cells.map((cell) => cell.components[measure.id]!))])); const metrics = Object.fromEntries(selectedInstances.map((instance) => [instance.id, evaluatePoint(prepared, components, instance.id)])); emergence.push({ group, sourceGroups: [...new Set(cells.map((cell) => cell.sourceGroup))].sort(codeUnit), ...(input.groupDimensions && Object.prototype.hasOwnProperty.call(input.groupDimensions, group) ? { dimensions: input.groupDimensions[group] } : {}), origin, valuation, developmentAge: cells[0]!.developmentAge, ageUnit: cells[0]!.ageUnit, components, metrics, findings: Object.values(metrics).flatMap((metric) => metric.findings) }); }
  emergence.sort((a,b) => codeUnit(a.group,b.group)||codeUnit(a.origin,b.origin)||a.developmentAge-b.developmentAge||codeUnit(a.valuation,b.valuation));
  const groups = [...new Set(emergence.map((point) => point.group))].sort(codeUnit);
  const triangles: DiagnosticMetricTriangle[] = [];
  for (const group of groups) for (const instance of selectedInstances) { const points = emergence.filter((point) => point.group===group); const origins=[...new Set(points.map((point)=>point.origin))].sort(codeUnit); const ages=[...new Set(points.map((point)=>point.developmentAge))].sort((a,b)=>a-b); const cells=origins.map((origin)=>ages.map((age)=>{const point=points.find((item)=>item.origin===origin&&item.developmentAge===age); return point?{origin:point.origin,valuation:point.valuation,developmentAge:point.developmentAge,ageUnit:point.ageUnit,evaluation:point.metrics[instance.id]!}:null;})); triangles.push({group,instanceId:instance.id,origins,developmentAges:ages,ageUnit:prepared.definition.definition.periodAxis.ageUnit,calculationValues:cells.map((row)=>row.map((cell)=>cell?.evaluation.calculation.value??null)),presentationValues:cells.map((row)=>row.map((cell)=>cell?.evaluation.presentation.value??null)),cells}); }
  const latestDiagonal = groups.flatMap((group)=>{const groupPoints=emergence.filter((point)=>point.group===group); return [...new Set(groupPoints.map((point)=>point.origin))].flatMap((origin)=>{const points=groupPoints.filter((point)=>point.origin===origin); return points.length?[points.reduce((latest,point)=>point.developmentAge>latest.developmentAge?point:latest)]:[];});});
  return deepFreeze({ definitionIntegrity: prepared.definition.definitionIntegrity, preparationFingerprint: prepared.preparationFingerprint, ageUnit: prepared.definition.definition.periodAxis.ageUnit, emergence, triangles, latestDiagonal, findings: [...prepared.findings, ...emergence.flatMap((point)=>point.findings)] });
}

export function sameMaturity(result: DiagnosticDeepReadonly<MetricDiagnosticsResult>, developmentAge: number, outputGroups?: readonly string[]): readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[] { if (!Number.isSafeInteger(developmentAge) || developmentAge < 0) throw new DiagnosticValidationError([{domain:"view",code:"invalid-number",path:"$.developmentAge",message:"Development age must be a nonnegative safe integer"}]); const groups=outputGroups===undefined?null:new Set(outputGroups); return result.emergence.filter((point)=>point.developmentAge===developmentAge&&(groups===null||groups.has(point.group))); }
export function commonMaturity(result: DiagnosticDeepReadonly<MetricDiagnosticsResult>, outputGroups: readonly string[]): DiagnosticDeepReadonly<CommonMaturityResult> { const groups=[...new Set(outputGroups)].sort(codeUnit); const common=[...new Set(result.emergence.filter((p)=>p.group===groups[0]).map((p)=>p.developmentAge))].filter((age)=>groups.every((group)=>result.emergence.some((point)=>point.group===group&&point.developmentAge===age))).sort((a,b)=>b-a); const developmentAge=common[0]??null; return deepFreeze({developmentAge,ageUnit:result.ageUnit,points:developmentAge===null?[]:sameMaturity(result,developmentAge,groups)}); }
export function getMetricDiagnosticsResultIdentity(result: DiagnosticDeepReadonly<MetricDiagnosticsResult>): NormalizedDiagnosticResultIdentity { return deepFreeze(result); }
