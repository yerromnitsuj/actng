import {
  CORE_PACKAGE_VERSION,
  canonicalJson,
  fnv1a64,
  getMetricDiagnosticsResultIdentity,
  getPreparedDiagnosticDataIdentity,
  runMetricDiagnostics,
  verifyPreparedDiagnosticDataIntegrity,
  type DiagnosticDeepReadonly,
  type CompiledDiagnosticDefinition,
  type JsonValue as CoreDiagnosticJsonValue,
  type NormalizedDiagnosticDefinitionIdentity,
  type NormalizedDiagnosticPreparationIdentity,
  type NormalizedDiagnosticResultIdentity,
} from "@actuarial-ts/core";
import {
  DATA_PACKAGE_VERSION,
  assertCompletedValidatedMetricDiagnosticsRun,
  reviewPreparedDiagnosticData,
  type CompletedValidatedMetricDiagnosticsRun,
  type DiagnosticReviewIdentityBody,
  type DiagnosticReviewReceipt,
} from "@actuarial-ts/data";
import { ComplianceError } from "./errors.js";
import { COMPLIANCE_PACKAGE_VERSION } from "./version.js";

export interface DiagnosticArtifactDigestBase { readonly id: string; readonly scope: "input" | "preparation"; readonly algorithm: string; readonly value: string; readonly byteLength: number }
export type DiagnosticArtifactDigest = DiagnosticArtifactDigestBase & { readonly assurance: "sdk-computed" | "caller-declared" };
export type DiagnosticArtifactEvidence =
  | { readonly id: string; readonly scope: "input" | "preparation"; readonly assurance: "sdk-computed"; readonly bytes: Uint8Array }
  | { readonly id: string; readonly scope: "input" | "preparation"; readonly assurance: "caller-declared"; readonly algorithm: string; readonly value: string; readonly byteLength: number };
export interface DiagnosticPreparationLineage { readonly artifactId: string; readonly inputArtifactIds: readonly string[] }

export interface DiagnosticRunManifest {
  readonly definitionIntegrity: string;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly packageVersions: Readonly<Record<string, string>>;
  readonly preparation: DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity>;
  readonly preparationFingerprint: string;
  readonly expectedGridFingerprint: string | null;
  readonly executionPolicy: { readonly review: { readonly body: DiagnosticReviewIdentityBody; readonly reportFingerprint: string }; readonly gate: CompletedValidatedMetricDiagnosticsRun["gate"] };
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, CoreDiagnosticJsonValue>>;
  readonly artifacts: readonly DiagnosticArtifactDigest[];
  readonly lineage: readonly DiagnosticPreparationLineage[];
}
export type NormalizedDiagnosticRunManifestIdentity = DiagnosticDeepReadonly<DiagnosticRunManifest>;

export interface DiagnosticRunIdentity {
  readonly runFingerprint: string;
  readonly resultFingerprint: string;
  readonly runResultFingerprint: string;
}
export interface DiagnosticRunProvenance extends DiagnosticRunIdentity {
  readonly definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>;
  readonly definitionIdentities: { readonly algorithm: "fnv1a64-jcs-v1"; readonly formulaById: Readonly<Record<string,string>>; readonly calculationByInstanceId: Readonly<Record<string,string>>; readonly definition: string };
  readonly manifest: NormalizedDiagnosticRunManifestIdentity;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<NormalizedDiagnosticResultIdentity>;
}
declare const verifiedDiagnosticRunProvenanceBrand: unique symbol;
export interface VerifiedDiagnosticRunProvenance extends DiagnosticRunProvenance { readonly [verifiedDiagnosticRunProvenanceBrand]: true }
export interface CreateDiagnosticRunIdentityInput { readonly completedRun: CompletedValidatedMetricDiagnosticsRun; readonly artifacts?: readonly DiagnosticArtifactEvidence[]; readonly lineage?: readonly DiagnosticPreparationLineage[] }

