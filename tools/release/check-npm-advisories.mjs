import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FINDING_FIELDS = [
  "source", "url", "title", "advisoryPackage", "advisoryRange",
  "affectedPackage", "affectedRange", "node", "severity", "fixAvailable",
];
const METADATA_FIELDS = [
  "classification", "reachabilityRationale", "remediation", "reviewer",
  "reviewedAt", "expiresAt",
];
const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 };
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

const findingKey = (value) => canonicalJson(Object.fromEntries(FINDING_FIELDS.map((field) => [field, value[field]])));
const normalizeFix = (value) => value === true || value === false
  ? value
  : value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(canonicalJson(value))
    : null;

export function flattenAudit(report) {
  if (report?.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)) {
    throw new Error("npm audit report must use v2 vulnerabilities");
  }
  const findings = [];
  const visit = (affectedName, record, node, via, stack) => {
    if (typeof via === "string") {
      if (stack.includes(via)) throw new Error(`npm audit via cycle: ${[...stack, via].join(" -> ")}`);
      const next = report.vulnerabilities[via];
      if (!next) throw new Error(`npm audit references missing vulnerability ${via}`);
      if (!Array.isArray(next.via)) throw new Error(`malformed npm audit vulnerability ${via}`);
      for (const child of next.via) visit(affectedName, record, node, child, [...stack, via]);
      return;
    }
    if (!via || typeof via !== "object" || Array.isArray(via) || via.source === undefined || typeof via.url !== "string") {
      throw new Error("unsupported npm audit via member");
    }
    const leafSeverity = String(via.severity);
    const affectedSeverity = String(record.severity);
    if (!(leafSeverity in SEVERITY_RANK) || !(affectedSeverity in SEVERITY_RANK)) throw new Error("unsupported npm audit severity");
    const severity = SEVERITY_RANK[leafSeverity] >= SEVERITY_RANK[affectedSeverity] ? leafSeverity : affectedSeverity;
    findings.push({
      source: String(via.source),
      url: via.url,
      title: String(via.title),
      advisoryPackage: String(via.name ?? affectedName),
      advisoryRange: String(via.range ?? ""),
      affectedPackage: affectedName,
      affectedRange: String(record.range ?? ""),
      node,
      severity,
      fixAvailable: normalizeFix(record.fixAvailable),
    });
  };
  for (const name of Object.keys(report.vulnerabilities).sort()) {
    const record = report.vulnerabilities[name];
    if (!record || typeof record !== "object" || !Array.isArray(record.nodes) || !Array.isArray(record.via)) {
      throw new Error(`malformed npm audit vulnerability ${name}`);
    }
    for (const node of [...record.nodes].sort()) {
      if (typeof node !== "string") throw new Error(`malformed npm audit node for ${name}`);
      for (const via of record.via) visit(name, record, node, via, [name]);
    }
  }
  const unique = new Map(findings.map((item) => [findingKey(item), item]));
  return [...unique.values()].sort((a, b) => findingKey(a) < findingKey(b) ? -1 : findingKey(a) > findingKey(b) ? 1 : 0);
}

export function classifyAudits(production, full) {
  const productionFindings = flattenAudit(production);
  const allFindings = flattenAudit(full);
  const allKeys = new Set(allFindings.map(findingKey));
  for (const item of productionFindings) {
    if (!allKeys.has(findingKey(item))) throw new Error("production audit finding is absent from full audit");
  }
  const productionKeys = new Set(productionFindings.map(findingKey));
  return allFindings.map((item) => ({
    ...item,
    classification: productionKeys.has(findingKey(item)) ? "production" : "development-only",
  }));
}

function parseInstant(value, field) {
  if (typeof value !== "string" || !CANONICAL_INSTANT.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be a canonical millisecond UTC timestamp`);
  }
  return Date.parse(value);
}

export function enforceAdvisoryPolicy(findings, allowlist, now = new Date()) {
  if (!allowlist || allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.exceptions)) throw new Error("invalid advisory allowlist schema");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid advisory policy clock");
  const entries = new Map();
  for (const [index, entry] of allowlist.exceptions.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`invalid advisory exception ${index}`);
    const expected = [...FINDING_FIELDS, ...METADATA_FIELDS].sort();
    const actual = Object.keys(entry).sort();
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`advisory exception ${index} has missing or unknown fields`);
    if (!["production", "development-only"].includes(entry.classification)) throw new Error(`advisory exception ${index} has invalid classification`);
    for (const field of ["reachabilityRationale", "remediation", "reviewer"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") throw new Error(`advisory exception ${index} requires ${field}`);
    }
    const reviewed = parseInstant(entry.reviewedAt, `exceptions[${index}].reviewedAt`);
    const expires = parseInstant(entry.expiresAt, `exceptions[${index}].expiresAt`);
    if (reviewed > nowMs) throw new Error(`advisory exception ${index} was reviewed in the future`);
    if (nowMs >= expires) throw new Error(`advisory exception ${index} is expired`);
    if (reviewed >= expires) throw new Error(`advisory exception ${index} has a nonpositive review window`);
    const key = findingKey(entry);
    if (entries.has(key)) throw new Error(`duplicate advisory exception ${index}`);
    entries.set(key, entry);
  }

  const severe = findings.filter((item) => item.classification === "production" && ["high", "critical"].includes(item.severity));
  if (severe.length) throw new Error(`${severe.length} high/critical production npm advisory finding(s)`);

  const unmatched = [];
  for (const item of findings) {
    const key = findingKey(item);
    const entry = entries.get(key);
    if (!entry || entry.classification !== item.classification) unmatched.push(item);
    else entries.delete(key);
  }
  if (unmatched.length) {
    const error = new Error(`${unmatched.length} unallowlisted npm advisory finding(s)`);
    error.findings = unmatched;
    throw error;
  }
  if (entries.size) throw new Error(`${entries.size} unused or stale advisory exception(s)`);
  return { findings: findings.length, production: findings.filter((item) => item.classification === "production").length };
}

export function runAudit(args, spawn = spawnSync) {
  const result = spawn("npm", ["audit", ...args, "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(result.stderr || `npm audit exited ${result.status}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("npm audit returned invalid JSON"); }
}

export function runLivePolicy({ spawn = spawnSync, now = new Date(), root = resolve(fileURLToPath(new URL("../..", import.meta.url))) } = {}) {
  const findings = classifyAudits(runAudit(["--omit=dev"], spawn), runAudit([], spawn));
  const allowlist = JSON.parse(readFileSync(resolve(root, "tools/release/advisory-allowlist.json"), "utf8"));
  return { findings, summary: enforceAdvisoryPolicy(findings, allowlist, now) };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const { findings, summary } = runLivePolicy();
    console.log(`advisories: ${summary.findings} classified finding(s), ${summary.production} production; policy passed`);
    if (findings.length) console.log(`advisories: all ${findings.length} finding(s) have exact, current review records`);
  } catch (error) {
    for (const item of error?.findings ?? []) console.error(`advisories: unallowlisted ${canonicalJson(item)}`);
    console.error(`advisories: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
