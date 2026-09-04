import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fromMarkdown } from "mdast-util-from-markdown";

const root = fileURLToPath(new URL("../..", import.meta.url));
const packages = [
  "core",
  "interchange",
  "data",
  "compliance",
  "agents",
] as const;
const design =
  "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md";
export interface PublicSnippet {
  path: string;
  ordinal: number;
  language: string;
  source: string;
}
interface Recipe {
  setup: readonly string[];
  assert: string;
}
const diagnosticSetup = [
  "measures",
  "countPopulations",
  "exposureBases",
  "amountBases",
  "reviewRules",
  "periodAxis",
];
const compiledAssertion =
  "assert.equal(compiled.definition.instances.length, 22); assert.ok(compiled.definitionIntegrity.length > 10);";
const outcomeAssertion =
  'assert.equal(outcome.status, "completed"); if (outcome.status === "completed") assert.equal(outcome.result.emergence[0]!.metrics["casualty/count/reported-frequency"]!.calculation.value, 0.2);';
const recipes: Record<string, Recipe> = {
  "README.md#1": {
    setup: ["claims", "metadata", "methods", "ledger", "generatedAt"],
    assert:
      "assert.equal(cl.rows.length, 5); assert.ok(Number.isFinite(mack.totals.standardError)); assert.ok(markdown.length > 100); assert.ok(dist);",
  },
  "packages/core/README.md#2": {
    setup: ["claimSnapshots"],
    assert:
      "assert.equal(chainLadder.rows.length, 5); assert.ok(Number.isFinite(mack.totals.standardError));",
  },
  "packages/core/README.md#3": {
    setup: [...diagnosticSetup, "losses", "exposures"],
    assert: `${compiledAssertion} assert.equal(result.emergence.length, 1); assert.equal(result.emergence[0]!.metrics["casualty/count/reported-frequency"]!.calculation.value, 0.2);`,
  },
  "packages/data/README.md#2": {
    setup: ["definition"],
    assert: outcomeAssertion,
  },
  "packages/interchange/README.md#2": {
    setup: ["compiledDefinition"],
    assert:
      "assert.equal(executable.definition.definitionIntegrity, compiledDefinition.definitionIntegrity); assert.ok(generic);",
  },
  "packages/compliance/README.md#2": {
    setup: [
      "outcome",
      "lossRunBytes",
      "exposureBytes",
      "archiveSha256",
      "transformCommit",
      "inputs",
      "parameters",
    ],
    assert: "assert.ok(provenance.runFingerprint); assert.ok(bundle);",
  },
  "packages/agents/README.md#2": {
    setup: ["compiledDefinition", "runApprovedPreset"],
    assert:
      'const response = await tool.execute({runPresetId:"annual-review-v1",instanceIds:["casualty/count/reported-frequency"],view:"emergence"},{requestContext:{get:()=>"documentation-tenant"}}); assert.equal(response.success, true);',
  },
  "docs/migrations/0.6-generalized-diagnostics.md#2": {
    setup: diagnosticSetup,
    assert: compiledAssertion,
  },
  "docs/migrations/0.6-generalized-diagnostics.md#3": {
    setup: ["definition"],
    assert: outcomeAssertion,
  },
  "docs/migrations/0.6-generalized-diagnostics.md#4": {
    setup: [
      "outcome",
      "lossRunBytes",
      "exposureBytes",
      "compiledDefinition as compiled",
      "transformCommit",
    ],
    assert:
      'assert.ok(provenance.runFingerprint); assert.equal(portableDefinition.kind, "diagnostic-definition");',
  },
};

