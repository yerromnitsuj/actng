import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ALL_PACKAGES = ["core", "interchange", "data", "compliance", "agents"];
export const RUNTIME_FOUR = ALL_PACKAGES.slice(0, 4);
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REQUIRED_TARBALL_FILES = [
  "package/package.json", "package/README.md", "package/LICENSE", "package/NOTICE",
  "package/dist/index.js", "package/dist/index.d.ts", "package/src/index.ts",
];

export function packageSet(name) {
  if (name === "all-five") return ALL_PACKAGES;
  if (name === "runtime-four") return RUNTIME_FOUR;
  throw new Error(`unknown package set ${name}`);
}

export function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`unexpected argument ${value}`);
    const equals = value.indexOf("=");
    if (equals >= 0) result[value.slice(0, equals)] = value.slice(equals + 1);
    else if (["--pack-only"].includes(value)) result[value] = true;
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
      result[value] = next;
      index += 1;
    }
  }
  return result;
}

export function peerFloor(range) {
  if (typeof range !== "string") throw new Error("peer range must be a string");
  const match = range.trim().match(/^(?:\^|~|>=\s*)?(\d+)\.(\d+)\.(\d+)(?:\s+<.*)?$/);
  if (!match) throw new Error(`peer range has no concrete lower bound: ${range}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`expected an exact semantic version, got ${version}`);
  return match.slice(1).map(Number);
}
function compareVersion(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}
export function satisfiesRange(version, range) {
  parseVersion(version);
  const value = range.trim();
  if (value.startsWith("^")) {
    const floor = peerFloor(value); const [major, minor, patch] = parseVersion(floor);
    const upper = major > 0 ? `${major + 1}.0.0` : minor > 0 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
    return compareVersion(version, floor) >= 0 && compareVersion(version, upper) < 0;
  }
  const bounds = [...value.matchAll(/(>=|>|<=|<)\s*(\d+(?:\.\d+){0,2})/g)];
  if (!bounds.length) return compareVersion(version, value) === 0;
  return bounds.every(([, operator, rawBound]) => {
    const bound = rawBound.split(".").concat(["0", "0"]).slice(0, 3).join(".");
    const compared = compareVersion(version, bound);
    return operator === ">=" ? compared >= 0 : operator === ">" ? compared > 0 : operator === "<=" ? compared <= 0 : compared < 0;
  });
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const strictKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} has missing or unknown fields`);
};

