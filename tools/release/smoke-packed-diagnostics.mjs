import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ALL_PACKAGES = [
  "core",
  "interchange",
  "data",
  "compliance",
  "agents",
];
export const RUNTIME_FOUR = ALL_PACKAGES.slice(0, 4);
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REQUIRED_TARBALL_FILES = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/NOTICE",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/src/index.ts",
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
    if (!value.startsWith("--"))
      throw new Error(`unexpected argument ${value}`);
    const equals = value.indexOf("=");
    if (equals >= 0) result[value.slice(0, equals)] = value.slice(equals + 1);
    else if (["--pack-only"].includes(value)) result[value] = true;
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith("--"))
        throw new Error(`${value} requires a value`);
      result[value] = next;
      index += 1;
    }
  }
  return result;
}

export function peerFloor(range) {
  if (typeof range !== "string") throw new Error("peer range must be a string");
  const match = range
    .trim()
    .match(/^(?:\^|~|>=\s*)?(\d+)\.(\d+)\.(\d+)(?:\s+<.*)?$/);
  if (!match)
    throw new Error(`peer range has no concrete lower bound: ${range}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match)
    throw new Error(`expected an exact semantic version, got ${version}`);
  return match.slice(1).map(Number);
}
function compareVersion(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1)
    if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}
export function satisfiesRange(version, range) {
  parseVersion(version);
  const value = range.trim();
  if (value.startsWith("^")) {
    const floor = peerFloor(value);
    const [major, minor, patch] = parseVersion(floor);
    const upper =
      major > 0
        ? `${major + 1}.0.0`
        : minor > 0
          ? `0.${minor + 1}.0`
          : `0.0.${patch + 1}`;
    return (
      compareVersion(version, floor) >= 0 && compareVersion(version, upper) < 0
    );
  }
  const bounds = [...value.matchAll(/(>=|>|<=|<)\s*(\d+(?:\.\d+){0,2})/g)];
  if (!bounds.length) return compareVersion(version, value) === 0;
  return bounds.every(([, operator, rawBound]) => {
    const bound = rawBound.split(".").concat(["0", "0"]).slice(0, 3).join(".");
    const compared = compareVersion(version, bound);
    return operator === ">="
      ? compared >= 0
      : operator === ">"
        ? compared > 0
        : operator === "<="
          ? compared <= 0
          : compared < 0;
  });
}

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const strictKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected)
    throw new Error(`${label} has missing or unknown fields`);
};

export function validateHandoffManifest(
  manifest,
  directory,
  setName,
  requiredNodeMajor = null,
) {
  strictKeys(
    manifest,
    ["schemaVersion", "packageSet", "tarballs", "externalDependencies"],
    "handoff manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageSet !== setName ||
    !Array.isArray(manifest.tarballs)
  )
    throw new Error("invalid handoff manifest identity");
  const selected = packageSet(setName);
  if (setName !== "runtime-four")
    throw new Error("manifest handoff is reserved for runtime-four");
  if (
    requiredNodeMajor !== null &&
    Number(process.versions.node.split(".")[0]) !== Number(requiredNodeMajor)
  )
    throw new Error(`requires Node major ${requiredNodeMajor}`);
  const expectedNames = selected.map((name) => `@actuarial-ts/${name}`);
  if (manifest.tarballs.length !== expectedNames.length)
    throw new Error("handoff manifest has a missing or extra package");
  for (const [index, item] of manifest.tarballs.entries()) {
    strictKeys(
      item,
      ["name", "version", "filename", "sha256"],
      `tarball ${index}`,
    );
    if (item.name !== expectedNames[index])
      throw new Error("handoff manifest package ordering mismatch");
    if (!/^actuarial-ts-[a-z-]+-\d+\.\d+\.\d+\.tgz$/.test(item.filename))
      throw new Error(`unsafe tarball filename ${item.filename}`);
    const path = join(directory, item.filename);
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`missing handoff tarball ${item.filename}`);
    if (sha256(path) !== item.sha256)
      throw new Error(`tampered handoff tarball ${item.filename}`);
  }
  const actualTarballs = readdirSync(directory)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  const expectedTarballs = manifest.tarballs
    .map((item) => item.filename)
    .sort();
  if (actualTarballs.join("\0") !== expectedTarballs.join("\0"))
    throw new Error("handoff directory has extra or missing tarballs");
  strictKeys(manifest.externalDependencies, ["zod"], "handoff dependencies");
  if (!/^zod@\d+\.\d+\.\d+$/.test(manifest.externalDependencies.zod))
    throw new Error("handoff has an invalid Zod coordinate");
  return manifest;
}

function markdownLinks(readme) {
  return [...readme.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)].map((match) =>
    match[1].trim().replace(/^<|>$/g, ""),
  );
}
export function validatePackedReadme(unpackedPackage) {
  const readmePath = join(unpackedPackage, "README.md");
  for (const destination of markdownLinks(readFileSync(readmePath, "utf8"))) {
    if (/^(?:https?:|mailto:|#)/.test(destination)) continue;
    const clean = decodeURIComponent(destination.split(/[?#]/)[0]);
    const target = normalize(join(unpackedPackage, clean));
    if (
      !target.startsWith(`${normalize(unpackedPackage)}${sep}`) ||
      !existsSync(target)
    )
      throw new Error(
        `packed README has unavailable relative link: ${destination}`,
      );
  }
}

function inspectTarball(path, record, scratch) {
  const files = execFileSync("tar", ["-tf", path], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const required of REQUIRED_TARBALL_FILES)
    if (!files.includes(required))
      throw new Error(`${record.filename} misses ${required}`);
  if (
    files.some((file) =>
      /(^|\/)(test|tests|\.cache|docs\/superpowers|data\/source-cache)(\/|$)|\.rda$|\.tgz$|\.env(?:\.|$)/.test(
        file,
      ),
    )
  )
    throw new Error(`${record.filename} contains excluded development content`);
  const unpack = join(scratch, `unpack-${record.name.replaceAll("/", "-")}`);
  mkdirSync(unpack);
  execFileSync("tar", ["-xzf", path, "-C", unpack]);
  const manifest = readJson(join(unpack, "package/package.json"));
  if (manifest.name !== record.name || manifest.version !== record.version)
    throw new Error(`${record.filename} manifest identity mismatch`);
  validatePackedReadme(join(unpack, "package"));
}

function packPackages(selected, packDir, scratch) {
  const tarballs = [];
  for (const name of selected) {
    const output = execFileSync(
      "npm",
      [
        "pack",
        "-w",
        `@actuarial-ts/${name}`,
        "--json",
        "--pack-destination",
        packDir,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const packed = JSON.parse(output);
    if (!Array.isArray(packed) || packed.length !== 1)
      throw new Error(`npm pack returned an unexpected result for ${name}`);
    const record = {
      name: `@actuarial-ts/${name}`,
      version: packed[0].version,
      filename: packed[0].filename,
      sha256: sha256(join(packDir, packed[0].filename)),
    };
    inspectTarball(join(packDir, record.filename), record, scratch);
    tarballs.push(record);
  }
  return tarballs;
}

function lockCoordinate(lock, name) {
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (!version)
    throw new Error(`root lockfile has no exact ${name} coordinate`);
  parseVersion(version);
  return `${name}@${version}`;
}
export function externalProfiles(selected, lock, agentsManifest) {
  const lockCoordinates = [lockCoordinate(lock, "zod")];
  if (!selected.includes("agents"))
    return [{ name: "runtime-four", coordinates: lockCoordinates }];
  const names = ["zod", "@mastra/core", "@mastra/mcp"];
  const locked = names.map((name) => lockCoordinate(lock, name));
  const minimum = names.map(
    (name) => `${name}@${peerFloor(agentsManifest.peerDependencies[name])}`,
  );
  return [
    { name: "lock", coordinates: locked },
    { name: "minimum", coordinates: minimum },
  ];
}

function packageCopies(nodeModules, selected) {
  const result = new Map(
    selected.map((name) => [`@actuarial-ts/${name}`, new Set()]),
  );
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(".")) continue;
      const path = join(directory, entry);
      if (entry.startsWith("@")) {
        for (const child of readdirSync(path)) {
          const packagePath = join(path, child);
          const packageName = `${entry}/${child}`;
          if (result.has(packageName))
            result.get(packageName).add(realpathSync(packagePath));
          visit(join(packagePath, "node_modules"));
        }
      } else if (lstatSync(path).isDirectory())
        visit(join(path, "node_modules"));
    }
  };
  visit(nodeModules);
  return result;
}

function verifyInstalledCopies(consumer, selected, expectedVersion) {
  for (const [name, copies] of packageCopies(
    join(consumer, "node_modules"),
    selected,
  )) {
    if (copies.size !== 1)
      throw new Error(`${name} has ${copies.size} physical installed copies`);
    const manifest = readJson(join([...copies][0], "package.json"));
    if (expectedVersion && manifest.version !== expectedVersion)
      throw new Error(
        `${name} installed ${manifest.version}, expected ${expectedVersion}`,
      );
  }
}

function initializeConsumer(consumer) {
  mkdirSync(consumer);
  execFileSync("npm", ["init", "-y"], { cwd: consumer, stdio: "ignore" });
  const manifest = readJson(join(consumer, "package.json"));
  manifest.type = "module";
  manifest.private = true;
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function consume({
  selected,
  tarballs,
  source,
  version,
  profiles,
  temp,
  manifestDir = null,
}) {
  const packageSpecs =
    source === "registry"
      ? selected.map((name) => `@actuarial-ts/${name}@${version}`)
      : tarballs.map((item) =>
          join(manifestDir ?? join(temp, "packs"), item.filename),
        );
  for (const profile of profiles) {
    const consumer = join(temp, `consumer-${profile.name}`);
    initializeConsumer(consumer);
    execFileSync(
      "npm",
      [
        "install",
        "--save-exact",
        "--ignore-scripts",
        "--prefer-offline",
        "--no-audit",
        ...packageSpecs,
        ...profile.coordinates,
      ],
      { cwd: consumer, stdio: "inherit", timeout: 180_000 },
    );
    writeFileSync(
      join(consumer, "smoke.mjs"),
      fixture(selected.includes("agents")),
    );
    execFileSync(process.execPath, ["smoke.mjs"], {
      cwd: consumer,
      stdio: "inherit",
    });
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
  if (!["packed", "registry"].includes(source))
    throw new Error(`unknown package source ${source}`);
  if (source === "registry" && !options["--version"])
    throw new Error("registry source requires --version");
  if (source === "registry") parseVersion(options["--version"]);
  if (
    options["--pack-only"] &&
    (!options["--handoff-dir"] ||
      source !== "packed" ||
      setName !== "runtime-four")
  )
    throw new Error(
      "pack-only requires a runtime-four packed handoff directory",
    );
  if (
    options["--consume-manifest"] &&
    (options["--pack-only"] || source !== "packed")
  )
    throw new Error(
      "consume-manifest cannot be combined with packing or registry mode",
    );

  const temp = mkdtempSync(join(tmpdir(), "actuarial-ts-packed-"));
  try {
    const lock = readJson(join(root, "package-lock.json"));
    const agentManifest = readJson(join(root, "packages/agents/package.json"));
    if (options["--consume-manifest"]) {
      const manifestPath = resolve(options["--consume-manifest"]);
      const directory = dirname(manifestPath);
      const manifest = validateHandoffManifest(
        readJson(manifestPath),
        directory,
        setName,
        options["--require-node-major"] ?? null,
      );
      const zodVersion = manifest.externalDependencies.zod.slice("zod@".length);
      for (const packageName of ["data", "interchange"]) {
        const packedManifest = JSON.parse(
          execFileSync(
            "tar",
            [
              "-xOf",
              join(
                directory,
                manifest.tarballs.find(
                  (item) => item.name === `@actuarial-ts/${packageName}`,
                ).filename,
              ),
              "package/package.json",
            ],
            { encoding: "utf8" },
          ),
        );
        if (!satisfiesRange(zodVersion, packedManifest.dependencies.zod))
          throw new Error(`handoff Zod does not satisfy ${packageName}`);
      }
      consume({
        selected,
        tarballs: manifest.tarballs,
        source,
        profiles: [
          {
            name: "runtime-four",
            coordinates: [manifest.externalDependencies.zod],
          },
        ],
        temp,
        manifestDir: directory,
      });
      console.log(`packed smoke: consumed verified ${setName} handoff`);
      return;
    }

    let tarballs = [];
    if (source === "packed") {
      const packDir = join(temp, "packs");
      mkdirSync(packDir);
      tarballs = packPackages(selected, packDir, temp);
      if (options["--pack-only"]) {
        const handoff = resolve(options["--handoff-dir"]);
        mkdirSync(handoff, { recursive: true });
        for (const item of tarballs)
          copyFileSync(
            join(packDir, item.filename),
            join(handoff, item.filename),
          );
        const manifest = {
          schemaVersion: 1,
          packageSet: setName,
          tarballs,
          externalDependencies: { zod: lockCoordinate(lock, "zod") },
        };
        writeFileSync(
          join(handoff, "manifest.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
        validateHandoffManifest(manifest, handoff, setName);
        console.log(`packed smoke: wrote verified handoff ${handoff}`);
        return;
      }
    }
    consume({
      selected,
      tarballs,
      source,
      version: options["--version"] ?? null,
      profiles: externalProfiles(selected, lock, agentManifest),
      temp,
    });
    const identity =
      source === "registry"
        ? selected.map(
            (name) => `@actuarial-ts/${name}@${options["--version"]}`,
          )
        : tarballs.map((item) => `${item.name}@${item.version}`);
    console.log(
      `packed smoke: ${setName} ${source} passed (${identity.join(", ")})`,
    );
  } finally {
    if (keep) console.log(`packed smoke retained: ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked)
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });

export function fixture(withAgents) {
  return `
import assert from "node:assert/strict";
import { CASUALTY_FORMULA_TEMPLATES, DiagnosticValidationError, ReservingError, compileDiagnosticDefinition, snapshotDiagnosticJson, getMetricDiagnosticsResultIdentity, buildTriangles, triangleFromGrid, capClaims, latestAccidentYear } from "@actuarial-ts/core";
import { validateDiagnosticRunInput, runValidatedMetricDiagnostics, parseLossRunCsv, parseExposureCsv } from "@actuarial-ts/data";
import { diagnosticDefinitionToDoc, docToDiagnosticDefinition } from "@actuarial-ts/interchange";
import { ComplianceError, canonicalJson, fnv1a64, createDiagnosticRunIdentity, verifyDiagnosticRunIdentity, createBundle, verifyBundle, createLedger, recordAssumption } from "@actuarial-ts/compliance";
${withAgents ? 'import { createDiagnosticSelectionTool, diagnosticAgentToolResultSchema } from "@actuarial-ts/agents"; import { makeCoreTool } from "@mastra/core/utils";' : ""}
const definition={diagnosticDefinitionVersion:"1.0.0",id:"packed",version:"1.0.0",lossRowGrain:"aggregate",measures:[{id:"reported",displayName:"Reported",description:"claims",source:"loss",kind:"count",unit:"claim",developmentSemantics:"cumulative",aggregation:"sum",missing:"unknown",countPopulationId:"claims"},{id:"exposure",displayName:"Exposure",description:"earned",source:"exposure",kind:"exposure",unit:"vehicle-year",developmentSemantics:"point-in-time",aggregation:"sum",missing:"unknown",exposureBasisId:"earned",exposureTiming:"origin-static"}],countPopulations:[{id:"claims",displayName:"Claims",subject:"claim",unit:"claim",description:"claims"}],exposureBases:[{id:"earned",displayName:"Earned",basis:"earned",unit:"vehicle-year",description:"earned"}],amountBases:[],derivedMeasures:[],formulas:[CASUALTY_FORMULA_TEMPLATES[0]],instances:[{id:"packed/frequency",version:"1.0.0",formulaId:"frequency",bindings:{claims:{op:"measure",measureId:"reported"},exposure:{op:"measure",measureId:"exposure"}},presentation:{displayName:"Frequency",description:"Reported frequency",displayUnit:"claims per vehicle-year",scale:100,numeratorLabel:"claims",denominatorLabel:"exposure"},rules:[]}],reviewRules:[],periodAxis:{kind:"calendar",originCadence:"year",valuationCadence:"year",originAnchor:"start",valuationAnchor:"end",ageUnit:"month",ageOffset:0}};
const compiled=compileDiagnosticDefinition(definition);const restored=docToDiagnosticDefinition(diagnosticDefinitionToDoc(compiled,{createdAt:"2026-09-03T00:00:00Z"}));if(restored.definition.definitionIntegrity!==compiled.definitionIntegrity)throw new Error("definition round trip failed");
const baseRunInput={definition,losses:[{rowType:"aggregate",recordId:"r",sourceGroup:"fleet",origin:"2025",valuation:"2025",complete:true,source:{artifactId:"loss"},measures:{reported:5}}],exposures:[{key:"e",sourceGroup:"fleet",origin:"2025",measureId:"exposure",value:20,complete:true,source:{artifactId:"exposure"}}],filter:{instanceIds:["packed/frequency"]},runPresetId:"packed-v1",datasetArtifactId:"loss"};
const run=runValidatedMetricDiagnostics(validateDiagnosticRunInput(baseRunInput));if(run.status!=="completed")throw new Error("run blocked");const metric=run.result.emergence[0].metrics["packed/frequency"];if(metric.calculation.value!==0.25||metric.presentation.value!==25)throw new Error("wrong calculation");
const identityInput={completedRun:run,inputArtifacts:[{id:"loss",scope:"input",assurance:"sdk-computed",bytes:new TextEncoder().encode("loss")},{id:"exposure",scope:"input",assurance:"sdk-computed",bytes:new TextEncoder().encode("exposure")}],preparationArtifacts:[],preparationLineage:[]};const provenance=await createDiagnosticRunIdentity(identityInput);const verified=await verifyDiagnosticRunIdentity(JSON.parse(JSON.stringify(provenance)),identityInput);if(verified.manifest.definitionIntegrity!==compiled.definitionIntegrity||verified.resultFingerprint!==provenance.resultFingerprint)throw new Error("provenance identities are incoherent");const bundle=createBundle({inputs:{},parameters:{},results:run.result,sdkVersions:{"@actuarial-ts/core":verified.manifest.engine.packages.core,"@actuarial-ts/data":verified.manifest.engine.packages.data,"@actuarial-ts/compliance":verified.manifest.engine.packages.compliance},createdAt:"2026-09-03T00:00:00Z",diagnosticRuns:[verified],wrap:{triangles:[],selections:[],results:[]}});if(!("wrapped" in bundle)||!verifyBundle(bundle.wrapped,run.result).reproduced)throw new Error("bundle verification failed");
${auditFixture()}
${
  withAgents
    ? `const requestContext={get:()=>"tenant"};
const tool=createDiagnosticSelectionTool({definition:compiled,runPresets:[{id:"packed-v1",definitionIntegrity:compiled.definitionIntegrity,allowedInstanceIds:["packed/frequency"],execute:async({tenantId,instanceIds})=>{if(tenantId!=="tenant"||instanceIds.join()!=="packed/frequency")throw new Error("host context was not preserved");return verified;}}]});
const core=makeCoreTool(tool,{name:tool.id,requestContext});
const rejected=await core.execute({runPresetId:"packed-v1",instanceIds:["not-registered"],view:"emergence"},{requestContext});
if(rejected.success!==false||rejected.error.code!=="UNAPPROVED_DIAGNOSTIC_INSTANCE")throw new Error("trusted catalog did not reject");
for(const view of ["emergence","latest-diagonal","triangles"]){
 const response=await core.execute({runPresetId:"packed-v1",instanceIds:["packed/frequency"],view},{requestContext});
 if(response.success!==true||response.data.runFingerprint!==verified.runFingerprint||response.data.display.view!==view)throw new Error("trusted catalog success envelope is incoherent");
 const display=response.data.display;
 if(view==="triangles"){if(!Array.isArray(display.triangles)||display.triangles.length===0)throw new Error("triangle display missing");}
 else if(!Array.isArray(display.points)||display.points.length!==1||"components" in display.points[0]||display.points[0].metrics["packed/frequency"].calculation.value!==0.25)throw new Error("point display is not the verified projection");
 const corrupted=structuredClone(response);corrupted.data.review.identityBody.checks[0].status="unsupported";
 if(diagnosticAgentToolResultSchema.safeParse(corrupted).success)throw new Error("nested review output schema accepted unknown status");
}
const prototypeTool=createDiagnosticSelectionTool({definition:prototypeCompiled,runPresets:[{id:"packed-v1",definitionIntegrity:prototypeCompiled.definitionIntegrity,allowedInstanceIds:prototypeKeys,execute:async()=>prototypeVerified}]});
const prototypeCore=makeCoreTool(prototypeTool,{name:prototypeTool.id,requestContext});
for(const view of ["emergence","latest-diagonal","triangles"]){
 const response=await prototypeCore.execute({runPresetId:"packed-v1",instanceIds:prototypeKeys,view},{requestContext});
 assert.equal(response.success,true);
 assert.deepEqual(Object.keys(response.data.formulaFingerprints).sort(),[...prototypeKeys].sort());
 assert.deepEqual(Object.keys(response.data.calculationFingerprints).sort(),[...prototypeKeys].sort());
 const display=response.data.display;
 if(view==="triangles"){
  assert.deepEqual(display.triangles.map((triangle)=>triangle.instanceId).sort(),[...prototypeKeys].sort());
  for(const triangle of display.triangles)assert.equal(triangle.cells[0][0].evaluation.calculation.value,0.25);
 }else{
  assert.deepEqual(Object.keys(display.points[0].metrics).sort(),[...prototypeKeys].sort());
  assert.deepEqual(display.points[0].dimensions,opaqueDimensions);
  for(const id of prototypeKeys)assert.equal(display.points[0].metrics[id].calculation.value,0.25);
 }
}`
    : ""
}
console.log("installed public diagnostic fixture passed");
`;
}

