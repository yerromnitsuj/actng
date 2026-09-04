import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  beforeAll(() => {
    environment = createPackedSnippetEnvironment();
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
  it("typechecks and executes every runnable public fence and checks declaration contracts", () => {
    expect(verifyPackedSnippets(environment, snippets)).toEqual({
      executable: 13,
      declarations: 25,
    });
  }, 120_000);
  it("rejects a changed public call that syntax-only transpilation would accept", () => {
    const source = snippets.find(
      (snippet) => snippet.path === "README.md" && snippet.ordinal === 1,
    )!;
    expect(source.source).toContain("runMack(paid,");
    expect(() =>
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: source.source.replace(
            "runMack(paid,",
            'runMack("not a triangle",',
          ),
        },
      ]),
    ).toThrow(/not assignable|TS2345/);
  }, 30_000);
  it("rejects a changed declared public input shape", () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/agents/README.md" && snippet.ordinal === 3,
    )!;
    expect(source.source).toContain("runPresetId: string");
    expect(() =>
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: source.source.replace(
            "runPresetId: string",
            "runPresetId: number",
          ),
        },
      ]),
    ).toThrow(/false|TS2344/);
  }, 30_000);
  it("rejects a changed normative function signature even when the runtime import still works", () => {
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
    expect(() => verifyPackedSnippets(environment, mutated)).toThrow(
      /forward_createCasualtyMetricInstances|backward_createCasualtyMetricInstances/,
    );
  }, 30_000);
  it("rejects an extra optional field that bidirectional assignability would allow", () => {
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
    expect(() => verifyPackedSnippets(environment, mutated)).toThrow(
      /keys_DataFindingContext/,
    );
  }, 30_000);
  it("rejects an extra optional field in the standalone agent input declaration", () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/agents/README.md" && snippet.ordinal === 3,
    )!;
    const mutated = source.source.replace(
      "type DiagnosticAgentToolInput = {",
      "type DiagnosticAgentToolInput = {\n  undocumentedOptional?: number;",
    );
    expect(mutated).not.toBe(source.source);
    expect(() =>
      verifyPackedSnippets(environment, [{ ...source, source: mutated }]),
    ).toThrow(/KeysCheck/);
  }, 30_000);
  it("rejects a runtime exception in otherwise well-typed actual source", () => {
    const source = snippets.find(
      (snippet) =>
        snippet.path === "packages/core/README.md" && snippet.ordinal === 2,
    )!;
    expect(() =>
      verifyPackedSnippets(environment, [
        {
          ...source,
          source: `${source.source}\nthrow new Error("documentation-runtime-mutation");`,
        },
      ]),
    ).toThrow(/documentation-runtime-mutation/);
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
  it("rejects a missing packed export even for a generic normative declaration", () => {
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
    expect(() => verifyPackedSnippets(environment, mutated)).toThrow(
      /Normative exported declaration MissingPackedPublicType has no packed public export/,
    );
  }, 30_000);
});
