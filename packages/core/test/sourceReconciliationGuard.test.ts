import { describe, expect, it } from "vitest";
import {
  readRegistry,
  registeredTests,
  sourceRoot,
  validateRegistry,
  validateExpectedValues,
} from "../../../tools/validation/check-source-reconciliation.mjs";
import {
  verifySourceExecution,
  type SourceExecutionReport,
} from "../../../tools/validation/run-source-reconciliation.mjs";
import { resolve } from "node:path";

function successfulReport(): SourceExecutionReport {
  const files = new Map<string, SourceExecutionReport["testResults"][number]>();
  for (const implementation of registeredTests(readRegistry())) {
    const file = files.get(implementation.path) ?? {
      name: resolve(sourceRoot, implementation.path),
      assertionResults: [],
    };
    for (const test of implementation.cases) {
      const parts = test.fullName.split(" > ");
      file.assertionResults.push({
        ancestorTitles: parts.slice(0, -1),
        title: parts.at(-1)!,
        status: "passed",
      });
    }
    files.set(implementation.path, file);
  }
  return { success: true, testResults: [...files.values()] };
}

describe("source reconciliation evidence guards", () => {
  it("rejects expected-value drift away from the frozen transcription", async () => {
    const registry = readRegistry();
    const published = registry.entries[0]!.expected.taylorAshePublished as {
      factors: number[];
    };
    published.factors[0]! += 1;
    await expect(validateExpectedValues(sourceRoot, registry)).rejects.toThrow(
      "differs from frozen source transcription",
    );
  });
  it("accepts the complete reviewed inventory and exact execution set", () => {
    expect(() => validateRegistry()).not.toThrow();
    expect(() =>
      verifySourceExecution(successfulReport(), readRegistry()),
    ).not.toThrow();
  });
  it.each(["missing", "duplicate", "pending", "todo", "extra"])(
    "rejects %s execution evidence",
    (mutation) => {
      const report = successfulReport();
      const tests = report.testResults[0]!.assertionResults;
      if (mutation === "missing") tests.pop();
      else if (mutation === "duplicate") tests.push({ ...tests[0]! });
      else if (mutation === "extra")
        tests.push({ ...tests[0]!, title: "unregistered case" });
      else tests[0]!.status = mutation;
      expect(() => verifySourceExecution(report, readRegistry())).toThrow();
    },
  );
  it.each(["entry", "assertion", "fixture", "lane", "counter", "expected"])(
    "rejects a changed %s contract",
    (mutation) => {
      const registry = readRegistry();
      const first = registry.entries[0]!;
      if (mutation === "entry") registry.entries.shift();
      else if (mutation === "assertion") first.test.sha256 = "0".repeat(64);
      else if (mutation === "fixture") first.fixture.sha256 = "0".repeat(64);
      else if (mutation === "lane") first.lanes = ["npm test"];
      else if (mutation === "counter") first.test.cases[0]!.assertions++;
      else first.expected = {};
      expect(() => validateRegistry(sourceRoot, registry)).toThrow();
    },
  );
});
