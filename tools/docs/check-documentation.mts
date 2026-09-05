import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parseDocument } from "yaml";
import ts from "typescript";
import {
  createPackedSnippetEnvironment,
  snippetPolicy,
  verifyPackedSnippets,
} from "./packed-snippets.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sdkVersion = (
  JSON.parse(readFileSync(resolve(root, "packages/core/package.json"), "utf8")) as {
    version: string;
  }
).version;
const inventoryPath = resolve(root, "tools/docs/documentation-inventory.json");
const snippetsPath = resolve(root, "tools/docs/public-snippet-manifest.json");
const mode =
  process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) ?? "base";
const docs = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "*.md",
    "*.mdx",
  ],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
const PUBLIC_LANGUAGES = new Set([
  "ts",
  "typescript",
  "js",
  "javascript",
  "json",
  "jsonc",
  "bash",
  "sh",
  "python",
  "py",
  "r",
  "yaml",
  "yml",
]);
const SDK_PACKAGES = ["core", "data", "interchange", "compliance", "agents"];
const SHIPPED_DIAGNOSTICS_DESIGN =
  "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md";
const COMPLETED_DIAGNOSTICS_PLAN =
  "docs/superpowers/plans/2026-09-03-generalized-diagnostics-sdk.md";

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  url?: string;
  identifier?: string;
  children?: MdNode[];
};
function nodeText(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(nodeText).join("");
}
function walk(node: MdNode, visit: (node: MdNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function ownership(path: string): string[] {
  const packageMatch = path.match(/^packages\/([^/]+)\//);
  if (packageMatch && SDK_PACKAGES.includes(packageMatch[1]!))
    return [packageMatch[1]!];
  if (
    path.startsWith("interop/") ||
    path.startsWith("schema/interchange/") ||
    path.startsWith("tools/interop/")
  )
    return ["interchange"];
  if (path.startsWith("examples/")) return SDK_PACKAGES;
  return SDK_PACKAGES;
}
function classification(path: string) {
  if (path === SHIPPED_DIAGNOSTICS_DESIGN)
    return {
      classification: "active",
      reason: "Retained diagnostics baseline, corrected in 0.6.1 and supplemented by the active 0.7 compact adoption and replay guides.",
      packages: SDK_PACKAGES,
    };
  if (
    path.startsWith("docs/superpowers/") ||
    path.startsWith("docs/research/") ||
    path.includes("/test/fixtures/")
  )
    return {
      classification: "historical-snapshot",
      reason: "Dated design, research, or immutable fixture record.",
      packages: [] as string[],
    };
  return {
    classification: "active",
    reason: "Current repository, package, example, or operator documentation.",
    packages: ownership(path),
  };
}

interface Fence {
  path: string;
  heading: string;
  language: string;
  ordinal: number;
  sha256: string;
  classification: string;
  reason: string;
}
function parsed(
  path: string,
  text: string,
): { fences: Fence[]; sources: Map<number, string>; links: string[] } {
  const tree = fromMarkdown(text) as MdNode;
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
  });
  const result: Fence[] = [];
  const sources = new Map<number, string>();
  const links: string[] = [];
  let heading = "(document)";
  let ordinal = 0;
  walk(tree, (node) => {
    if (node.type === "heading") heading = nodeText(node);
    if (node.type === "link" || node.type === "image") {
      if (node.url) links.push(node.url);
    }
    if (node.type === "linkReference" || node.type === "imageReference") {
      const url = definitions.get(node.identifier?.toLowerCase() ?? "");
      if (url) links.push(url);
    }
    if (node.type !== "code") return;
    ordinal += 1;
    const language = (node.lang ?? "text").toLowerCase();
    const source = node.value ?? "";
    const isPublic = PUBLIC_LANGUAGES.has(language);
    const policy =
      classification(path).classification === "active"
        ? snippetPolicy({ path, ordinal, language })
        : {
            classification: isPublic
              ? "reviewed-public"
              : "reviewed-illustrative",
            reason: "Historical fence retained as a dated source record.",
          };
    result.push({
      path,
      heading,
      language,
      ordinal,
      sha256: hash(source),
      ...policy,
    });
    sources.set(ordinal, source);
  });
  return { fences: result, sources, links };
}

function caseSensitiveExists(path: string): boolean {
  const rel = relative(root, path);
  if (rel === "" || rel === ".") return true;
  if (rel.startsWith(`..${sep}`) || rel === "..") return false;
  let current = root;
  for (const part of rel.split(sep)) {
    if (
      !existsSync(current) ||
      !statSync(current).isDirectory() ||
      !readdirSync(current).includes(part)
    )
      return false;
    current = resolve(current, part);
  }
  return existsSync(current);
}

if (process.argv.includes("--write-manifests")) {
  const inventory = Object.fromEntries(
    docs.map((path) => [path, classification(path)]),
  );
  const fences = docs.flatMap((path) =>
    inventory[path]!.classification === "active"
      ? parsed(path, readFileSync(resolve(root, path), "utf8")).fences
      : [],
  );
  writeFileSync(
    inventoryPath,
    `${JSON.stringify({ schemaVersion: 1, documents: inventory }, null, 2)}\n`,
  );
  writeFileSync(
    snippetsPath,
    `${JSON.stringify({ schemaVersion: 1, fences }, null, 2)}\n`,
  );
  console.log(
    `documentation: wrote ${docs.length} documents and ${fences.length} fence records`,
  );
  process.exit(0);
}

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
  schemaVersion: number;
  documents: Record<
    string,
    { classification: string; reason: string; packages: string[] }
  >;
};
const manifest = JSON.parse(readFileSync(snippetsPath, "utf8")) as {
  schemaVersion: number;
  fences: Fence[];
};
const failures: string[] = [];
if (inventory.schemaVersion !== 1 || manifest.schemaVersion !== 1)
  failures.push("documentation manifests require schemaVersion 1");
