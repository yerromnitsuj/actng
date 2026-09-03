import {
  DiagnosticValidationError,
  compileDiagnosticDefinition,
  prepareDiagnosticData,
  runMetricDiagnostics,
  type CompiledDiagnosticDefinition,
  type DiagnosticCompletePeriodCutoff,
  type DiagnosticDeepReadonly,
  type DiagnosticDefinition,
  type DiagnosticExpectedCell,
  type DiagnosticExposureObservation,
  type DiagnosticLossInput,
  type DiagnosticsFilter,
  type JsonValue,
  type MetricDiagnosticsResult,
  type DiagnosticValidationIssue,
} from "@actuarial-ts/core";
import { z } from "zod";
import { reviewPreparedDiagnosticData, type DiagnosticReviewReceipt } from "./diagnosticPreparedReview.js";

const sourceSchema = z.object({ artifactId: z.string().min(1), sourceFile: z.string().min(1).optional(), sourceSheet: z.string().min(1).optional(), sourceRow: z.number().int().nonnegative().optional(), sourceCell: z.string().min(1).optional() }).strict();
const measuresSchema = z.record(z.union([z.number(), z.null()]));
const lossBase = { recordId: z.string().min(1), sourceGroup: z.string().min(1), origin: z.string().min(1), valuation: z.string().min(1), complete: z.boolean(), source: sourceSchema.optional(), measures: measuresSchema };
const lossSchema = z.discriminatedUnion("rowType", [z.object({ ...lossBase, rowType: z.literal("claim"), claimId: z.string().min(1) }).strict(), z.object({ ...lossBase, rowType: z.literal("aggregate") }).strict()]);
const exposureSchema = z.object({ key: z.string().min(1), sourceGroup: z.string().min(1), origin: z.string().min(1), valuation: z.string().min(1).optional(), measureId: z.string().min(1), value: z.union([z.number(), z.null()]), complete: z.boolean(), source: sourceSchema.optional() }).strict();
const filterSchema = z.object({ sourceGroups: z.array(z.string().min(1)).optional(), outputGroups: z.array(z.string().min(1)).optional(), origins: z.array(z.string().min(1)).optional(), originFrom: z.string().min(1).optional(), originThrough: z.string().min(1).optional(), valuations: z.array(z.string().min(1)).optional(), valuationFrom: z.string().min(1).optional(), valuationThrough: z.string().min(1).optional(), minDevelopmentAge: z.number().int().nonnegative().optional(), maxDevelopmentAge: z.number().int().nonnegative().optional(), instanceIds: z.array(z.string().min(1)).optional() }).strict();
const cutoffSchema = z.object({ sourceGroup: z.string().min(1), originThrough: z.string().min(1).nullable(), valuationThrough: z.string().min(1).nullable() }).strict();
const expectedSchema = z.object({ sourceGroup: z.string().min(1), origin: z.string().min(1), valuation: z.string().min(1), source: sourceSchema.optional() }).strict();
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonSchema), z.record(jsonSchema)]));
const policySchema = z.object({ allowedReviewStatuses: z.array(z.enum(["pass", "warning", "not-evaluated", "fail"])).optional(), allowedMetricFindingSeverities: z.array(z.enum(["info", "warning", "fail"])).optional(), rationaleRef: z.string().min(1).optional() }).strict();
const runSchema = z.object({ definition: z.unknown(), losses: z.array(lossSchema), exposures: z.array(exposureSchema).optional(), filter: filterSchema.optional(), completePeriodCutoffs: z.array(cutoffSchema).optional(), expectedCells: z.array(expectedSchema).optional(), reviewEvidence: jsonSchema.nullable().optional(), runPresetId: z.string().min(1).optional(), datasetArtifactId: z.string().min(1).optional(), groupMap: z.record(z.string().min(1)).optional(), groupDimensions: z.record(jsonSchema).optional(), policy: policySchema.optional() }).strict();