export function validateHandoffManifest(manifest, directory, setName, requiredNodeMajor = null) {
  strictKeys(manifest, ["schemaVersion", "packageSet", "tarballs", "externalDependencies"], "handoff manifest");
  if (manifest.schemaVersion !== 1 || manifest.packageSet !== setName || !Array.isArray(manifest.tarballs)) throw new Error("invalid handoff manifest identity");
  const selected = packageSet(setName);
  if (setName !== "runtime-four") throw new Error("manifest handoff is reserved for runtime-four");
  if (requiredNodeMajor !== null && Number(process.versions.node.split(".")[0]) !== Number(requiredNodeMajor)) throw new Error(`requires Node major ${requiredNodeMajor}`);
  const expectedNames = selected.map((name) => `@actuarial-ts/${name}`);
  if (manifest.tarballs.length !== expectedNames.length) throw new Error("handoff manifest has a missing or extra package");
  for (const [index, item] of manifest.tarballs.entries()) {
    strictKeys(item, ["name", "version", "filename", "sha256"], `tarball ${index}`);
    if (item.name !== expectedNames[index]) throw new Error("handoff manifest package ordering mismatch");
    if (!/^actuarial-ts-[a-z-]+-\d+\.\d+\.\d+\.tgz$/.test(item.filename)) throw new Error(`unsafe tarball filename ${item.filename}`);
    const path = join(directory, item.filename);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing handoff tarball ${item.filename}`);
    if (sha256(path) !== item.sha256) throw new Error(`tampered handoff tarball ${item.filename}`);
  }
  const actualTarballs = readdirSync(directory).filter((name) => name.endsWith(".tgz")).sort();
  const expectedTarballs = manifest.tarballs.map((item) => item.filename).sort();
  if (actualTarballs.join("\0") !== expectedTarballs.join("\0")) throw new Error("handoff directory has extra or missing tarballs");
  strictKeys(manifest.externalDependencies, ["zod"], "handoff dependencies");
  if (!/^zod@\d+\.\d+\.\d+$/.test(manifest.externalDependencies.zod)) throw new Error("handoff has an invalid Zod coordinate");
  return manifest;
}

function markdownLinks(readme) {
  return [...readme.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim().replace(/^<|>$/g, ""));
}
export function validatePackedReadme(unpackedPackage) {
  const readmePath = join(unpackedPackage, "README.md");
  for (const destination of markdownLinks(readFileSync(readmePath, "utf8"))) {
    if (/^(?:https?:|mailto:|#)/.test(destination)) continue;
    const clean = decodeURIComponent(destination.split(/[?#]/)[0]);
    const target = normalize(join(unpackedPackage, clean));
    if (!target.startsWith(`${normalize(unpackedPackage)}${sep}`) || !existsSync(target)) throw new Error(`packed README has unavailable relative link: ${destination}`);
  }
}

function inspectTarball(path, record, scratch) {
  const files = execFileSync("tar", ["-tf", path], { encoding: "utf8" }).trim().split("\n");
  for (const required of REQUIRED_TARBALL_FILES) if (!files.includes(required)) throw new Error(`${record.filename} misses ${required}`);
  if (files.some((file) => /(^|\/)(test|tests|\.cache|docs\/superpowers|data\/source-cache)(\/|$)|\.rda$|\.tgz$|\.env(?:\.|$)/.test(file))) throw new Error(`${record.filename} contains excluded development content`);
  const unpack = join(scratch, `unpack-${record.name.replaceAll("/", "-")}`); mkdirSync(unpack);
  execFileSync("tar", ["-xzf", path, "-C", unpack]);
  const manifest = readJson(join(unpack, "package/package.json"));
  if (manifest.name !== record.name || manifest.version !== record.version) throw new Error(`${record.filename} manifest identity mismatch`);
  validatePackedReadme(join(unpack, "package"));
}

function packPackages(selected, packDir, scratch) {
  const tarballs = [];
  for (const name of selected) {
    const output = execFileSync("npm", ["pack", "-w", `@actuarial-ts/${name}`, "--json", "--pack-destination", packDir], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const packed = JSON.parse(output);
    if (!Array.isArray(packed) || packed.length !== 1) throw new Error(`npm pack returned an unexpected result for ${name}`);
    const record = { name: `@actuarial-ts/${name}`, version: packed[0].version, filename: packed[0].filename, sha256: sha256(join(packDir, packed[0].filename)) };
    inspectTarball(join(packDir, record.filename), record, scratch);
    tarballs.push(record);
  }
  return tarballs;
}

function lockCoordinate(lock, name) {
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`root lockfile has no exact ${name} coordinate`);
  parseVersion(version);
  return `${name}@${version}`;
}
export function externalProfiles(selected, lock, agentsManifest) {
  const lockCoordinates = [lockCoordinate(lock, "zod")];
  if (!selected.includes("agents")) return [{ name: "runtime-four", coordinates: lockCoordinates }];
  const names = ["zod", "@mastra/core", "@mastra/mcp"];
  const locked = names.map((name) => lockCoordinate(lock, name));
  const minimum = names.map((name) => `${name}@${peerFloor(agentsManifest.peerDependencies[name])}`);
  return [{ name: "lock", coordinates: locked }, { name: "minimum", coordinates: minimum }];
}

function packageCopies(nodeModules, selected) {
  const result = new Map(selected.map((name) => [`@actuarial-ts/${name}`, new Set()]));
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(".")) continue;
      const path = join(directory, entry);
      if (entry.startsWith("@")) {
        for (const child of readdirSync(path)) {
          const packagePath = join(path, child); const packageName = `${entry}/${child}`;
          if (result.has(packageName)) result.get(packageName).add(realpathSync(packagePath));
          visit(join(packagePath, "node_modules"));
        }
      } else if (lstatSync(path).isDirectory()) visit(join(path, "node_modules"));
    }
  };
  visit(nodeModules);
  return result;
}

function verifyInstalledCopies(consumer, selected, expectedVersion) {
  for (const [name, copies] of packageCopies(join(consumer, "node_modules"), selected)) {
    if (copies.size !== 1) throw new Error(`${name} has ${copies.size} physical installed copies`);
    const manifest = readJson(join([...copies][0], "package.json"));
    if (expectedVersion && manifest.version !== expectedVersion) throw new Error(`${name} installed ${manifest.version}, expected ${expectedVersion}`);
  }
}

function initializeConsumer(consumer) {
  mkdirSync(consumer);
  execFileSync("npm", ["init", "-y"], { cwd: consumer, stdio: "ignore" });
  const manifest = readJson(join(consumer, "package.json")); manifest.type = "module"; manifest.private = true;
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function consume({ selected, tarballs, source, version, profiles, temp, manifestDir = null }) {
  const packageSpecs = source === "registry"
    ? selected.map((name) => `@actuarial-ts/${name}@${version}`)
    : tarballs.map((item) => join(manifestDir ?? join(temp, "packs"), item.filename));
  for (const profile of profiles) {
    const consumer = join(temp, `consumer-${profile.name}`); initializeConsumer(consumer);
    execFileSync("npm", ["install", "--save-exact", "--ignore-scripts", "--prefer-offline", "--no-audit", ...packageSpecs, ...profile.coordinates], { cwd: consumer, stdio: "inherit", timeout: 180_000 });
    writeFileSync(join(consumer, "smoke.mjs"), fixture(selected.includes("agents")));
    execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit" });
    verifyInstalledCopies(consumer, selected, version ?? tarballs[0]?.version);
    execFileSync("npm", ["ls", "--all"], { cwd: consumer, stdio: "ignore" });
  }
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const setName = options["--package-set"] ?? "all-five";
  const selected = packageSet(setName);
  const source = options["--source"] ?? "packed";
  const keep = process.env.KEEP_PACKED_SMOKE === "1";
  if (!["packed", "registry"].includes(source)) throw new Error(`unknown package source ${source}`);
  if (source === "registry" && !options["--version"]) throw new Error("registry source requires --version");
  if (source === "registry") parseVersion(options["--version"]);
  if (options["--pack-only"] && (!options["--handoff-dir"] || source !== "packed" || setName !== "runtime-four")) throw new Error("pack-only requires a runtime-four packed handoff directory");
  if (options["--consume-manifest"] && (options["--pack-only"] || source !== "packed")) throw new Error("consume-manifest cannot be combined with packing or registry mode");

  const temp = mkdtempSync(join(tmpdir(), "actuarial-ts-packed-"));
  try {
    const lock = readJson(join(root, "package-lock.json"));
    const agentManifest = readJson(join(root, "packages/agents/package.json"));
    if (options["--consume-manifest"]) {
      const manifestPath = resolve(options["--consume-manifest"]); const directory = dirname(manifestPath);
      const manifest = validateHandoffManifest(readJson(manifestPath), directory, setName, options["--require-node-major"] ?? null);
      const zodVersion = manifest.externalDependencies.zod.slice("zod@".length);
      for (const packageName of ["data", "interchange"]) {
        const packedManifest = JSON.parse(execFileSync("tar", ["-xOf", join(directory, manifest.tarballs.find((item) => item.name === `@actuarial-ts/${packageName}`).filename), "package/package.json"], { encoding: "utf8" }));
        if (!satisfiesRange(zodVersion, packedManifest.dependencies.zod)) throw new Error(`handoff Zod does not satisfy ${packageName}`);
      }
      consume({ selected, tarballs: manifest.tarballs, source, profiles: [{ name: "runtime-four", coordinates: [manifest.externalDependencies.zod] }], temp, manifestDir: directory });
      console.log(`packed smoke: consumed verified ${setName} handoff`);
      return;
    }

    let tarballs = [];
    if (source === "packed") {
      const packDir = join(temp, "packs"); mkdirSync(packDir);
      tarballs = packPackages(selected, packDir, temp);
      if (options["--pack-only"]) {
        const handoff = resolve(options["--handoff-dir"]); mkdirSync(handoff, { recursive: true });
        for (const item of tarballs) copyFileSync(join(packDir, item.filename), join(handoff, item.filename));
        const manifest = { schemaVersion: 1, packageSet: setName, tarballs, externalDependencies: { zod: lockCoordinate(lock, "zod") } };
        writeFileSync(join(handoff, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
        validateHandoffManifest(manifest, handoff, setName);
        console.log(`packed smoke: wrote verified handoff ${handoff}`);
        return;
      }
    }
    consume({ selected, tarballs, source, version: options["--version"] ?? null, profiles: externalProfiles(selected, lock, agentManifest), temp });
    const identity = source === "registry" ? selected.map((name) => `@actuarial-ts/${name}@${options["--version"]}`) : tarballs.map((item) => `${item.name}@${item.version}`);
    console.log(`packed smoke: ${setName} ${source} passed (${identity.join(", ")})`);
  } finally {
    if (keep) console.log(`packed smoke retained: ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) run().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });

