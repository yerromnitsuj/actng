import { canonicalJson, evaluateDiagnosticReviewRules, fnv1a64, type DiagnosticDeepReadonly, type DiagnosticReviewRuleEvaluation, type PreparedDiagnosticData } from "@actuarial-ts/core";
import { createNotEvaluatedDataCheck, createStructuredDataCheck, summarizeDataChecks, type DataCheck, type DataFinding, type DataReviewReport } from "./review.js";

export interface DiagnosticGroupingAssignment { readonly key: string; readonly group: string; readonly source?: import("@actuarial-ts/core").DiagnosticSourceLocation }
export interface DiagnosticCachedFormulaEvidence { readonly id: string; readonly source?: import("@actuarial-ts/core").DiagnosticSourceLocation; readonly formula?: string; readonly cachedValue?: number|null; readonly declaredFormulaSource: boolean }
export interface DiagnosticReviewEvidence { readonly groupingAssignments: readonly DiagnosticGroupingAssignment[]; readonly cachedFormulas: readonly DiagnosticCachedFormulaEvidence[] }
export interface DiagnosticReviewIdentityBody { readonly definitionIntegrity:string; readonly preparationFingerprint:string; readonly evidence:DiagnosticDeepReadonly<DiagnosticReviewEvidence>|null; readonly checks:readonly {readonly id:string;readonly status:DataCheck["status"];readonly findings:readonly DataFinding[]}[]; readonly summary:DataReviewReport["summary"]; readonly evaluations:readonly DiagnosticReviewRuleEvaluation[] }
export interface DiagnosticReviewReceipt { readonly report:DiagnosticDeepReadonly<DataReviewReport>; readonly evaluations:readonly DiagnosticReviewRuleEvaluation[]; readonly evidence:DiagnosticDeepReadonly<DiagnosticReviewEvidence>|null; readonly identityBody:DiagnosticDeepReadonly<DiagnosticReviewIdentityBody>; readonly reportFingerprint:string }
export interface ReviewPreparedDiagnosticDataInput { readonly prepared:PreparedDiagnosticData; readonly evidence:DiagnosticReviewEvidence|null }

const fixed=[
  ["diagnostic/structural/loss-identity","Loss identities are unique","fail"],
  ["diagnostic/structural/exposure-identity","Exposure identities are coherent","fail"],
  ["diagnostic/structural/period-validity","Periods are valid","fail"],
  ["diagnostic/structural/measure-contract","Measure keys match their declared sources","fail"],
  ["diagnostic/structural/loss-completeness","Loss records are complete","fail"],
  ["diagnostic/structural/exposure-completeness","Exposure records are complete and finite","fail"],
  ["diagnostic/structural/loss-without-exposure","Loss cells have required exposure","warning"],
  ["diagnostic/structural/exposure-without-loss","Exposures attach to retained loss cells","warning"],
  ["diagnostic/structural/expected-cell-coverage","Expected cells are present","fail"],
  ["diagnostic/structural/grouping-consistency","Grouping assignments are consistent","fail"],
  ["diagnostic/structural/cached-formula-provenance","Cached formulas retain provenance","warning"],
] as const;
const codeToCheck:Record<string,string>={"duplicate-loss-record-id":fixed[0][0],"duplicate-claim-snapshot":fixed[0][0],"claim-identity-conflict":fixed[0][0],"duplicate-aggregate-snapshot":fixed[0][0],"duplicate-exposure-identity":fixed[1][0],"conflicting-exposure-identity":fixed[1][0],"unknown-origin-period":fixed[2][0],"unknown-valuation-period":fixed[2][0],"valuation-before-origin":fixed[2][0],"unsafe-development-age":fixed[2][0],"undeclared-loss-measure":fixed[3][0],"wrong-source-loss-measure":fixed[3][0],"undeclared-exposure-measure":fixed[3][0],"wrong-source-exposure-measure":fixed[3][0],"incomplete-loss-record":fixed[4][0],"missing-exposure-value":fixed[5][0],"incomplete-exposure":fixed[5][0],"non-finite-exposure":fixed[5][0],"loss-without-exposure":fixed[6][0],"exposure-without-loss":fixed[7][0],"missing-expected-cell":fixed[8][0]};
function freeze<T>(value:T):DiagnosticDeepReadonly<T>{if(value&&typeof value==="object"){for(const child of Object.values(value as Record<string,unknown>))freeze(child);Object.freeze(value)}return value as DiagnosticDeepReadonly<T>}

