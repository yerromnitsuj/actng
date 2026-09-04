import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parseDocument } from "yaml";

describe("documentation governance artifacts", () => {
  it("inventory entries and every fence have explicit review metadata", () => {
    const inventory = JSON.parse(readFileSync("tools/docs/documentation-inventory.json", "utf8"));
    const snippets = JSON.parse(readFileSync("tools/docs/public-snippet-manifest.json", "utf8"));
    expect(inventory.schemaVersion).toBe(1); expect(snippets.schemaVersion).toBe(1);
    for (const entry of Object.values(inventory.documents) as any[]) {
      expect(entry.reason.trim().length).toBeGreaterThan(0); expect(Array.isArray(entry.packages)).toBe(true);
      if (entry.classification === "active") expect(entry.packages.length).toBeGreaterThan(0);
    }
    for (const entry of snippets.fences) { expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/); expect(entry.reason.trim().length).toBeGreaterThan(0); }
  });
  it("uses real Markdown and YAML parsers for indentation, references, and strict YAML", () => {
    const tree: any = fromMarkdown("- nested\n\n  ```ts\n  const value = 1\n  ```\n\n[ref]: ./README.md\n");
    const code: any[] = []; const walk = (node: any) => { if (node.type === "code") code.push(node); for (const child of node.children ?? []) walk(child); }; walk(tree);
    expect(code).toHaveLength(1); expect(code[0].value).toContain("const value");
    expect(parseDocument("value: [1, 2]").errors).toHaveLength(0);
    expect(parseDocument("value: [1, 2").errors.length).toBeGreaterThan(0);
  });
});