function fixture(withAgents) { return `
import { CASUALTY_FORMULA_TEMPLATES, compileDiagnosticDefinition } from "@actuarial-ts/core";
import { validateDiagnosticRunInput, runValidatedMetricDiagnostics } from "@actuarial-ts/data";
import { diagnosticDefinitionToDoc, docToDiagnosticDefinition } from "@actuarial-ts/interchange";
import { createDiagnosticRunIdentity, verifyDiagnosticRunIdentity, createBundle } from "@actuarial-ts/compliance";
${withAgents ? 'import { createDiagnosticSelectionTool } from "@actuarial-ts/agents"; import { makeCoreTool } from "@mastra/core/utils";' : ""}
const definition={diagnosticDefinitionVersion:"1.0.0",id:"packed",version:"1.0.0",lossRowGrain:"aggregate",measures:[{id:"reported",displayName:"Reported",description:"claims",source:"loss",kind:"count",unit:"claim",developmentSemantics:"cumulative",aggregation:"sum",missing:"unknown",countPopulationId:"claims"},{id:"exposure",displayName:"Exposure",description:"earned",source:"exposure",kind:"exposure",unit:"vehicle-year",developmentSemantics:"point-in-time",aggregation:"sum",missing:"unknown",exposureBasisId:"earned",exposureTiming:"origin-static"}],countPopulations:[{id:"claims",displayName:"Claims",subject:"claim",unit:"claim",description:"claims"}],exposureBases:[{id:"earned",displayName:"Earned",basis:"earned",unit:"vehicle-year",description:"earned"}],amountBases:[],derivedMeasures:[],formulas:[CASUALTY_FORMULA_TEMPLATES[0]],instances:[{id:"packed/frequency",version:"1.0.0",formulaId:"frequency",bindings:{claims:{op:"measure",measureId:"reported"},exposure:{op:"measure",measureId:"exposure"}},presentation:{displayName:"Frequency",description:"Reported frequency",displayUnit:"claims per vehicle-year",scale:100,numeratorLabel:"claims",denominatorLabel:"exposure"},rules:[]}],reviewRules:[],periodAxis:{kind:"calendar",originCadence:"year",valuationCadence:"year",originAnchor:"start",valuationAnchor:"end",ageUnit:"month",ageOffset:0}};
const compiled=compileDiagnosticDefinition(definition);const restored=docToDiagnosticDefinition(diagnosticDefinitionToDoc(compiled,{createdAt:"2026-09-03T00:00:00Z"}));if(restored.definition.definitionIntegrity!==compiled.definitionIntegrity)throw new Error("definition round trip failed");
const run=runValidatedMetricDiagnostics(validateDiagnosticRunInput({definition,losses:[{rowType:"aggregate",recordId:"r",sourceGroup:"fleet",origin:"2025",valuation:"2025",complete:true,source:{artifactId:"loss"},measures:{reported:5}}],exposures:[{key:"e",sourceGroup:"fleet",origin:"2025",measureId:"exposure",value:20,complete:true,source:{artifactId:"exposure"}}],filter:{instanceIds:["packed/frequency"]},runPresetId:"packed-v1",datasetArtifactId:"loss"}));if(run.status!=="completed")throw new Error("run blocked");const metric=run.result.emergence[0].metrics["packed/frequency"];if(metric.calculation.value!==0.25||metric.presentation.value!==25)throw new Error("wrong calculation");
const identityInput={completedRun:run,artifacts:[{id:"loss",scope:"input",assurance:"sdk-computed",bytes:new TextEncoder().encode("loss")},{id:"exposure",scope:"input",assurance:"sdk-computed",bytes:new TextEncoder().encode("exposure")}]};const provenance=await createDiagnosticRunIdentity(identityInput);const verified=await verifyDiagnosticRunIdentity(JSON.parse(JSON.stringify(provenance)),identityInput);if(verified.manifest.definitionIntegrity!==compiled.definitionIntegrity||verified.result.resultFingerprint!==run.result.resultFingerprint)throw new Error("provenance identities are incoherent");const bundle=createBundle({inputs:{},parameters:{},results:run.result,sdkVersions:{...verified.manifest.packageVersions},createdAt:"2026-09-03T00:00:00Z",diagnosticRuns:[verified],wrap:{triangles:[],selections:[],results:[]}});if(!("wrapped" in bundle))throw new Error("bundle missing");
${withAgents ? 'const requestContext={get:()=>"tenant"};const tool=createDiagnosticSelectionTool({definition:compiled,presets:[{id:"packed-v1",definitionIntegrity:compiled.definitionIntegrity,allowedInstanceIds:["packed/frequency"],execute:async()=>verified}]});const core=makeCoreTool(tool,{name:tool.id,requestContext});const rejected=await core.execute({runPresetId:"packed-v1",instanceIds:["not-registered"],view:"emergence"},{requestContext});if(rejected.success!==false||rejected.error.code!=="UNAPPROVED_DIAGNOSTIC_INSTANCE")throw new Error("trusted catalog did not reject");' : ""}
console.log("installed public diagnostic fixture passed");
`; }
