import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parseDocument } from "yaml";
import {
  createPackedSnippetEnvironment,
  extractSnippets,
  snippetPolicy,
  verifyPackedSnippets,
  type PackedSnippetEnvironment,
  type PublicSnippet,
} from "./packed-snippets.mjs";

interface PythonWorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  if?: unknown;
  "continue-on-error"?: unknown;
}
interface PythonWorkflow {
  jobs: {
    "py-base-310": { steps: PythonWorkflowStep[] };
    "py-conformance": {
      strategy: { matrix: { "chainladder-version": string[] } };
    };
  };
}
function readPythonWorkflow(): PythonWorkflow {
  const parsed = parseDocument(
    readFileSync(".github/workflows/py-conformance.yml", "utf8"),
  );
  expect(parsed.errors).toEqual([]);
  return parsed.toJS() as PythonWorkflow;
}
function assertPythonDocumentationProvisioning(workflow: PythonWorkflow): void {
  const steps = workflow.jobs["py-base-310"].steps;
  const setup = steps.find((step) =>
    step.uses?.startsWith("actions/setup-python@"),
  );
  expect(setup?.with?.["python-version"]).toBe("3.10");
  const baseInstall = steps.findIndex(
    (step) => step.run === "python -m pip install -e interop/python pytest",
  );
  const baseProof = steps.findIndex(
    (step) =>
      step.run ===
      "pytest interop/python/tests/test_jcs.py interop/python/tests/test_documents.py interop/python/tests/test_diagnostics.py -q",
  );
  const engineInstalls = steps.flatMap((step, index) =>
    /pip\s+install[^\n]*(?:\[chainladder\]|chainladder==)/.test(step.run ?? "")
      ? [index]
      : [],
  );
  expect(baseInstall).toBeGreaterThanOrEqual(0);
  expect(baseProof).toBeGreaterThan(baseInstall);
  expect(
    engineInstalls,
    "An explicit optional-engine install must follow the dependency-free proof",
  ).toHaveLength(1);
  const engineInstall = engineInstalls[0]!;
  expect(engineInstall).toBeGreaterThan(baseProof);
  expect(
    workflow.jobs["py-conformance"].strategy.matrix["chainladder-version"],
  ).toEqual(["0.9.2"]);
  expect(steps[engineInstall]!.run).toBe(
    'python -m pip install -e "interop/python[chainladder]" "chainladder==0.9.2"',
  );
  const docs = steps.findIndex((step) => step.run === "npm run docs:check:py");
  expect(docs).toBeGreaterThan(engineInstall);
  expect(steps[docs]!.env?.ACTUARIAL_TS_PYTHON).toBe("python");
  for (const index of [baseInstall, baseProof, engineInstall, docs]) {
    expect(steps[index]!.if).toBeUndefined();
    expect(steps[index]!["continue-on-error"]).toBeUndefined();
  }
}

describe("Python 3.10 documentation provisioning", () => {
  it("proves the dependency-free base before installing the pinned engine for full executable docs", () => {
    assertPythonDocumentationProvisioning(readPythonWorkflow());
  });
  it("rejects missing, early, or unpinned provisioning and premature or conditional docs", () => {
    for (const mutation of [
      "remove-engine",
      "engine-before-base",
      "unpin-engine",
      "docs-before-engine",
      "conditional-docs",
    ]) {
      const workflow = readPythonWorkflow();
      const steps = workflow.jobs["py-base-310"].steps;
      const engineIndex = steps.findIndex((step) =>
        step.run?.includes("interop/python[chainladder]"),
      );
      const docsIndex = steps.findIndex(
        (step) => step.run === "npm run docs:check:py",
      );
      if (mutation === "remove-engine") steps.splice(engineIndex, 1);
      if (mutation === "engine-before-base")
        steps.unshift(steps.splice(engineIndex, 1)[0]!);
      if (mutation === "unpin-engine")
        steps[engineIndex]!.run =
          'python -m pip install -e "interop/python[chainladder]"';
      if (mutation === "docs-before-engine")
        steps.unshift(steps.splice(docsIndex, 1)[0]!);
      if (mutation === "conditional-docs") steps[docsIndex]!.if = "false";
      expect(
        () => assertPythonDocumentationProvisioning(workflow),
        mutation,
      ).toThrow();
    }
  });
});