if (
  JSON.stringify(Object.keys(inventory.documents).sort()) !==
  JSON.stringify(docs)
)
  failures.push(
    "documentation inventory does not exactly match tracked and nonignored Markdown/MDX files",
  );
for (const [path, entry] of Object.entries(inventory.documents)) {
  if (
    !entry.reason?.trim() ||
    !["active", "historical-snapshot", "unrelated"].includes(
      entry.classification,
    )
  )
    failures.push(`${path}: invalid inventory classification`);
  if (
    !Array.isArray(entry.packages) ||
    entry.packages.some((name) => !SDK_PACKAGES.includes(name))
  )
    failures.push(`${path}: invalid package ownership`);
  if (entry.classification === "active" && entry.packages.length === 0)
    failures.push(`${path}: active document has no declared package owner`);
  if (
    classification(path).classification === "active" &&
    entry.classification !== "active"
  )
    failures.push(
      `${path}: current documentation cannot use a blanket historical exception`,
    );
  if (
    spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: root })
      .status === 0
  )
    failures.push(`${path}: inventory path is ignored by Git`);
}
if (
  inventory.documents[SHIPPED_DIAGNOSTICS_DESIGN]?.classification !== "active"
)
  failures.push(
    `${SHIPPED_DIAGNOSTICS_DESIGN}: shipped design must remain the active current contract`,
  );
if (
  inventory.documents[COMPLETED_DIAGNOSTICS_PLAN]?.classification !==
  "historical-snapshot"
)
  failures.push(
    `${COMPLETED_DIAGNOSTICS_PLAN}: completed plan must be historical`,
  );
const parsedByPath = new Map(
  docs.map((path) => [
    path,
    parsed(path, readFileSync(resolve(root, path), "utf8")),
  ]),
);
const actualFences = docs.flatMap((path) => parsedByPath.get(path)!.fences);
const activeFences = actualFences.filter(
  (entry) => inventory.documents[entry.path]?.classification === "active",
);
if (
  manifest.fences.some(
    (entry) => inventory.documents[entry.path]?.classification !== "active",
  )
)
  failures.push(
    "public snippet manifest contains an orphaned or historical fence",
  );
if (JSON.stringify(manifest.fences) !== JSON.stringify(activeFences))
  failures.push("public snippet manifest is stale; run npm run docs:manifests");