/** Regressions execute only installed public APIs, in both peer profiles. */
function auditFixture() {
  return String.raw`
const executeInput = (overrides = {}) => runValidatedMetricDiagnostics(
  validateDiagnosticRunInput({ ...baseRunInput, ...overrides }),
);
const sourceRow = baseRunInput.losses[0];
for (const [losses, checkId] of [
  [[{ ...sourceRow, origin: "invalid" }], "period-validity"],
  [[sourceRow, { ...sourceRow }], "loss-identity"],
  [[{ ...sourceRow, complete: false }], "loss-completeness"],
  [[{ ...sourceRow, measures: { reported: 5, unknown: 1 } }], "measure-contract"],
]) {
  const outcome = executeInput({ losses });
  assert.equal(outcome.status, "blocked", checkId);
  assert.equal(outcome.stage, "review", checkId);
  assert.equal(outcome.gate.reviewGate, "blocked");
  assert.equal(outcome.gate.metricGate, "not-run");
  assert.equal(outcome.review.report.checks.find(
    (check) => check.id === "diagnostic/structural/" + checkId,
  ).status, "fail");
}
const cutoff = executeInput({ completePeriodCutoffs: [{
  sourceGroup: "fleet", originThrough: "2024", valuationThrough: "2024",
}] });
assert.equal(cutoff.status, "completed");
assert.deepEqual(cutoff.prepared.cells, []);
assert.deepEqual(cutoff.result.emergence, []);
assert.deepEqual(cutoff.prepared.inputAudit.map((entry) => entry.disposition),
  ["complete-period-cutoff", "complete-period-cutoff"]);

function diagnosticIssue(action, expected) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof DiagnosticValidationError);
    assert.deepEqual(error.issues.map(({ domain, code, path }) => ({ domain, code, path })), expected);
    return true;
  });
}
diagnosticIssue(() => validateDiagnosticRunInput({
  ...baseRunInput, filter: { sourceGroups: ["not-present"] },
}), [{ domain: "configuration", code: "unknown-reference", path: "$.filter.sourceGroups[0]" }]);
const unknownDefinition = structuredClone(definition);
unknownDefinition.formulas[0].futureBehavior = true;
diagnosticIssue(() => compileDiagnosticDefinition(unknownDefinition), [
  { domain: "definition", code: "unknown-key", path: "$.formulas[0].futureBehavior" },
]);
const invalidEnum = structuredClone(definition);
invalidEnum.periodAxis.originAnchor = "middle";
diagnosticIssue(() => compileDiagnosticDefinition(invalidEnum), [
  { domain: "definition", code: "invalid-period", path: "$.periodAxis.originAnchor" },
]);
const incompatible = structuredClone(definition);
incompatible.instances[0].rules = [{
  id: "incompatible", code: "incompatible", message: "Different quantities",
  severity: "fail", when: {
    left: { source: "calculation", field: "numerator" }, operator: "gt",
    right: { source: "calculation", field: "denominator" },
  },
}];
diagnosticIssue(() => compileDiagnosticDefinition(incompatible), [
  { domain: "definition", code: "incompatible-semantics", path: "$.instances[0].rules[0].when" },
]);
const cycle = {}; cycle.self = cycle;
diagnosticIssue(() => snapshotDiagnosticJson(cycle), [
  { domain: "input", code: "cycle", path: "$.self" },
]);
let accessorCalls = 0;
const accessor = [1];
Object.defineProperty(accessor, "0", { get() { accessorCalls++; throw new Error("do not invoke"); } });
diagnosticIssue(() => snapshotDiagnosticJson(accessor), [
  { domain: "input", code: "invalid-json-value", path: "$[0]" },
]);
assert.equal(accessorCalls, 0);

// A reviewed policy exception cannot repair an ambiguous structural amount.
const allowed = executeInput({
  definition: { ...definition, lossRowGrain: "claim" },
  losses: [
    { ...sourceRow, rowType: "claim", claimId: "incomplete", complete: false },
    { ...sourceRow, rowType: "claim", claimId: "valid", recordId: "valid" },
  ],
  policy: { allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"], rationaleRef: "packed-review" },
});
assert.equal(allowed.status, "completed");
assert.equal(allowed.result.emergence[0].components.reported.value, null);
assert.equal(allowed.result.emergence[0].metrics["packed/frequency"].calculation.value, null);

// Prototype-shaped identifiers must not inherit a value from Object.prototype.
const prototypeDefinition = structuredClone(definition);
prototypeDefinition.measures[0].id = "toString";
prototypeDefinition.instances[0].bindings.claims.measureId = "toString";
const prototypeRun = executeInput({ definition: prototypeDefinition, losses: [{ ...sourceRow, measures: {} }] });
assert.equal(prototypeRun.status, "completed");
assert.equal(prototypeRun.result.emergence[0].components.toString.value, null);

// Preserve literal prototype names through every public schema/identity seam.
const prototypeKeys = ["__proto__", "constructor", "toString", ":__proto__"];
const opaqueDimensions = Object.fromEntries(prototypeKeys.map((key) => [key, { [key]: "retained" }]));
const prototypeCatalog = structuredClone(definition);
prototypeCatalog.measures[0].id = "__proto__";
prototypeCatalog.formulas = prototypeKeys.map((id) => ({
  ...definition.formulas[0], id,
  roles: Object.fromEntries([["__proto__", { kind: "count" }], ["exposure", { kind: "exposure" }]]),
  numerator: { op: "role", role: "__proto__" },
}));
prototypeCatalog.instances = prototypeKeys.map((id) => ({
  ...definition.instances[0], id, formulaId: id,
  bindings: Object.fromEntries([
    ["__proto__", { op: "measure", measureId: "__proto__" }],
    ["exposure", { op: "measure", measureId: "exposure" }],
  ]),
}));
const prototypeCompiled = compileDiagnosticDefinition(prototypeCatalog);
const prototypeDoc = diagnosticDefinitionToDoc(prototypeCompiled, { createdAt: "2026-09-03T00:00:00Z" });
const prototypeRestored = docToDiagnosticDefinition(prototypeDoc);
assert.equal(prototypeRestored.definition.definitionIntegrity, prototypeCompiled.definitionIntegrity);
assert.deepEqual(Object.keys(prototypeDoc.diagnosticDefinition.identities.formulaById).sort(), [...prototypeKeys].sort());
const prototypeCompleted = executeInput({
  definition: prototypeCatalog,
  losses: [{ ...sourceRow, sourceGroup: "__proto__", measures: { ["__proto__"]: 5 } }],
  exposures: [{ ...baseRunInput.exposures[0], sourceGroup: "__proto__" }],
  filter: { instanceIds: prototypeKeys },
  groupMap: { ["__proto__"]: "__proto__" },
  groupDimensions: { ["__proto__"]: opaqueDimensions },
});
assert.equal(prototypeCompleted.status, "completed");
assert.equal(prototypeCompleted.result.emergence[0].components.__proto__.value, 5);
assert.deepEqual(Object.keys(prototypeCompleted.result.emergence[0].metrics).sort(), [...prototypeKeys].sort());
const prototypeIdentityInput = { ...identityInput, completedRun: prototypeCompleted };
const prototypeProvenance = await createDiagnosticRunIdentity(prototypeIdentityInput);
const prototypeVerified = await verifyDiagnosticRunIdentity(structuredClone(prototypeProvenance), prototypeIdentityInput);
assert.equal(prototypeVerified.result.emergence[0].metrics.__proto__.calculation.value, 0.25);
const prototypeBundle = createBundle({
  inputs: {}, parameters: {}, results: prototypeCompleted.result,
  sdkVersions: { "@actuarial-ts/core": prototypeVerified.manifest.engine.packages.core, "@actuarial-ts/data": prototypeVerified.manifest.engine.packages.data, "@actuarial-ts/compliance": prototypeVerified.manifest.engine.packages.compliance },
  createdAt: "2026-09-03T00:00:00Z",
  diagnosticRuns: [prototypeVerified], wrap: { triangles: [], selections: [], results: [] },
});
assert.equal(verifyBundle(prototypeBundle.wrapped, prototypeCompleted.result).reproduced, true);

for (const sdkVersions of [undefined, null, 42, [], "0.6.1"])
  assert.throws(() => createBundle({
    inputs: {}, parameters: {}, results: run.result,
    createdAt: "2026-09-03T00:00:00Z", diagnosticRuns: [verified], sdkVersions,
  }), (error) => {
    assert.ok(error instanceof ComplianceError);
    assert.equal(error.code, "BAD_DIAGNOSTIC_RUN");
    assert.equal(error.path, "$.sdkVersions");
    return true;
  });

await assert.rejects(createDiagnosticRunIdentity({
  ...identityInput,
  inputArtifacts: identityInput.inputArtifacts.map((item, index) => index ? item : { ...item, scope: "preparation" }),
}), (error) => {
  assert.ok(error instanceof ComplianceError);
  assert.equal(error.code, "BAD_DIAGNOSTIC_RUN");
  assert.equal(error.path, "$.inputArtifacts[0].scope");
  return true;
});
const changedProvenance = structuredClone(provenance);
changedProvenance.result.emergence[0].metrics["packed/frequency"].calculation.value = 123;
await assert.rejects(verifyDiagnosticRunIdentity(changedProvenance, identityInput), (error) => {
  assert.ok(error instanceof ComplianceError);
  assert.equal(error.code, "DIAGNOSTIC_MISMATCH");
  assert.equal(error.path, '$.result.emergence[0].metrics["packed/frequency"].calculation.value');
  return true;
});

// Restamping outer and inner hashes must not turn altered arithmetic into evidence.
const alteredBundle = structuredClone(bundle.wrapped);
const alteredBody = JSON.parse(alteredBundle.bundle.payload);
const alteredRun = alteredBody.diagnosticRuns[0];
alteredRun.result.emergence[0].metrics["packed/frequency"].calculation.value = 123;
const tagged = (value) => "fnv1a64-jcs-v1:" + fnv1a64(canonicalJson({ identityVersion: 1, ...value }));
alteredRun.resultFingerprint = tagged({ kind: "diagnostic-result", result: getMetricDiagnosticsResultIdentity(alteredRun.result) });
alteredRun.runResultFingerprint = tagged({ kind: "diagnostic-run-result", runFingerprint: alteredRun.runFingerprint, resultFingerprint: alteredRun.resultFingerprint });
alteredBundle.bundle.payload = canonicalJson(alteredBody);
alteredBundle.bundle.hash = fnv1a64(alteredBundle.bundle.payload);
alteredBundle.integrity = fnv1a64(canonicalJson({ bundle: alteredBundle.bundle, interchange: alteredBundle.interchange }));
assert.equal(verifyBundle(alteredBundle, run.result).reproduced, false);

// Legacy full-SDK public boundaries remain covered by the clean consumer too.
const claim = { claimId: "claim", accidentDate: "2024-01-01", reportDate: "2024-01-02", evaluationDate: "2024-12-31", paidToDate: 5, caseReserve: 1, status: "open" };
function reservingError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ReservingError);
    assert.equal(error.code, code);
    return true;
  });
}
const conflicting = [claim, { ...claim, accidentDate: "2023-01-01" }];
for (const claims of [conflicting, [...conflicting].reverse()])
  reservingError(() => buildTriangles(claims, { cadence: "annual", asOfDate: "2024-12-31" }), "BAD_ORIGIN");
reservingError(() => buildTriangles([{ ...claim, accidentDate: "2023-02-29" }], { cadence: "annual", asOfDate: "2024-12-31" }), "BAD_DATE");
reservingError(() => triangleFromGrid("paid", ["2024"], [Infinity], [[1]]), "SHAPE");
reservingError(() => parseLossRunCsv("paid_to_date,Paid To Date\n1,2"), "SHAPE");
reservingError(() => parseExposureCsv("origin,exposure_units,Exposure Units\n2024,1,2"), "SHAPE");
reservingError(() => capClaims([claim], { cap: 0 }), "BAD_CAP");
reservingError(() => capClaims([claim], { cap: 100, indexRate: -1 }), "BAD_CAP");
reservingError(() => latestAccidentYear([claim], "2020-12-31"), "NO_CLAIMS");
const callerSelection = { nested: { value: 1 } };
const ledger = recordAssumption(createLedger(), { timestamp: "2026-09-04T00:00:00Z", actor: "default", field: "selection", value: callerSelection });
callerSelection.nested.value = 99;
assert.equal(ledger.entries[0].value.nested.value, 1);
assert.equal(Object.isFrozen(ledger.entries[0].value.nested), true);
assert.equal(Object.isFrozen(callerSelection.nested), false);
console.log("installed public audit regressions passed");
`;
}