describe("documentation governance artifacts", () => {
  it("inventory entries and every fence have explicit review metadata", () => {
    const inventory = JSON.parse(
      readFileSync("tools/docs/documentation-inventory.json", "utf8"),
    );
    const snippets = JSON.parse(
      readFileSync("tools/docs/public-snippet-manifest.json", "utf8"),
    );
    expect(inventory.schemaVersion).toBe(1);
    expect(snippets.schemaVersion).toBe(1);
    for (const entry of Object.values(inventory.documents) as any[]) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(entry.packages)).toBe(true);
      if (entry.classification === "active")
        expect(entry.packages.length).toBeGreaterThan(0);
    }
    for (const entry of snippets.fences) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("uses real Markdown and YAML parsers for indentation, references, and strict YAML", () => {
    const tree: any = fromMarkdown(
      "- nested\n\n  ```ts\n  const value = 1\n  ```\n\n[ref]: ./README.md\n",
    );
    const code: any[] = [];
    const walk = (node: any) => {
      if (node.type === "code") code.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    expect(code).toHaveLength(1);
    expect(code[0].value).toContain("const value");
    expect(parseDocument("value: [1, 2]").errors).toHaveLength(0);
    expect(parseDocument("value: [1, 2").errors.length).toBeGreaterThan(0);
  });
  it("keeps the shipped diagnostics contract active and its completed plan historical", () => {
    const inventory = JSON.parse(
      readFileSync("tools/docs/documentation-inventory.json", "utf8"),
    );
    const snippets = JSON.parse(
      readFileSync("tools/docs/public-snippet-manifest.json", "utf8"),
    );
    const design =
      "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md";
    const plan =
      "docs/superpowers/plans/2026-09-03-generalized-diagnostics-sdk.md";
    expect(inventory.documents[design].classification).toBe("active");
    expect(inventory.documents[design].packages).toEqual([
      "core",
      "data",
      "interchange",
      "compliance",
      "agents",
    ]);
    expect(inventory.documents[plan].classification).toBe(
      "historical-snapshot",
    );
    expect(snippets.fences.some((entry: any) => entry.path === design)).toBe(
      true,
    );
    expect(snippets.fences.some((entry: any) => entry.path === plan)).toBe(
      false,
    );
    for (const entry of snippets.fences)
      expect(inventory.documents[entry.path].classification).toBe("active");
  });
});

describe("actual documentation source against isolated packed packages", () => {
  let environment: PackedSnippetEnvironment;
  let snippets: PublicSnippet[];
  let setupYieldedToReporter = false;
  beforeAll(async () => {
    let heartbeatObserved = false;
    const heartbeat = nextEventLoopTurn().then(() => {
      heartbeatObserved = true;
    });
    environment = await createPackedSnippetEnvironment();
    setupYieldedToReporter = heartbeatObserved;
    await heartbeat;
    const inventory = JSON.parse(
      readFileSync("tools/docs/documentation-inventory.json", "utf8"),
    );
    snippets = Object.entries(inventory.documents)
      .filter(
        ([, entry]) =>
          (entry as { classification: string }).classification === "active",
      )
      .flatMap(([path]) => extractSnippets(path, readFileSync(path, "utf8")));
  }, 240_000);
  afterAll(() => environment?.cleanup());
  it("keeps the reporter event loop responsive during packed setup", () => {
    expect(setupYieldedToReporter).toBe(true);
  });
  it("keeps the reporter event loop responsive during compiler-only rejection", async () => {
    const source = snippets.find(
      (snippet) => snippet.path === "README.md" && snippet.ordinal === 1,
    )!;
    const mutated = {
      ...source,
      source: source.source.replace(
        "runMack(paid,",
        'runMack("not a triangle",',
      ),
    };
    let heartbeatObserved = false;
    const heartbeat = nextEventLoopTurn().then(() => {
      heartbeatObserved = true;
    });
    await expect(verifyPackedSnippets(environment, [mutated])).rejects.toThrow(
      /not assignable|TS2345/,
    );
    const yieldedDuringVerification = heartbeatObserved;
    await heartbeat;
    expect(yieldedDuringVerification).toBe(true);
  }, 30_000);
  it("typechecks and executes every runnable public fence and checks declaration contracts", async () => {
    expect(await verifyPackedSnippets(environment, snippets)).toEqual({
      executable: 13,
      declarations: 25,
    });
  }, 120_000);
  it("rejects a changed public call that syntax-only transpilation would accept", async () => {
    const source = snippets.find(
      (snippet) => snippet.path === "README.md" && snippet.ordinal === 1,
    )!;
    expect(source.source).toContain("runMack(paid,");
    await expect(
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: source.source.replace(
            "runMack(paid,",
            'runMack("not a triangle",',
          ),
        },
      ]),
    ).rejects.toThrow(/not assignable|TS2345/);
  }, 30_000);
  it("rejects a changed declared public input shape", async () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/agents/README.md" && snippet.ordinal === 3,
    )!;
    expect(source.source).toContain("runPresetId: string");
    await expect(
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: source.source.replace(
            "runPresetId: string",
            "runPresetId: number",
          ),
        },
      ]),
    ).rejects.toThrow(/false|TS2344/);
  }, 30_000);
  it("rejects a changed normative function signature even when the runtime import still works", async () => {
    const contract = snippets.filter(
      (snippet) =>
        snippet.path ===
        "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md",
    );
    const factory = contract.find((snippet) => snippet.ordinal === 8)!;
    expect(factory.source).toContain(
      "input: CreateCasualtyMetricInstancesInput",
    );
    const mutated = contract.map((snippet) =>
      snippet === factory
        ? {
            ...snippet,
            source: snippet.source.replace(
              "input: CreateCasualtyMetricInstancesInput",
              "input: string",
            ),
          }
        : snippet,
    );
    await expect(verifyPackedSnippets(environment, mutated)).rejects.toThrow(
      /forward_createCasualtyMetricInstances|backward_createCasualtyMetricInstances/,
    );
  }, 30_000);
  it("rejects an extra optional field that bidirectional assignability would allow", async () => {
    const contract = snippets.filter(
      (snippet) =>
        snippet.path ===
        "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md",
    );
    const source = contract.find((snippet) =>
      snippet.source.includes("export interface DataFindingContext {"),
    )!;
    expect(source).toBeDefined();
    const mutated = contract.map((snippet) =>
      snippet === source
        ? {
            ...snippet,
            source: snippet.source.replace(
              "export interface DataFindingContext {",
              "export interface DataFindingContext {\n  undocumentedOptional?: number;",
            ),
          }
        : snippet,
    );
    await expect(verifyPackedSnippets(environment, mutated)).rejects.toThrow(
      /keys_DataFindingContext/,
    );
  }, 30_000);
  it("rejects an extra optional field in the standalone agent input declaration", async () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/agents/README.md" && snippet.ordinal === 3,
    )!;
    const mutated = source.source.replace(
      "type DiagnosticAgentToolInput = {",
      "type DiagnosticAgentToolInput = {\n  undocumentedOptional?: number;",
    );
    expect(mutated).not.toBe(source.source);
    await expect(
      verifyPackedSnippets(environment, [{ ...source, source: mutated }]),
    ).rejects.toThrow(/KeysCheck/);
  }, 30_000);
  it("rejects a runtime exception in otherwise well-typed actual source", async () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/core/README.md" && snippet.ordinal === 2,
    )!;
    await expect(
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: `${source.source}\nthrow new Error("documentation-runtime-mutation");`,
        },
      ]),
    ).rejects.toThrow(/documentation-runtime-mutation/);
  }, 30_000);
  it("requires a deliberate recipe for every new executable fence and keeps shell operations non-executing", () => {
    expect(() =>
      snippetPolicy({ path: "new-readme.md", ordinal: 1, language: "ts" }),
    ).toThrow(/Unregistered/);
    expect(
      snippetPolicy({
        path: "docs/publishing.md",
        ordinal: 1,
        language: "bash",
      }).classification,
    ).toBe("syntax-only-operational");
    expect(() =>
      snippetPolicy({ path: "new-readme.md", ordinal: 1, language: "js" }),
    ).toThrow(/explicit execution recipe/);
  });
  it("rejects a missing packed export even for a generic normative declaration", async () => {
    const contract = snippets.filter(
      (snippet) =>
        snippet.path ===
        "docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md",
    );
    const source = contract.find((snippet) => snippet.ordinal === 29)!;
    expect(source.source).toContain("export type DefineActuarialToolOptions<");
    const mutated = contract.map((snippet) =>
      snippet === source
        ? {
            ...snippet,
            source: snippet.source.replace(
              "export type DefineActuarialToolOptions<",
              "export type MissingPackedPublicType<",
            ),
          }
        : snippet,
    );
    await expect(verifyPackedSnippets(environment, mutated)).rejects.toThrow(
      /Normative exported declaration MissingPackedPublicType has no packed public export/,
    );
  }, 30_000);
});