/** No default TypeScript exemption: new examples require a reviewed recipe. */
export function snippetPolicy(
  snippet: Pick<PublicSnippet, "path" | "ordinal" | "language">,
): { classification: string; reason: string } {
  const key = `${snippet.path}#${snippet.ordinal}`;
  if (["ts", "typescript"].includes(snippet.language)) {
    if (recipes[key])
      return {
        classification: "packed-executable",
        reason:
          "Exact extracted source is typechecked and executed against five installed SDK tarballs with explicit checked host setup and output assertions.",
      };
    if (snippet.path === design)
      return {
        classification: [6, 7, 8].includes(snippet.ordinal)
          ? "packed-mixed-contract"
          : "packed-declaration-contract",
        reason:
          "Exact declaration nodes compile with explicit public dependencies and structural public-type checks; executable nodes additionally run against installed tarballs. Type declarations are not claimed as runtime execution.",
      };
    if (key === "packages/agents/README.md#3")
      return {
        classification: "packed-declaration-contract",
        reason:
          "The model-visible input shape compiles and is compared with the packed public type (allowing caller-owned mutable arrays).",
      };
    throw new Error(`Unregistered TypeScript documentation fence ${key}`);
  }
  if (["python", "py"].includes(snippet.language))
    return {
      classification: "executed-python",
      reason:
        "Exact extracted Python source executes under the provisioned Python interop environment.",
    };
  if (["bash", "sh"].includes(snippet.language))
    return {
      classification: "syntax-only-operational",
      reason:
        "Operational install, configuration, and publication commands receive shell syntax checks only; documentation verification must never perform their side effects.",
    };
  if (["json", "jsonc", "yaml", "yml"].includes(snippet.language))
    return {
      classification: "parsed-configuration",
      reason:
        "Configuration or serialized examples are parsed with their actual language parser, not executed.",
    };
  if (["js", "javascript", "r"].includes(snippet.language))
    throw new Error(
      `Executable fence requires an explicit execution recipe: ${key}`,
    );
  return {
    classification: "reviewed-illustrative",
    reason: "Non-executable output, diagram, or prose example.",
  };
}

export function extractSnippets(
  path: string,
  markdown: string,
): PublicSnippet[] {
  const result: PublicSnippet[] = [];
  let ordinal = 0;
  const walk = (node: {
    type: string;
    value?: string;
    lang?: string | null;
    children?: (typeof node)[];
  }): void => {
    if (node.type === "code")
      result.push({
        path,
        ordinal: ++ordinal,
        language: (node.lang ?? "text").toLowerCase(),
        source: node.value ?? "",
      });
    for (const child of node.children ?? []) walk(child);
  };
  walk(fromMarkdown(markdown));
  return result;
}