export type DiagnosticAllowedReviewStatus = "pass" | "warning" | "not-evaluated" | "fail";
export interface DiagnosticExecutionPolicyInput { readonly allowedReviewStatuses?: readonly DiagnosticAllowedReviewStatus[]; readonly allowedMetricFindingSeverities?: readonly ("info" | "warning" | "fail")[]; readonly rationaleRef?: string }
export interface DiagnosticRunInput { readonly definition: DiagnosticDefinition; readonly losses: readonly DiagnosticLossInput[]; readonly exposures?: readonly DiagnosticExposureObservation[]; readonly filter?: DiagnosticsFilter; readonly completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[]; readonly expectedCells?: readonly DiagnosticExpectedCell[]; readonly reviewEvidence?: JsonValue | null; readonly runPresetId?: string; readonly datasetArtifactId?: string; readonly groupMap?: Readonly<Record<string,string>>; readonly groupDimensions?: Readonly<Record<string,JsonValue>>; readonly policy?: DiagnosticExecutionPolicyInput }
declare const validatedDiagnosticRunInputBrand: unique symbol;
export interface ValidatedDiagnosticRunInput { readonly [validatedDiagnosticRunInputBrand]: true; readonly definition: CompiledDiagnosticDefinition; readonly losses: readonly DiagnosticDeepReadonly<DiagnosticLossInput>[]; readonly exposures: readonly DiagnosticDeepReadonly<DiagnosticExposureObservation>[]; readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter>|null; readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[]; readonly expectedCells: readonly DiagnosticExpectedCell[]|null; readonly reviewEvidence: JsonValue|null; readonly runPresetId: string|null; readonly datasetArtifactId: string|null; readonly groupMap: Readonly<Record<string,string>>; readonly groupDimensions: Readonly<Record<string,JsonValue>>; readonly policy: { readonly allowedReviewStatuses: readonly DiagnosticAllowedReviewStatus[]; readonly allowedMetricFindingSeverities: readonly ("info"|"warning"|"fail")[]; readonly rationaleRef: string|null } }
export interface DiagnosticExecutionGateReceipt { readonly allowedReviewStatuses:readonly DiagnosticAllowedReviewStatus[];readonly allowedMetricFindingSeverities:readonly ("info"|"warning"|"fail")[];readonly rationaleRef:string|null;readonly reviewGate:"passed"|"blocked";readonly metricGate:"not-run"|"passed"|"blocked" }
export interface CompletedValidatedMetricDiagnosticsRun { readonly status:"completed";readonly prepared:import("@actuarial-ts/core").PreparedDiagnosticData;readonly review:DiagnosticReviewReceipt;readonly result:DiagnosticDeepReadonly<MetricDiagnosticsResult>;readonly runPresetId:string|null;readonly datasetArtifactId:string|null;readonly groupMap:Readonly<Record<string,string>>;readonly groupDimensions:Readonly<Record<string,JsonValue>>;readonly gate:DiagnosticExecutionGateReceipt&{readonly reviewGate:"passed";readonly metricGate:"passed"} }
export type ValidatedMetricDiagnosticsOutcome=CompletedValidatedMetricDiagnosticsRun|{readonly status:"blocked";readonly stage:"review";readonly prepared:import("@actuarial-ts/core").PreparedDiagnosticData;readonly review:DiagnosticReviewReceipt;readonly result:null;readonly runPresetId:string|null;readonly datasetArtifactId:string|null;readonly groupMap:Readonly<Record<string,string>>;readonly groupDimensions:Readonly<Record<string,JsonValue>>;readonly gate:DiagnosticExecutionGateReceipt&{readonly reviewGate:"blocked";readonly metricGate:"not-run"}}|{readonly status:"blocked";readonly stage:"metric";readonly prepared:import("@actuarial-ts/core").PreparedDiagnosticData;readonly review:DiagnosticReviewReceipt;readonly result:DiagnosticDeepReadonly<MetricDiagnosticsResult>;readonly runPresetId:string|null;readonly datasetArtifactId:string|null;readonly groupMap:Readonly<Record<string,string>>;readonly groupDimensions:Readonly<Record<string,JsonValue>>;readonly gate:DiagnosticExecutionGateReceipt&{readonly reviewGate:"passed";readonly metricGate:"blocked"}};

const authentic = new WeakSet<object>();
function freeze<T>(value:T,seen=new WeakSet<object>()):DiagnosticDeepReadonly<T>{if(value===null||typeof value!=="object"||seen.has(value))return value as DiagnosticDeepReadonly<T>;seen.add(value);for(const child of Object.values(value as Record<string,unknown>))freeze(child,seen);return Object.freeze(value) as DiagnosticDeepReadonly<T>}
function issues(error:z.ZodError):DiagnosticValidationError{return new DiagnosticValidationError(error.issues.map((issue)=>({domain:(issue.path[0]==="definition"?"definition":issue.path[0]==="losses"||issue.path[0]==="exposures"||issue.path[0]==="reviewEvidence"?"input":"configuration") as "definition"|"input"|"configuration",code:issue.code==="unrecognized_keys"?"unknown-key":"invalid-type",path:`$${issue.path.map((part)=>typeof part==="number"?`[${part}]`:/^[A-Za-z_$][\w$]*$/.test(part)?`.${part}`:`[${JSON.stringify(part)}]`).join("")}`,message:issue.message})))}

