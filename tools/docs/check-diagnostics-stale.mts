import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

interface EntryGroup { category: string; match: "whole-identifier" | "exact-string-token"; values: string[] }
interface Allow { path: string; entry: string; line: string; count: number; reason: string }
interface Config { schemaVersion: number; entries: EntryGroup[]; historicalPaths: { prefix: string; reason: string }[]; allowlist: Allow[] }

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const config = JSON.parse(readFileSync(resolve(root, "tools/docs/diagnostics-legacy-denylist.json"), "utf8")) as Config;
const requested = (process.argv.find((arg) => arg.startsWith("--scope="))?.slice(8) ?? "source,declarations,tracked-docs").split(",");
const valid = new Set(["source", "declarations", "tracked-docs"]);
if (requested.some((scope) => !valid.has(scope))) throw new Error(`Unknown scope: ${requested.join(",")}`);

function filesUnder(path: string, suffixes: readonly string[]): string[] {
  const absolute = resolve(root, path);
  const result: string[] = [];
  for (const name of readdirSync(absolute)) {
    const child = resolve(absolute, name);
    if (statSync(child).isDirectory()) result.push(...filesUnder(relative(root, child), suffixes));
    else if (suffixes.some((suffix) => child.endsWith(suffix))) result.push(relative(root, child));
  }
  return result;
}

const paths = new Set<string>();
if (requested.includes("source")) {
  for (const area of ["packages", "examples"]) {
    for (const path of filesUnder(area, [".ts", ".mts", ".json"])) if (path.includes("/src/") || path.endsWith("package.json")) paths.add(path);
  }
}
if (requested.includes("declarations")) {
  for (const packageName of ["core", "data", "interchange", "compliance", "agents"]) paths.add(`packages/${packageName}/dist/index.d.ts`);
}
if (requested.includes("tracked-docs")) {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md", "*.mdx"], { cwd: root, encoding: "utf8" });
  for (const path of listed.trim().split("\n").filter(Boolean)) paths.add(path);
}

const failures: string[] = [];
const used = new Map<Allow, number>();
for (const path of [...paths].sort()) {
  if (config.historicalPaths.some((entry) => path.startsWith(entry.prefix) && entry.reason.trim())) continue;
  const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/);
  for (const group of config.entries) for (const value of group.values) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = group.match === "whole-identifier"
      ? new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?=$|[^A-Za-z0-9_$])`, "g")
      : new RegExp(`(^|[\\s\u0060\"'])${escaped}(?=$|[\\s\u0060\"'.,:;!?()[\\]{}])`, "g");
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        const allowed = config.allowlist.find((item) => item.path === path && item.entry === value && item.line === line && item.reason.trim().length > 0);
        if (allowed) used.set(allowed, (used.get(allowed) ?? 0) + 1);
        else failures.push(`${path}:${index + 1}: ${group.category} ${value}`);
      }
      pattern.lastIndex = 0;
    });
  }
}
for (const item of config.allowlist) {
  const count = used.get(item) ?? 0;
  if (paths.has(item.path) && count !== item.count) failures.push(`${item.path}: stale allowlist for ${item.entry}; expected ${item.count}, used ${count}`);
}
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`diagnostics-legacy: ${failure}`));
  process.exitCode = 1;
} else console.log(`diagnostics-legacy: clean (${requested.join(",")})`);