for (const path of docs) {
  if (inventory.documents[path]?.classification !== "active") continue;
  for (const destination of parsedByPath.get(path)!.links) {
    if (/^(https?:|mailto:|#)/.test(destination)) continue;
    const [rawFile, rawFragment] = destination.split("#");
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawFile!);
    } catch {
      failures.push(`${path}: malformed percent-encoding in ${destination}`);
      continue;
    }
    const target = resolve(dirname(resolve(root, path)), decoded);
    if (!caseSensitiveExists(target)) {
      failures.push(
        `${path}: missing or case-mismatched link target ${destination}`,
      );
      continue;
    }
    if (rawFragment && /\.mdx?$/.test(rawFile!)) {
      const targetTree = fromMarkdown(readFileSync(target, "utf8")) as MdNode;
      const headings: string[] = [];
      walk(targetTree, (node) => {
        if (node.type === "heading") headings.push(slug(nodeText(node)));
      });
      if (!headings.includes(decodeURIComponent(rawFragment).toLowerCase()))
        failures.push(`${path}: missing anchor ${destination}`);
    }
  }
}

for (const [path, required] of Object.entries({
  "README.md": [
    "docs/reference/diagnostic-formulas.md",
    "docs/migrations/0.6-generalized-diagnostics.md",
    "docs/migrations/0.7-compact-diagnostics.md",
    "docs/reference/diagnostic-replay-stream.md",
  ],
  "docs/README.md": [
    "reference/diagnostic-formulas.md",
    "migrations/0.6-generalized-diagnostics.md",
    "migrations/0.7-compact-diagnostics.md",
    "reference/diagnostic-replay-stream.md",
  ],
  "CHANGELOG.md": [
    "docs/reference/diagnostic-formulas.md",
    "docs/migrations/0.6-generalized-diagnostics.md",
    "docs/migrations/0.7-compact-diagnostics.md",
    "docs/reference/diagnostic-replay-stream.md",
  ],
}))
  for (const destination of required)
    if (!readFileSync(resolve(root, path), "utf8").includes(destination))
      failures.push(`${path}: missing required inbound link to ${destination}`);
for (const packageName of SDK_PACKAGES)
  for (const required of [
    "reference/diagnostic-formulas.md",
    "migrations/0.6-generalized-diagnostics.md",
    "migrations/0.7-compact-diagnostics.md",
    "reference/diagnostic-replay-stream.md",
  ]) {
    const readme = readFileSync(
      resolve(root, `packages/${packageName}/README.md`),
      "utf8",
    );
    if (
      !readme.includes(
        `https://github.com/yerromnitsuj/actng/blob/v${sdkVersion}/docs/${required}`,
      )
    )
      failures.push(
        `packages/${packageName}/README.md: missing tagged ${required} link`,
      );
  }

