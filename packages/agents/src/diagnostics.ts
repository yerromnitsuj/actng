import { assertCompiledDiagnosticDefinition, type CompiledDiagnosticDefinition, type DiagnosticDeepReadonly } from "@actuarial-ts/core";
import { assertVerifiedDiagnosticRunProvenance, type VerifiedDiagnosticRunProvenance } from "@actuarial-ts/compliance";
import { z } from "zod";
import { AgentsError } from "./errors.js";
import { defineActuarialTool, type DefinedActuarialTool, type ToolEnvelopeFailure } from "./tools.js";

export const diagnosticAgentToolInputSchema = z.object({
  runPresetId:z.string().min(1),
  instanceIds:z.array(z.string().min(1)).min(1),
  view:z.enum(["emergence","triangles","latest-diagonal"]),
}).strict();
export type DiagnosticAgentToolInput=z.input<typeof diagnosticAgentToolInputSchema>;

export interface DiagnosticAgentRunPreset {
  readonly id:string;
  readonly definitionIntegrity:string;
  readonly allowedInstanceIds:readonly string[];
  readonly execute:(input:{readonly tenant:string;readonly instanceIds:readonly string[]})=>Promise<VerifiedDiagnosticRunProvenance>;
}
export interface CreateDiagnosticSelectionToolInput { readonly definition:CompiledDiagnosticDefinition;readonly presets:readonly DiagnosticAgentRunPreset[];readonly id?:string;readonly description?:string;readonly tenantContextKey?:string }
export type DiagnosticAgentDisplayProjection=
  | {readonly view:"emergence";readonly value:VerifiedDiagnosticRunProvenance["result"]["emergence"]}
  | {readonly view:"triangles";readonly value:VerifiedDiagnosticRunProvenance["result"]["triangles"]}
  | {readonly view:"latest-diagonal";readonly value:VerifiedDiagnosticRunProvenance["result"]["latestDiagonal"]};
export type DiagnosticAgentDisplayPoint=
  | VerifiedDiagnosticRunProvenance["result"]["emergence"][number]
  | VerifiedDiagnosticRunProvenance["result"]["triangles"][number]
  | VerifiedDiagnosticRunProvenance["result"]["latestDiagonal"][number];
export interface DiagnosticAgentToolSuccess {
  readonly success:true;readonly runPresetId:string;readonly instanceIds:readonly string[];
  readonly definitionIntegrity:string;readonly formulaFingerprints:Readonly<Record<string,string>>;
  readonly calculationFingerprints:Readonly<Record<string,string>>;readonly runFingerprint:string;
  readonly resultFingerprint:string;readonly runResultFingerprint:string;
  readonly review:VerifiedDiagnosticRunProvenance["review"];readonly display:DiagnosticAgentDisplayProjection;
}
export type DiagnosticAgentToolResult=DiagnosticDeepReadonly<DiagnosticAgentToolSuccess>|ToolEnvelopeFailure;

const toolFailureSchema=z.object({success:z.literal(false),error:z.object({code:z.string(),message:z.string()}).strict()}).strict();
const displaySchema=z.discriminatedUnion("view",[
  z.object({view:z.literal("emergence"),value:z.custom<Extract<DiagnosticAgentDisplayProjection,{readonly view:"emergence"}>["value"]>()}).strict(),
  z.object({view:z.literal("triangles"),value:z.custom<Extract<DiagnosticAgentDisplayProjection,{readonly view:"triangles"}>["value"]>()}).strict(),
  z.object({view:z.literal("latest-diagonal"),value:z.custom<Extract<DiagnosticAgentDisplayProjection,{readonly view:"latest-diagonal"}>["value"]>()}).strict(),
]);
const toolSuccessSchema=z.object({
  success:z.literal(true),runPresetId:z.string(),instanceIds:z.array(z.string()),definitionIntegrity:z.string(),
  formulaFingerprints:z.record(z.string()),calculationFingerprints:z.record(z.string()),runFingerprint:z.string(),
  resultFingerprint:z.string(),runResultFingerprint:z.string(),review:z.custom<VerifiedDiagnosticRunProvenance["review"]>(),
  display:displaySchema,
}).strict();
/** Strict model-visible output schema, including the wrapper's failure branch. */
export const diagnosticAgentToolResultSchema:z.ZodType<DiagnosticAgentToolResult>=z.union([toolSuccessSchema,toolFailureSchema]);
export type DiagnosticSelectionTool=DefinedActuarialTool<DiagnosticAgentToolInput,DiagnosticAgentToolResult>;

function token(value:string,label:string):void{if(value.length===0||/^[\t-\r ]|[\t-\r ]$/.test(value)||value.includes("\0"))throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`${label} must be a nonempty token`)}
function sortUniqueRequested(values:readonly string[]):string[]{const result=[...new Set(values)];result.sort((a,b)=>a<b?-1:a>b?1:0);return result}

