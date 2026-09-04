import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SDK_PACKAGES=["core","interchange","data","compliance","agents"];
const INTERNAL=new Set(SDK_PACKAGES.map((name)=>`@actuarial-ts/${name}`));
const read=(root,path)=>readFileSync(resolve(root,path),"utf8");
const json=(root,path)=>JSON.parse(read(root,path));
const literal=(text,name)=>text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`))?.[1]??null;

export function checkVersionSync(root){
  const errors=[];
  const manifests=Object.fromEntries(SDK_PACKAGES.map((name)=>[name,json(root,`packages/${name}/package.json`)]));
  const version=manifests.core.version;
  for(const name of SDK_PACKAGES){const manifest=manifests[name];if(manifest.version!==version)errors.push(`${name} version ${manifest.version} != ${version}`);for(const section of ["dependencies","devDependencies","peerDependencies"]){for(const [dependency,range] of Object.entries(manifest[section]??{}))if(INTERNAL.has(dependency)&&range!==`^${version}`)errors.push(`${name} ${section}.${dependency} must be ^${version}; got ${range}`)}}
  if(version!=="0.6.0")errors.push(`release version must be 0.6.0; got ${version}`);
  for(const name of ["core","interchange","data","compliance"])if(manifests[name].engines?.node!==">=20")errors.push(`${name} engines.node must be >=20`);
  if(manifests.agents.engines?.node!==">=22.13.0")errors.push("agents engines.node must be >=22.13.0");
  const rootManifest=json(root,"package.json");if(rootManifest.version!=="0.0.0")errors.push("private root version must remain 0.0.0");if(rootManifest.engines?.node!==">=22.13.0")errors.push("root engines.node must be >=22.13.0");
  for(const [name,expected] of [["@mastra/core",">=1.51.0 <2"],["@mastra/mcp",">=1.14.0 <2"],["zod","^3.25.76"]])if(manifests.agents.peerDependencies?.[name]!==expected)errors.push(`agents peer ${name} must be ${expected}`);
  const constants=[
    ["packages/core/src/version.ts","CORE_PACKAGE_VERSION"],
    ["packages/data/src/version.ts","DATA_PACKAGE_VERSION"],
    ["packages/interchange/src/envelope.ts","INTERCHANGE_PACKAGE_VERSION"],
    ["packages/compliance/src/version.ts","COMPLIANCE_PACKAGE_VERSION"],
  ];
  for(const [path,name] of constants){const actual=literal(read(root,path),name);if(actual!==version)errors.push(`${name} must be ${version}; got ${actual}`)}
  const envelope=read(root,"packages/interchange/src/envelope.ts");if(literal(envelope,"INTERCHANGE_SPEC_VERSION")!=="1.1.0")errors.push("TypeScript wire writer must be 1.1.0");
  const pyproject=read(root,"interop/python/pyproject.toml");if(!/^version\s*=\s*"0\.2\.0"/m.test(pyproject))errors.push("Python adapter version must be 0.2.0");if(!/^requires-python\s*=\s*">=3\.10"/m.test(pyproject))errors.push("Python support floor must be >=3.10");
  const python=read(root,"interop/python/actuarial_interchange/documents.py");if(!/^SPEC_VERSION\s*=\s*"1\.1\.0"/m.test(python)||!/^GENERATOR_VERSION\s*=\s*"0\.2\.0"/m.test(python))errors.push("Python writer/generator stamps must be 1.1.0/0.2.0");
  const r=read(root,"tools/interop/actuarialInterchange.R");if(!/interchangeVersion\s*=\s*"1\.1\.0"/.test(r)||!/version\s*=\s*"0\.2\.0"/.test(r))errors.push("R writer/generator stamps must be 1.1.0/0.2.0");
  const rEnvironment=json(root,"tools/interop/r-environment.json");if(rEnvironment.rVersion!=="4.4.3"||rEnvironment.transitivePackages?.Deriv!=="4.3.0"||rEnvironment.packages?.ChainLadder!=="0.2.21"||rEnvironment.packages?.jsonlite!=="2.0.0")errors.push("R environment must be 4.4.3 / Deriv 4.3.0 / ChainLadder 0.2.21 / jsonlite 2.0.0");
  const schemaDir=resolve(root,"schema/interchange/1.1");if(!existsSync(schemaDir)||!readdirSync(schemaDir).includes("diagnostic-definition.schema.json"))errors.push("schema/interchange/1.1 is incomplete");
  const lock=json(root,"package-lock.json");for(const name of SDK_PACKAGES){const entry=lock.packages?.[`packages/${name}`];if(entry?.version!==version)errors.push(`package-lock packages/${name} must be ${version}`)}
  for(const name of SDK_PACKAGES){const readme=read(root,`packages/${name}/README.md`);for(const target of ["diagnostic-formulas.md","0.6-generalized-diagnostics.md"]){const expected=`github.com/yerromnitsuj/actng/blob/v${version}/docs/`;if(!readme.includes(expected)||!readme.includes(target))errors.push(`${name} README must link ${target} at tag v${version}`)}}
  return errors;
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));const errors=checkVersionSync(root);if(errors.length){for(const error of errors)console.error(`version-sync: ${error}`);process.exitCode=1}else console.log("version-sync: SDK 0.6.0, wire 1.1.0, and adapter 0.2.0 stamps agree")}