export interface PackedSnippetEnvironment {
  directory: string;
  cleanup(): void;
}
export function createPackedSnippetEnvironment(): PackedSnippetEnvironment {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "actuarial-doc-snippets-")),
  );
  try {
    const tarballs: string[] = [];
    for (const name of packages) {
      const result = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            "-w",
            `@actuarial-ts/${name}`,
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            directory,
          ],
          { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        ),
      );
      if (result.length !== 1)
        throw new Error(`Expected one packed ${name} package`);
      tarballs.push(join(directory, result[0].filename));
    }
    const lock = JSON.parse(
      readFileSync(join(root, "package-lock.json"), "utf8"),
    );
    const external = ["zod", "@mastra/core", "@mastra/mcp", "@types/node"].map(
      (name) => `${name}@${lock.packages[`node_modules/${name}`].version}`,
    );
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "public-documentation-consumer",
        private: true,
        type: "module",
      }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        ...tarballs,
        ...external,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
      },
    );
    for (const name of packages) {
      const installed = realpathSync(
        join(directory, "node_modules/@actuarial-ts", name),
      );
      if (!installed.startsWith(`${directory}/`))
        throw new Error(
          `Packed ${name} resolved outside the isolated consumer`,
        );
    }
    copyFileSync(
      join(root, "tools/docs/fixtures/public-snippet-setup.mts"),
      join(directory, "setup.mts"),
    );
    return {
      directory,
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function exportsByName(directory: string): Map<string, string> {
  const entrypoints = packages.map((name) =>
    join(directory, `node_modules/@actuarial-ts/${name}/dist/index.d.ts`),
  );
  const program = ts.createProgram(entrypoints, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const found = new Map<string, string>();
  for (let i = 0; i < entrypoints.length; i++) {
    const source = program.getSourceFile(entrypoints[i]!)!;
    const symbol = checker.getSymbolAtLocation(source)!;
    for (const item of checker.getExportsOfModule(symbol))
      if (!found.has(item.name)) found.set(item.name, packages[i]!);
  }
  return found;
}

function specModules(
  snippets: readonly PublicSnippet[],
  exports: Map<string, string>,
): Map<string, string> {
  const declarations: string[] = [];
  const declared = new Set<string>();
  const comparable: string[] = [];
  const comparableFunctions = new Set<string>();
  const runtime: string[] = [];
  for (const snippet of snippets) {
    const ast = ts.createSourceFile(
      `${snippet.ordinal}.ts`,
      snippet.source,
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of ast.statements) {
      if (
        ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const names = ts.isVariableStatement(node)
          ? node.declarationList.declarations.map((item) =>
              item.name.getText(ast),
            )
          : "name" in node && node.name && ts.isIdentifier(node.name as ts.Node)
            ? [(node.name as ts.Identifier).text]
            : [];
        for (const name of names)
          if (!exports.has(name))
            throw new Error(
              `Normative exported declaration ${name} has no packed public export (${snippet.path} fence ${snippet.ordinal})`,
            );
      }
      if (ts.isExpressionStatement(node)) {
        runtime.push(node.getText(ast));
        continue;
      }
      if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) => item.initializer)
      ) {
        runtime.push(node.getText(ast));
        for (const item of node.declarationList.declarations) {
          const name = item.name.getText(ast);
          declared.add(name);
          const owner = exports.get(name);
          if (!owner)
            throw new Error(`No packed export for normative value ${name}`);
          declarations.push(
            `export declare const ${name}: typeof import("@actuarial-ts/${owner}").${name};`,
          );
        }
        continue;
      }
      declarations.push(node.getText(ast));
      if (
        (ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name
      ) {
        const name = node.name.text;
        declared.add(name);
        if (
          (ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node)) &&
          !node.typeParameters?.length &&
          exports.has(name) &&
          node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          )
        )
          comparable.push(name);
        if (
          ts.isFunctionDeclaration(node) &&
          !node.typeParameters?.length &&
          exports.has(name)
        )
          comparableFunctions.add(name);
      }
      if (ts.isVariableStatement(node))
        for (const item of node.declarationList.declarations)
          declared.add(item.name.getText(ast));
    }
  }
  const imports = [...exports]
    .filter(([name]) => !declared.has(name))
    .map(
      ([name, owner]) =>
        `import type { ${name} } from "@actuarial-ts/${owner}";`,
    )
    .join("\n");
  const prelude = `${imports}\nimport type { Tool } from "@mastra/core/tools";\nimport type { z } from "zod";\nimport type { JsonValue as CoreDiagnosticJsonValue } from "@actuarial-ts/core";\n`;
  const checks = comparable
    .map(
      (name) =>
        `declare const documented_${name}: Shape<Doc.${name}>; declare const public_${name}: Shape<import("@actuarial-ts/${exports.get(name)}").${name}>;\ntype keys_${name} = AssertNoKeys<DifferentRootKeys<typeof documented_${name}, typeof public_${name}>>;\nconst forward_${name}: typeof public_${name} = documented_${name}; const backward_${name}: typeof documented_${name} = public_${name};`,
    )
    .join("\n");
  const functionChecks = [...comparableFunctions]
    .map(
      (name) =>
        `declare const documented_${name}: Shape<typeof Doc.${name}>; declare const public_${name}: Shape<typeof import("@actuarial-ts/${exports.get(name)}").${name}>;\nconst forward_${name}: typeof public_${name} = documented_${name}; const backward_${name}: typeof documented_${name} = public_${name};`,
    )
    .join("\n");
  const runtimeSource = `import assert from "node:assert/strict";\nimport { createCasualtyMetricInstances } from "@actuarial-ts/core";\nimport type { DiagnosticFormulaTemplate } from "@actuarial-ts/core";\n${runtime.join("\n")}\nimport * as actual from "@actuarial-ts/core";\nassert.deepEqual(CASUALTY_FORMULA_TEMPLATES, actual.CASUALTY_FORMULA_TEMPLATES);\nassert.equal(MAX_DIAGNOSTIC_EXPRESSION_DEPTH, actual.MAX_DIAGNOSTIC_EXPRESSION_DEPTH);\nassert.equal(MAX_DIAGNOSTIC_EXPRESSION_NODES, actual.MAX_DIAGNOSTIC_EXPRESSION_NODES);\nassert.equal(MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES, actual.MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES);`;
  return new Map([
    ["normative.d.ts", prelude + declarations.join("\n")],
    [
      "normative-check.mts",
      `import type * as Doc from "./normative.js";\n${typeComparison}\n${checks}\n${functionChecks}`,
    ],
    ["normative-runtime.mts", runtimeSource],
  ]);
}

