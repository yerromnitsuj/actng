import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace=fileURLToPath(new URL("..",import.meta.url));
const cli=resolve(workspace,"../../node_modules/tsx/dist/cli.mjs");
const entry=resolve(workspace,"src/main.ts");
const run=()=>spawnSync(process.execPath,[cli,entry,"--format=canonical-json"],{cwd:workspace,env:{...process.env,TZ:"UTC"},encoding:null,maxBuffer:256*1024*1024});
const first=run(),second=run();
for(const [index,result] of [first,second].entries()){
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`determinism run ${index+1} exited ${result.status}: ${result.stderr?.toString("utf8")??""}`);
  if((result.stderr?.byteLength??0)>0)throw new Error(`determinism run ${index+1} wrote stderr: ${result.stderr!.toString("utf8")}`);
}
if(!first.stdout?.equals(second.stdout!))throw new Error("canonical diagnostic example differs across fresh processes");
process.stdout.write(`real-world determinism: ${first.stdout.byteLength} byte canonical outcomes match\n`);