const verified = new WeakMap<object, CompletedValidatedMetricDiagnosticsRun>();
const token = (value:string,path:string) => {
  if (value.length === 0 || /^[\t-\r ]|[\t-\r ]$/.test(value) || value.includes("\0")) throw new ComplianceError("BAD_DIAGNOSTIC_RUN", `${path} must be a nonempty token`, path);
  for(let index=0;index<value.length;index++){const unit=value.charCodeAt(index);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(index+1);if(!(next>=0xdc00&&next<=0xdfff))throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`${path} contains malformed Unicode`,path);index++}else if(unit>=0xdc00&&unit<=0xdfff)throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`${path} contains malformed Unicode`,path)}
};
function freeze<T>(value:T,seen=new WeakSet<object>()):DiagnosticDeepReadonly<T>{if(value===null||typeof value!=="object"||seen.has(value))return value as DiagnosticDeepReadonly<T>;seen.add(value);for(const child of Object.values(value as Record<string,unknown>))freeze(child,seen);return Object.freeze(value) as DiagnosticDeepReadonly<T>}
function tag(kind:string,key:string,value:unknown):string{return `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({identityVersion:1,kind,[key]:value}))}`}
type SnapshottedArtifact=DiagnosticArtifactDigest|{readonly id:string;readonly scope:"input"|"preparation";readonly assurance:"sdk-computed";readonly bytes:Uint8Array};
function snapshotArtifacts(evidence:readonly DiagnosticArtifactEvidence[]):readonly SnapshottedArtifact[]{
  const seen=new Set<string>();const result:SnapshottedArtifact[]=[];
  for(const [index,item] of evidence.entries()){
    token(item.id,`$.artifacts[${index}].id`);token(item.scope,`$.artifacts[${index}].scope`);if(seen.has(item.id))throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Duplicate artifact ID ${item.id}`,`$.artifacts[${index}].id`);seen.add(item.id);
    if(item.assurance==="sdk-computed"){
      if(!(item.bytes instanceof Uint8Array))throw new ComplianceError("BAD_DIAGNOSTIC_RUN","SDK-computed artifact evidence requires actual Uint8Array bytes",`$.artifacts[${index}].bytes`);
      const bytes=new Uint8Array(item.bytes.byteLength);bytes.set(item.bytes);result.push({id:item.id,scope:item.scope,assurance:item.assurance,bytes});
    }else{token(item.algorithm,`$.artifacts[${index}].algorithm`);token(item.value,`$.artifacts[${index}].value`);if(!Number.isSafeInteger(item.byteLength)||item.byteLength<0)throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Artifact byteLength must be a nonnegative safe integer",`$.artifacts[${index}].byteLength`);result.push({...item})}
  }
  return result.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
async function digestArtifacts(snapshot:readonly SnapshottedArtifact[]):Promise<readonly DiagnosticArtifactDigest[]>{
  if(snapshot.some((item)=>"bytes" in item)&&globalThis.crypto?.subtle===undefined)throw new ComplianceError("CRYPTO_UNAVAILABLE","Web Crypto SHA-256 is unavailable","$.artifacts");
  return Promise.all(snapshot.map(async(item)=>{if(!("bytes" in item))return item;const hash=await globalThis.crypto.subtle.digest("SHA-256",item.bytes);return {id:item.id,scope:item.scope,assurance:item.assurance,algorithm:"sha-256",value:[...new Uint8Array(hash)].map((b)=>b.toString(16).padStart(2,"0")).join(""),byteLength:item.bytes.byteLength}}));
}

function snapshotLineage(lineage:readonly DiagnosticPreparationLineage[]):readonly DiagnosticPreparationLineage[]{
  return lineage.map((item,index)=>{token(item.artifactId,`$.lineage[${index}].artifactId`);if(!Array.isArray(item.inputArtifactIds))throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Lineage inputs must be an array",`$.lineage[${index}].inputArtifactIds`);const inputs=item.inputArtifactIds.map((id,inputIndex)=>{token(id,`$.lineage[${index}].inputArtifactIds[${inputIndex}]`);return id});if(new Set(inputs).size!==inputs.length)throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Lineage inputs must be unique",`$.lineage[${index}].inputArtifactIds`);return {artifactId:item.artifactId,inputArtifactIds:[...inputs].sort()}}).sort((a,b)=>a.artifactId<b.artifactId?-1:a.artifactId>b.artifactId?1:0);
}

function validateArtifactGraph(run:CompletedValidatedMetricDiagnosticsRun,artifacts:readonly DiagnosticArtifactDigest[],lineage:readonly DiagnosticPreparationLineage[]):void{
  const byId=new Map(artifacts.map((item)=>[item.id,item]));
  const referenced=new Set<string>();
  const requireArtifact=(id:string,scope:"input"|"preparation",path:string)=>{const artifact=byId.get(id);if(!artifact)throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Artifact reference ${id} is unresolved`,path);if(artifact.scope!==scope)throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Artifact ${id} must have ${scope} scope`,path);referenced.add(id)};
  let unsourced=false;
  for(const [index,item] of run.prepared.inputAudit.entries()){const source=item.record.source;if(source)requireArtifact(source.artifactId,"input",`$.completedRun.prepared.inputAudit[${index}].record.source.artifactId`);else unsourced=true}
  const evidence=run.review.evidence;
  if(evidence){for(const [index,item] of evidence.groupingAssignments.entries()){if(item.source)requireArtifact(item.source.artifactId,"input",`$.completedRun.review.evidence.groupingAssignments[${index}].source.artifactId`);else unsourced=true}for(const [index,item] of evidence.cachedFormulas.entries()){if(item.source)requireArtifact(item.source.artifactId,"input",`$.completedRun.review.evidence.cachedFormulas[${index}].source.artifactId`);else unsourced=true}}
  if(unsourced){if(run.datasetArtifactId===null)throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Unsourced diagnostic input requires datasetArtifactId","$.completedRun.datasetArtifactId");const fallback=byId.get(run.datasetArtifactId);if(!fallback||fallback.scope!=="input"||fallback.assurance!=="sdk-computed")throw new ComplianceError("BAD_DIAGNOSTIC_RUN","datasetArtifactId must resolve to SDK-computed input evidence","$.completedRun.datasetArtifactId");referenced.add(run.datasetArtifactId)}
  else if(run.datasetArtifactId!==null)requireArtifact(run.datasetArtifactId,"input","$.completedRun.datasetArtifactId");
  for(const [basisIndex,basis] of run.prepared.definition.definition.amountBases.entries())for(const [componentIndex,component] of basis.components.entries())if(component.limitation.kind!=="unlimited"&&component.limitation.kind!=="unknown"&&component.limitation.derivation.kind==="external")requireArtifact(component.limitation.derivation.transformationRef,"preparation",`$.definition.amountBases[${basisIndex}].components[${componentIndex}].limitation.derivation.transformationRef`);
  for(const [ruleIndex,rule] of run.prepared.definition.definition.reviewRules.entries())if(rule.kind==="layer-order"&&rule.comparability.kind==="caller-asserted")requireArtifact(rule.comparability.rationaleArtifactId,"preparation",`$.definition.reviewRules[${ruleIndex}].comparability.rationaleArtifactId`);
  if(run.gate.rationaleRef!==null)requireArtifact(run.gate.rationaleRef,"preparation","$.completedRun.gate.rationaleRef");
  const edges=new Map<string,readonly string[]>();for(const [index,edge] of lineage.entries()){if(edges.has(edge.artifactId))throw new ComplianceError("BAD_DIAGNOSTIC_RUN","An artifact may have only one producing lineage edge",`$.lineage[${index}].artifactId`);const downstream=byId.get(edge.artifactId);if(!downstream)throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Lineage artifact ${edge.artifactId} is unresolved`,`$.lineage[${index}].artifactId`);if(downstream.scope!=="input")throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Lineage downstream artifact must have input scope",`$.lineage[${index}].artifactId`);for(const [inputIndex,id] of edge.inputArtifactIds.entries()){if(id===edge.artifactId)throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Lineage may not reference itself",`$.lineage[${index}].inputArtifactIds[${inputIndex}]`);if(!byId.has(id))throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Lineage reference ${id} is unresolved`,`$.lineage[${index}].inputArtifactIds[${inputIndex}]`)}edges.set(edge.artifactId,edge.inputArtifactIds)}
  const visiting=new Set<string>(),visited=new Set<string>();const walk=(id:string,path:string)=>{if(visiting.has(id))throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Artifact lineage contains a cycle",path);if(visited.has(id))return;visiting.add(id);for(const upstream of edges.get(id)??[]){referenced.add(upstream);walk(upstream,path)}visiting.delete(id);visited.add(id)};for(const id of [...referenced])walk(id,"$.lineage");
  for(const [index,artifact] of artifacts.entries())if(!referenced.has(artifact.id))throw new ComplianceError("BAD_DIAGNOSTIC_RUN",`Artifact ${artifact.id} is orphaned`, `$.artifacts[${index}].id`);
}

function rerunAndVerify(run:CompletedValidatedMetricDiagnosticsRun):{review:DiagnosticReviewReceipt;result:DiagnosticDeepReadonly<NormalizedDiagnosticResultIdentity>}{
  assertCompletedValidatedMetricDiagnosticsRun(run);verifyPreparedDiagnosticDataIntegrity(run.prepared);
  const review=reviewPreparedDiagnosticData({prepared:run.prepared,evidence:run.review.evidence});
  if(review.reportFingerprint!==run.review.reportFingerprint||canonicalJson(review.identityBody)!==canonicalJson(run.review.identityBody))throw new ComplianceError("DIAGNOSTIC_MISMATCH","Stored diagnostic review does not match a regenerated review","$.review");
  const rerun=runMetricDiagnostics({prepared:run.prepared,groupMap:run.groupMap,groupDimensions:run.groupDimensions});
  if(canonicalJson(getMetricDiagnosticsResultIdentity(rerun))!==canonicalJson(getMetricDiagnosticsResultIdentity(run.result)))throw new ComplianceError("DIAGNOSTIC_MISMATCH","Stored diagnostic result does not match deterministic replay","$.result");
  const reviewBlocked=review.report.checks.some((check)=>!run.gate.allowedReviewStatuses.includes(check.status));
  const metricBlocked=rerun.findings.some((finding)=>finding.category!=="structural"&&!run.gate.allowedMetricFindingSeverities.includes(finding.severity));
  if(reviewBlocked||metricBlocked||run.gate.reviewGate!=="passed"||run.gate.metricGate!=="passed")throw new ComplianceError("DIAGNOSTIC_MISMATCH","Diagnostic execution gates do not recompute as passed","$.gate");
  return {review,result:getMetricDiagnosticsResultIdentity(run.result)};
}

export async function createDiagnosticRunIdentity(input:CreateDiagnosticRunIdentityInput):Promise<VerifiedDiagnosticRunProvenance>{
  const run=input.completedRun;const authenticated=rerunAndVerify(run);const artifactSnapshot=snapshotArtifacts(input.artifacts??[]);const lineage=snapshotLineage(input.lineage??[]);const artifacts=await digestArtifacts(artifactSnapshot);validateArtifactGraph(run,artifacts,lineage);
  const preparation=getPreparedDiagnosticDataIdentity(run.prepared);
  const expectedGridFingerprint=preparation.expectedCellsProvided?tag("diagnostic-expected-grid","expectedCells",preparation.expectedCells):null;
  const manifest=freeze({definitionIntegrity:run.prepared.definition.definitionIntegrity,runPresetId:run.runPresetId,datasetArtifactId:run.datasetArtifactId,packageVersions:{"@actuarial-ts/core":CORE_PACKAGE_VERSION,"@actuarial-ts/data":DATA_PACKAGE_VERSION,"@actuarial-ts/compliance":COMPLIANCE_PACKAGE_VERSION},preparation,preparationFingerprint:run.prepared.preparationFingerprint,expectedGridFingerprint,executionPolicy:{review:{body:authenticated.review.identityBody,reportFingerprint:authenticated.review.reportFingerprint},gate:run.gate},groupMap:{...run.groupMap},groupDimensions:{...run.groupDimensions},artifacts,lineage});
  const runFingerprint=tag("diagnostic-run","run",manifest);const resultFingerprint=tag("diagnostic-result","result",authenticated.result);const runResultFingerprint=tag("diagnostic-run-result","binding",{runFingerprint,resultFingerprint});
  const definition=run.prepared.definition;
  const provenance=freeze({definition:definition.definition,definitionIdentities:{algorithm:"fnv1a64-jcs-v1" as const,formulaById:{...definition.formulaFingerprints},calculationByInstanceId:{...definition.calculationFingerprints},definition:definition.definitionIntegrity},manifest,review:authenticated.review,result:run.result,runFingerprint,resultFingerprint,runResultFingerprint}) as unknown as VerifiedDiagnosticRunProvenance;
  verified.set(provenance,run);return provenance;
}

export function assertVerifiedDiagnosticRunProvenance(value:unknown):asserts value is VerifiedDiagnosticRunProvenance{if(value===null||typeof value!=="object"||!verified.has(value))throw new ComplianceError("BAD_DIAGNOSTIC_RUN","Value is not authentic verified diagnostic provenance","$")}

/** @internal Bundle authoring uses owner state rather than trusting the public snapshot. */
export function verifiedDefinitionForBundle(value:VerifiedDiagnosticRunProvenance):CompiledDiagnosticDefinition{assertVerifiedDiagnosticRunProvenance(value);return verified.get(value)!.prepared.definition}

export async function verifyDiagnosticRunIdentity(candidate:unknown,input:CreateDiagnosticRunIdentityInput):Promise<VerifiedDiagnosticRunProvenance>{
  const regenerated=await createDiagnosticRunIdentity(input);
  let left:string;try{left=canonicalJson(candidate)}catch{throw new ComplianceError("DIAGNOSTIC_MISMATCH","Stored diagnostic provenance is not canonical JSON","$")}
  if(left!==canonicalJson(regenerated))throw new ComplianceError("DIAGNOSTIC_MISMATCH","Stored diagnostic provenance differs from regenerated provenance",firstDifference(candidate,regenerated,"$")??"$");
  return regenerated;
}

function plain(value:unknown):value is Record<string,unknown>{if(value===null||typeof value!=="object"||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null}
function firstDifference(left:unknown,right:unknown,path:string):string|null{if(plain(left)&&plain(right)){const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();for(const key of keys){if(!(key in left)||!(key in right))return `${path}.${key}`;const found=firstDifference(left[key],right[key],`${path}.${key}`);if(found)return found}return null}if(Array.isArray(left)&&Array.isArray(right)){const shared=Math.min(left.length,right.length);for(let index=0;index<shared;index++){const found=firstDifference(left[index],right[index],`${path}[${index}]`);if(found)return found}return left.length===right.length?null:`${path}[${shared}]`}try{return canonicalJson(left)===canonicalJson(right)?null:path}catch{return path}}