export function validateDiagnosticRunInput(value:unknown):ValidatedDiagnosticRunInput{
  const parsed=runSchema.safeParse(value);if(!parsed.success)throw issues(parsed.error);
  const definition=compileDiagnosticDefinition(parsed.data.definition as DiagnosticDefinition);
  const relationIssues:DiagnosticValidationIssue[]=parsed.data.losses.flatMap((row,index)=>row.rowType===definition.definition.lossRowGrain?[]:[{domain:"input" as const,code:"invalid-input-relationship" as const,path:`$.losses[${index}].rowType`,message:"Loss row type does not match definition grain"}]);
  for(const [index,row] of (parsed.data.exposures??[]).entries()){const measure=definition.definition.measures.find((item)=>item.id===row.measureId);if(measure?.exposureTiming==="valuation-specific"&&row.valuation===undefined)relationIssues.push({domain:"input",code:"missing-required",path:`$.exposures[${index}].valuation`,message:"Valuation-specific exposure requires valuation"})}
  if(relationIssues.length)throw new DiagnosticValidationError(relationIssues);
  const review=parsed.data.policy?.allowedReviewStatuses??["pass","warning","not-evaluated"];
  const metric=parsed.data.policy?.allowedMetricFindingSeverities??["info","warning"];
  const rationale=parsed.data.policy?.rationaleRef??null;
  if((review.includes("fail")||metric.includes("fail"))&&rationale===null)throw new DiagnosticValidationError([{domain:"configuration",code:"missing-required",path:"$.policy.rationaleRef",message:"A rationale is required when fail outcomes are allowed"}]);
  const result=freeze({definition,losses:parsed.data.losses,exposures:parsed.data.exposures??[],filter:parsed.data.filter??null,completePeriodCutoffs:parsed.data.completePeriodCutoffs??[],expectedCells:parsed.data.expectedCells??null,reviewEvidence:parsed.data.reviewEvidence??null,runPresetId:parsed.data.runPresetId??null,datasetArtifactId:parsed.data.datasetArtifactId??null,groupMap:parsed.data.groupMap??Object.create(null),groupDimensions:parsed.data.groupDimensions??Object.create(null),policy:{allowedReviewStatuses:[...new Set(review)],allowedMetricFindingSeverities:[...new Set(metric)],rationaleRef:rationale}}) as unknown as ValidatedDiagnosticRunInput;
  authentic.add(result);return result;
}

export function assertValidatedDiagnosticRunInput(value:unknown):asserts value is ValidatedDiagnosticRunInput{if(value===null||typeof value!=="object"||!authentic.has(value))throw new DiagnosticValidationError([{domain:"input",code:"invalid-input-relationship",path:"$",message:"Value is not an authentic validated diagnostic run input"}])}

const completed=new WeakSet<object>();
export function runValidatedMetricDiagnostics(input:ValidatedDiagnosticRunInput):ValidatedMetricDiagnosticsOutcome{
  assertValidatedDiagnosticRunInput(input);const prepared=prepareDiagnosticData({definition:input.definition,losses:input.losses,exposures:input.exposures,filter:input.filter??undefined,completePeriodCutoffs:input.completePeriodCutoffs,expectedCells:input.expectedCells??undefined});
  const review=reviewPreparedDiagnosticData({prepared,evidence:input.reviewEvidence as import("./diagnosticPreparedReview.js").DiagnosticReviewEvidence|null});
  const disallowedReview=review.report.checks.some((check)=>!input.policy.allowedReviewStatuses.includes(check.status));
  const base={prepared,review,runPresetId:input.runPresetId,datasetArtifactId:input.datasetArtifactId,groupMap:input.groupMap,groupDimensions:input.groupDimensions};
  if(disallowedReview)return freeze({...base,status:"blocked" as const,stage:"review" as const,result:null,gate:{...input.policy,reviewGate:"blocked" as const,metricGate:"not-run" as const}}) as ValidatedMetricDiagnosticsOutcome;
  const result=runMetricDiagnostics({prepared,groupMap:input.groupMap,groupDimensions:input.groupDimensions});
  const disallowedMetric=result.findings.some((finding)=>finding.category!=="structural"&&!input.policy.allowedMetricFindingSeverities.includes(finding.severity));
  if(disallowedMetric)return freeze({...base,status:"blocked" as const,stage:"metric" as const,result,gate:{...input.policy,reviewGate:"passed" as const,metricGate:"blocked" as const}}) as ValidatedMetricDiagnosticsOutcome;
  const outcome=freeze({...base,status:"completed" as const,result,gate:{...input.policy,reviewGate:"passed" as const,metricGate:"passed" as const}}) as unknown as CompletedValidatedMetricDiagnosticsRun;completed.add(outcome);return outcome;
}
export function assertCompletedValidatedMetricDiagnosticsRun(value:unknown):asserts value is CompletedValidatedMetricDiagnosticsRun{if(value===null||typeof value!=="object"||!completed.has(value))throw new DiagnosticValidationError([{domain:"input",code:"invalid-input-relationship",path:"$",message:"Value is not an authentic completed diagnostic run"}])}