function publicExports(): Map<string, Set<string>> {
  const entrypoints = SDK_PACKAGES.map((name) =>
    resolve(root, `packages/${name}/dist/index.d.ts`),
  );
  const program = ts.createProgram(entrypoints, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const result = new Map<string, Set<string>>();
  for (let index = 0; index < SDK_PACKAGES.length; index += 1) {
    const source = program.getSourceFile(entrypoints[index]!);
    const symbol = source && checker.getSymbolAtLocation(source);
    result.set(
      SDK_PACKAGES[index]!,
      new Set(
        symbol
          ? checker.getExportsOfModule(symbol).map((item) => item.name)
          : [],
      ),
    );
  }
  return result;
}
const exportsByPackage =
  mode === "base" ? publicExports() : new Map<string, Set<string>>();
function validateTypeScriptImports(fence: Fence, source: string) {
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@actuarial-ts\/(core|data|interchange|compliance|agents)["']/g,
  )) {
    for (const item of match[1]!.split(",")) {
      const name = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name && !exportsByPackage.get(match[2]!)?.has(name))
        failures.push(
          `${fence.path} fence ${fence.ordinal}: ${name} is not a public @actuarial-ts/${match[2]} export`,
        );
    }
  }
}
function checkBaseFence(fence: Fence, source: string) {
  const language = fence.language;
  if (["ts", "typescript"].includes(language)) {
    const output = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    });
    for (const diagnostic of output.diagnostics ?? [])
      if (diagnostic.category === ts.DiagnosticCategory.Error)
        failures.push(
          `${fence.path} fence ${fence.ordinal}: TypeScript syntax failed (${diagnostic.code})`,
        );
    validateTypeScriptImports(fence, source);
  } else if (["js", "javascript"].includes(language)) {
    const checked = spawnSync(process.execPath, ["--check", "-"], {
      cwd: root,
      input: source,
      encoding: "utf8",
    });
    if (checked.status !== 0)
      failures.push(
        `${fence.path} fence ${fence.ordinal}: JavaScript syntax failed`,
      );
  } else if (language === "json") {
    try {
      JSON.parse(source);
    } catch {
      failures.push(
        `${fence.path} fence ${fence.ordinal}: strict JSON parse failed`,
      );
    }
  } else if (language === "jsonc") {
    const parsed = ts.parseConfigFileTextToJson(fence.path, source);
    if (parsed.error)
      failures.push(`${fence.path} fence ${fence.ordinal}: JSONC parse failed`);
  } else if (["bash", "sh"].includes(language)) {
    const checked = spawnSync("bash", ["-n"], {
      cwd: root,
      input: source,
      encoding: "utf8",
    });
    if (checked.status !== 0)
      failures.push(
        `${fence.path} fence ${fence.ordinal}: shell syntax failed`,
      );
  } else if (["yaml", "yml"].includes(language)) {
    try {
      const result = parseDocument(source);
      if (result.errors.length) throw result.errors[0];
    } catch {
      failures.push(`${fence.path} fence ${fence.ordinal}: YAML parse failed`);
    }
  }
}

if (mode === "base") {
  const generated = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      "tools/docs/render-diagnostic-reference.mts",
      "--check",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (generated.status !== 0)
    failures.push(
      generated.stderr ||
        generated.stdout ||
        "generated formula reference is stale",
    );
  for (const fence of activeFences)
    checkBaseFence(
      fence,
      parsedByPath.get(fence.path)!.sources.get(fence.ordinal)!,
    );
  const consumer = await createPackedSnippetEnvironment();
  try {
    const checked = await verifyPackedSnippets(
      consumer,
      activeFences.map((fence) => ({
        ...fence,
        source: parsedByPath.get(fence.path)!.sources.get(fence.ordinal)!,
      })),
    );
    console.log(
      `documentation packed consumer: ${checked.executable} executable/mixed fences; ${checked.declarations} declaration/mixed fences checked`,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    consumer.cleanup();
  }
} else if (mode === "python") {
  const python = process.env.ACTUARIAL_TS_PYTHON ?? "python3";
  for (const fence of activeFences.filter((entry) =>
    ["python", "py"].includes(entry.language),
  )) {
    const checked = spawnSync(
      python,
      [
        "-c",
        `exec(compile(${JSON.stringify(parsedByPath.get(fence.path)!.sources.get(fence.ordinal))}, ${JSON.stringify(fence.path)}, 'exec'))`,
      ],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );
    if (checked.status !== 0)
      failures.push(
        `${fence.path} fence ${fence.ordinal}: Python execution failed: ${checked.stderr || checked.error?.message || "nonzero exit"}`,
      );
  }
} else if (mode === "r") {
  const rscript = process.env.ACTUARIAL_TS_RSCRIPT ?? "Rscript";
  for (const fence of activeFences.filter((entry) => entry.language === "r")) {
    const checked = spawnSync(
      rscript,
      [
        "-e",
        `parse(text=${JSON.stringify(parsedByPath.get(fence.path)!.sources.get(fence.ordinal))})`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (checked.status !== 0)
      failures.push(`${fence.path} fence ${fence.ordinal}: R syntax failed`);
  }
} else failures.push(`unknown documentation mode ${mode}`);

if (failures.length) {
  failures.forEach((failure) => console.error(`documentation: ${failure}`));
  process.exitCode = 1;
} else
  console.log(
    `documentation: ${mode} checks passed (${docs.length} documents, ${activeFences.length} active fences; ${actualFences.length} total)`,
  );