export function createDiagnosticSelectionTool(input:CreateDiagnosticSelectionToolInput):DiagnosticSelectionTool{
  try{assertCompiledDiagnosticDefinition(input.definition)}catch{throw new AgentsError("BAD_DIAGNOSTIC_CATALOG","definition must be an authentic compiled diagnostic definition")}
  const id=input.id??"run_diagnostic_selection";const description=input.description??"Run a host-approved diagnostic preset for selected registered metric instances.";const tenantKey=input.tenantContextKey??"projectId";
  token(id,"tool id");token(tenantKey,"tenant context key");if(description.trim().length===0)throw new AgentsError("BAD_DIAGNOSTIC_CATALOG","description must be nonblank");if(input.presets.length===0)throw new AgentsError("BAD_DIAGNOSTIC_CATALOG","at least one approved diagnostic preset is required");
  const known=new Set(input.definition.definition.instances.map((item)=>item.id));const catalog=new Map<string,{definitionIntegrity:string;allowedInstanceIds:readonly string[];execute:DiagnosticAgentRunPreset["execute"]}>();
  for(const preset of input.presets){token(preset.id,"preset id");if(catalog.has(preset.id))throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`duplicate preset ${preset.id}`);if(preset.definitionIntegrity!==input.definition.definitionIntegrity)throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`preset ${preset.id} targets another definition`);if(typeof preset.execute!=="function")throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`preset ${preset.id} has no executor`);const seen=new Set<string>();for(const instanceId of preset.allowedInstanceIds){token(instanceId,"allowed instance id");if(seen.has(instanceId))throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`preset ${preset.id} repeats ${instanceId}`);if(!known.has(instanceId))throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`preset ${preset.id} references unknown instance ${instanceId}`);seen.add(instanceId)}if(seen.size===0)throw new AgentsError("BAD_DIAGNOSTIC_CATALOG",`preset ${preset.id} has no allowed instances`);catalog.set(preset.id,Object.freeze({definitionIntegrity:preset.definitionIntegrity,allowedInstanceIds:Object.freeze([...seen].sort()),execute:preset.execute}))}
  return defineActuarialTool({id,description,kind:"read",tenant:"required",tenantKey,inputSchema:diagnosticAgentToolInputSchema,outputSchema:diagnosticAgentToolResultSchema,execute:async(raw,tenant):Promise<DiagnosticAgentToolSuccess>=>{
    const preset=catalog.get(raw.runPresetId);if(!preset)throw new AgentsError("UNKNOWN_DIAGNOSTIC_PRESET",`Unknown diagnostic preset ${raw.runPresetId}`);const selected=sortUniqueRequested(raw.instanceIds);if(selected.some((item)=>!preset.allowedInstanceIds.includes(item)))throw new AgentsError("UNAPPROVED_DIAGNOSTIC_INSTANCE","One or more diagnostic instances are not approved by the selected preset");
    const provenance=await preset.execute({tenant,instanceIds:selected});try{assertVerifiedDiagnosticRunProvenance(provenance)}catch{throw new AgentsError("DIAGNOSTIC_RUN_MISMATCH","Preset executor returned unauthenticated diagnostic provenance")}
    const filter=provenance.manifest.preparation.filter;if(provenance.definitionIdentities.definition!==input.definition.definitionIntegrity||provenance.manifest.runPresetId!==raw.runPresetId||!filter||JSON.stringify(filter.instanceIds??[])!==JSON.stringify(selected))throw new AgentsError("DIAGNOSTIC_RUN_MISMATCH","Verified run does not match the selected definition, preset, and exact instance set");
    const instances=input.definition.definition.instances.filter((item)=>selected.includes(item.id));const formulaIds=[...new Set(instances.map((item)=>item.formulaId))].sort();const formulaFingerprints=Object.fromEntries(formulaIds.map((formulaId)=>[formulaId,provenance.definitionIdentities.formulaById[formulaId]!]));const calculationFingerprints=Object.fromEntries(selected.map((instanceId)=>[instanceId,provenance.definitionIdentities.calculationByInstanceId[instanceId]!]));
    const display=raw.view==="emergence"?{view:"emergence" as const,value:provenance.result.emergence}:raw.view==="triangles"?{view:"triangles" as const,value:provenance.result.triangles}:{view:"latest-diagonal" as const,value:provenance.result.latestDiagonal};
    return {success:true,runPresetId:raw.runPresetId,instanceIds:selected,definitionIntegrity:provenance.definitionIdentities.definition,formulaFingerprints,calculationFingerprints,runFingerprint:provenance.runFingerprint,resultFingerprint:provenance.resultFingerprint,runResultFingerprint:provenance.runResultFingerprint,review:provenance.review,display};
  }});
}