export function reviewPreparedDiagnosticData(input:ReviewPreparedDiagnosticDataInput):DiagnosticReviewReceipt{
  // Authenticity is enforced by the core evaluator before evidence can affect a receipt.
  const evaluations=evaluateDiagnosticReviewRules(input.prepared);
  const evidence=input.evidence===null?null:freeze(structuredClone(input.evidence));
  const findingsByCheck=new Map<string,DataFinding[]>(fixed.map(([id])=>[id,[] as DataFinding[]]));
  for(const finding of input.prepared.findings){const id=codeToCheck[finding.code];if(id)findingsByCheck.get(id)!.push({code:finding.code,message:finding.message,context:{measureId:finding.measureId,sourceGroup:finding.sourceGroup,origin:finding.origin,valuation:finding.valuation,developmentAge:finding.developmentAge,ageUnit:finding.ageUnit,sources:finding.sources}})}
  if(evidence){const assignments=new Map<string,Set<string>>();for(const item of evidence.groupingAssignments){const values=assignments.get(item.key)??new Set<string>();values.add(item.group);assignments.set(item.key,values)}for(const [key,groups] of assignments)if(groups.size>1)findingsByCheck.get(fixed[9][0])!.push({code:"inconsistent-group-mapping",message:"Grouping evidence assigns one key to multiple groups",context:{groupingKey:key,sources:[]}});for(const item of evidence.cachedFormulas)if(item.declaredFormulaSource&&(item.formula===undefined||item.formula.length===0||item.cachedValue===undefined||item.source===undefined))findingsByCheck.get(fixed[10][0])!.push({code:"cached-formula-provenance",message:"Declared formula-derived value lacks complete formula provenance",context:{cachedEvidenceId:item.id,sources:item.source?[item.source]:[]}})}
  const checks:DataCheck[]=fixed.map(([id,description,severity],index)=>{if((index===9||index===10)&&evidence===null)return createNotEvaluatedDataCheck(id,description,"review evidence was omitted");return createStructuredDataCheck(id,description,severity,findingsByCheck.get(id)!)});
  for(const rule of input.prepared.definition.definition.reviewRules){const matching=evaluations.filter((item)=>item.ruleId===rule.id);const status=matching.some((item)=>item.status==="triggered"&&item.severity==="fail")?"fail":matching.some((item)=>item.status==="triggered")?"warning":matching.some((item)=>item.status==="not-evaluated")?"not-evaluated":"pass";const findings=matching.filter((item)=>item.status==="triggered").map((item)=>({code:rule.code,message:rule.description,context:{ruleId:rule.id,reviewScope:item.reviewScope,sources:item.reviewScope.sources}}));checks.push({id:rule.id,description:rule.description,status,details:findings.slice(0,20).map((item)=>item.message),findings})}
  const report=freeze(summarizeDataChecks(checks));
  const identityBody=freeze({definitionIntegrity:input.prepared.definition.definitionIntegrity,preparationFingerprint:input.prepared.preparationFingerprint,evidence,checks:report.checks.map((check)=>({id:check.id,status:check.status,findings:check.findings})),summary:report.summary,evaluations});
  return freeze({report,evaluations,evidence,identityBody,reportFingerprint:`fnv1a64-jcs-v1:${fnv1a64(canonicalJson({identityVersion:1,kind:"diagnostic-review",review:identityBody}))}`});
}
