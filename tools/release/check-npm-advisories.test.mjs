import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, classifyAudits, enforceAdvisoryPolicy, flattenAudit, runAudit } from "./check-npm-advisories.mjs";

const clean = { auditReportVersion: 2, vulnerabilities: {} };
const leaf = (overrides = {}) => ({ source: 7, name: "a", title: "bad", url: "https://example.test/7", severity: "moderate", range: "<1", ...overrides });
const vulnerable = (overrides = {}) => ({ severity: "high", range: "<2", nodes: ["node_modules/a"], fixAvailable: false, via: [leaf()], ...overrides });
const report = (record = vulnerable()) => ({ auditReportVersion: 2, vulnerabilities: { a: record } });
const finding = { source: "7", url: "https://example.test/7", title: "bad", advisoryPackage: "a", advisoryRange: "<1", affectedPackage: "a", affectedRange: "<2", node: "node_modules/a", severity: "high", fixAvailable: false, classification: "development-only" };
const exception = (overrides = {}) => ({ ...finding, reachabilityRationale: "Only test tooling reaches this node.", remediation: "Upgrade when upstream publishes a compatible fix.", reviewer: "release-owner", reviewedAt: "2026-09-03T00:00:00.000Z", expiresAt: "2026-10-03T00:00:00.000Z", ...overrides });
const policy = (exceptions = []) => ({ schemaVersion: 1, exceptions });
const now = new Date("2026-09-04T00:00:00.000Z");

test("canonical JSON retains and recursively orders nested fix metadata", () => {
  assert.equal(canonicalJson({ z: { y: 1, a: 2 }, a: 0 }), '{"a":0,"z":{"a":2,"y":1}}');
});
test("clean npm v2 reports flatten and classify deterministically", () => assert.deepEqual(classifyAudits(clean, clean), []));
test("leaf findings retain affected node, nested fix detail, and conservative severity", () => {
  const input = report(vulnerable({ fixAvailable: { name: "a", version: "2.0.0", isSemVerMajor: true } }));
  assert.deepEqual(flattenAudit(input), [{ ...finding, fixAvailable: { isSemVerMajor: true, name: "a", version: "2.0.0" }, classification: undefined }].map(({ classification, ...item }) => item));
});
test("object/string via graphs preserve every node and leaf while deduplicating identical reachability", () => {
  const input = { auditReportVersion: 2, vulnerabilities: {
    a: { ...vulnerable(), nodes: ["z", "a"], via: ["b", leaf()] },
    b: { ...vulnerable({ nodes: [], via: [leaf(), leaf({ source: 8, url: "https://example.test/8", title: "other" })] }) },
  } };
  const flattened = flattenAudit(input);
  assert.equal(flattened.length, 4);
  assert.deepEqual(new Set(flattened.map((item) => item.node)), new Set(["a", "z"]));
  assert.deepEqual(new Set(flattened.map((item) => item.source)), new Set(["7", "8"]));
});
test("production classification is exact per install-node finding", () => {
  const full = report(vulnerable({ nodes: ["node_modules/a", "node_modules/tool/node_modules/a"] }));
  const result = classifyAudits(report(), full);
  assert.equal(result.find((item) => item.node === "node_modules/a").classification, "production");
  assert.equal(result.find((item) => item.node.includes("tool/")).classification, "development-only");
  assert.throws(() => classifyAudits(report(vulnerable({ range: "<3" })), full), /absent/);
});
test("malformed, missing, cyclic, and unknown-severity reports fail closed", () => {
  assert.throws(() => flattenAudit({}), /v2/);
  assert.throws(() => flattenAudit({ auditReportVersion: 2, vulnerabilities: { a: { ...vulnerable(), via: ["missing"] } } }), /missing/);
  assert.throws(() => flattenAudit({ auditReportVersion: 2, vulnerabilities: { a: { ...vulnerable(), via: ["b"] }, b: { ...vulnerable(), nodes: [], via: ["a"] } } }), /cycle/);
  assert.throws(() => flattenAudit(report(vulnerable({ severity: "mystery" }))), /severity/);
  assert.throws(() => flattenAudit(report(vulnerable({ via: [42] }))), /unsupported/);
});
test("policy accepts a clean report and one exact, current development exception", () => {
  assert.deepEqual(enforceAdvisoryPolicy([], policy(), now), { findings: 0, production: 0 });
  assert.deepEqual(enforceAdvisoryPolicy([finding], policy([exception()]), now), { findings: 1, production: 0 });
});
test("production high or critical is unconditional and low production needs exact review", () => {
  assert.throws(() => enforceAdvisoryPolicy([{ ...finding, classification: "production" }], policy([exception({ classification: "production" })]), now), /high\/critical/);
  const low = { ...finding, severity: "low", classification: "production" };
  assert.equal(enforceAdvisoryPolicy([low], policy([exception({ severity: "low", classification: "production" })]), now).production, 1);
});
test("policy rejects changed, duplicate, unused, unknown, and partial entries", () => {
  assert.throws(() => enforceAdvisoryPolicy([finding], policy(), now), /unallowlisted/);
  assert.throws(() => enforceAdvisoryPolicy([], policy([exception()]), now), /unused/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception(), exception()]), now), /duplicate/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception({ title: "changed" })]), now), /unallowlisted/);
  const { reviewer, ...partial } = exception();
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([partial]), now), /missing or unknown/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([{ ...exception(), surprise: true }]), now), /missing or unknown/);
});
test("policy enforces canonical, bounded review timestamps with equality expired", () => {
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception({ reviewedAt: "2026-09-05T00:00:00.000Z" })]), now), /future/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception({ expiresAt: now.toISOString() })]), now), /expired/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception({ reviewedAt: "2026-09-03T00:00:00Z" })]), now), /canonical/);
  assert.throws(() => enforceAdvisoryPolicy([finding], policy([exception({ reachabilityRationale: " " })]), now), /requires/);
});
test("audit runner accepts npm exits zero/one and fails closed otherwise", () => {
  for (const status of [0, 1]) assert.deepEqual(runAudit([], () => ({ status, stdout: JSON.stringify(clean), stderr: "" })), clean);
  assert.throws(() => runAudit([], () => ({ status: 2, stdout: "{}", stderr: "network failure" })), /network failure/);
  assert.throws(() => runAudit([], () => ({ status: 0, stdout: "not json", stderr: "" })), /invalid JSON/);
  assert.throws(() => runAudit([], () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn failed") })), /spawn failed/);
});