// Brands are internal authentication tokens, not independently reproducible
// documentation symbols. Compare recursively after removing only symbol keys.
// Mutable documentation arrays are valid caller inputs to readonly public arrays.
const typeComparison = `
type Shape<T> = T extends (...args: infer A) => infer R ? (...args: { [K in keyof A]: Shape<A[K]> }) => Shape<R> :
  T extends readonly (infer V)[] ? readonly Shape<V>[] :
  T extends object ? { [K in keyof T as K extends symbol ? never : K]: Shape<T[K]> } : T;
type Equivalent<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
// Distribute over unions so an optional field on only one variant is included.
type RootKeys<T> = T extends unknown ? Exclude<keyof T, symbol> : never;
type DifferentRootKeys<A, B> = Exclude<RootKeys<A>, RootKeys<B>> | Exclude<RootKeys<B>, RootKeys<A>>;
type AssertNoKeys<T extends never> = T;
type Assert<T extends true> = T;
`;

export function verifyPackedSnippets(
  environment: PackedSnippetEnvironment,
  snippets: readonly PublicSnippet[],
): { executable: number; declarations: number } {
  const selected = snippets.filter((snippet) =>
    ["ts", "typescript"].includes(snippet.language),
  );
  for (const snippet of selected) snippetPolicy(snippet);
  const modules = new Map<string, string>();
  const contracts = selected.filter((snippet) => snippet.path === design);
  if (contracts.length)
    for (const [name, source] of specModules(
      contracts,
      exportsByName(environment.directory),
    ))
      modules.set(name, source);
  for (const snippet of selected.filter((snippet) => snippet.path !== design)) {
    const recipe = recipes[`${snippet.path}#${snippet.ordinal}`];
    const name = `${snippet.path.replaceAll(/[^a-zA-Z0-9]/g, "-")}-${snippet.ordinal}.mts`;
    if (recipe)
      modules.set(
        name,
        `import assert from "node:assert/strict";\nimport { ${recipe.setup.join(", ")} } from "./setup.mjs";\n// Extracted from ${snippet.path}, fence ${snippet.ordinal}.\n${snippet.source}\n${recipe.assert}\n`,
      );
    else
      modules.set(
        name,
        `${snippet.source}\n${typeComparison}\ntype Check = Assert<Equivalent<Shape<DiagnosticAgentToolInput>, Shape<import("@actuarial-ts/agents").DiagnosticAgentToolInput>>>;\ntype KeysCheck = AssertNoKeys<DifferentRootKeys<Shape<DiagnosticAgentToolInput>, Shape<import("@actuarial-ts/agents").DiagnosticAgentToolInput>>>;\nexport {};`,
      );
  }
  const files: string[] = [join(environment.directory, "setup.mts")];
  for (const [name, source] of modules) {
    const path = join(environment.directory, name);
    writeFileSync(path, source);
    files.push(path);
  }
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: false,
    outDir: join(environment.directory, "output"),
    types: ["node"],
    typeRoots: [join(environment.directory, "node_modules/@types")],
  });
  const diagnostics = files.flatMap((file) => {
    const source = program.getSourceFile(file)!;
    return [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
  });
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => environment.directory,
        getNewLine: () => "\n",
      }),
    );
  program.emit();
  for (const [name] of modules) {
    if (
      name.endsWith(".d.ts") ||
      name === "normative-check.mts" ||
      name === "packages-agents-README-md-3.mts"
    )
      continue;
    execFileSync(
      process.execPath,
      [join(environment.directory, "output", name.replace(/\.mts$/, ".mjs"))],
      {
        cwd: environment.directory,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  }
  return {
    executable: selected.filter(
      (snippet) =>
        snippetPolicy(snippet).classification.includes("executable") ||
        snippetPolicy(snippet).classification === "packed-mixed-contract",
    ).length,
    declarations: selected.filter((snippet) =>
      snippetPolicy(snippet).classification.includes("contract"),
    ).length,
  };
}
