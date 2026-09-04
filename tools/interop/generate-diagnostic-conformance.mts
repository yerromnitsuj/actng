import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDiagnosticDefinition, type DiagnosticMeasureExpression, type DiagnosticRoleExpression } from "@actuarial-ts/core";
import { diagnosticDefinitionToDoc } from "@actuarial-ts/interchange";
import { buildRealWorldDiagnosticDefinition } from "../../examples/real-world-loss-run/src/main.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const outputDir=resolve(root,"interop/conformance/fixtures/diagnostics/generalized-casualty");
const compiled=compileDiagnosticDefinition(buildRealWorldDiagnosticDefinition());
const document=diagnosticDefinitionToDoc(compiled,{createdAt:"2026-09-03T00:00:00.000Z",generator:{name:"actuarial-ts-conformance",version:"0.2.0"}});
const values:Record<string,number|null>={reported:10,open:4,"closed-no-pay":2,"closed-with-pay":4,"insurance-years":100,"gross-paid":500,"gross-incurred":800,"net-paid":400,"net-incurred":600};

function measure(expression:DiagnosticMeasureExpression):number|null{
  if(expression.op==="measure"||expression.op==="claim-layer")return values[expression.measureId]??null;
  if(expression.op==="subtract"){const left=measure(expression.left),right=measure(expression.right);return left===null||right===null?null:left-right}
  const terms=expression.terms.map(measure);return terms.some((value)=>value===null)?null:(terms as number[]).reduce((sum,value)=>sum+value,0);
}
function role(expression:DiagnosticRoleExpression,roles:Readonly<Record<string,number|null>>):number|null{
  if(expression.op==="role")return roles[expression.role]??null;
  if(expression.op==="subtract"){const left=role(expression.left,roles),right=role(expression.right,roles);return left===null||right===null?null:left-right}
  const terms=expression.terms.map((term)=>role(term,roles));return terms.some((value)=>value===null)?null:(terms as number[]).reduce((sum,value)=>sum+value,0);
}
const expected=compiled.definition.instances.map((instance)=>{
  const formula=compiled.definition.formulas.find((item)=>item.id===instance.formulaId)!;
  const roles=Object.fromEntries(Object.entries(instance.bindings).map(([name,expression])=>[name,measure(expression)]));
  const numerator=role(formula.numerator,roles),denominator=role(formula.denominator,roles);
  return {instanceId:instance.id,numerator,denominator,value:numerator===null||denominator===null||denominator<=0?null:numerator/denominator};
});
await mkdir(outputDir,{recursive:true});
await writeFile(resolve(outputDir,"definition.json"),`${JSON.stringify(document,null,2)}\n`);
await writeFile(resolve(outputDir,"cell.json"),`${JSON.stringify({values,expected},null,2)}\n`);
