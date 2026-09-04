import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRegistry,
  registeredTests,
  sourceRoot,
  validateRegistry,
  validateExpectedValues,
  type SourceRegistry,
} from "./check-source-reconciliation.mjs";

export interface SourceExecutionReport {
  success: boolean;
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      ancestorTitles: string[];
      title: string;
      status: string;
    }>;
  }>;
}

/** Runtime bijection: deleted, skipped, duplicated, and unregistered tests all fail. */
export function verifySourceExecution(
  report: SourceExecutionReport,
  registry: SourceRegistry,
  root = sourceRoot,
): void {
  if (!report.success) throw new Error("Source validation failed");
  const expected = new Set(
    registeredTests(registry).flatMap((implementation) =>
      implementation.cases.map((test) =>
        JSON.stringify([implementation.path, test.fullName]),
      ),
    ),
  );
  for (const file of report.testResults) {
    const pathname = relative(root, file.name);
    for (const test of file.assertionResults) {
      const name = [...test.ancestorTitles, test.title].join(" > ");
      const key = JSON.stringify([pathname, name]);
      if (!expected.delete(key))
        throw new Error(
          `Unregistered or duplicate source test: ${pathname}: ${name}`,
        );
      if (test.status !== "passed")
        throw new Error(
          `Source test did not run successfully (${test.status}): ${name}`,
        );
    }
  }
  if (expected.size)
    throw new Error(
      `Registered source tests did not execute: ${[...expected].join(", ")}`,
    );
}

export async function runSourceReconciliation(): Promise<void> {
  validateRegistry();
  await validateExpectedValues();
  const registry = readRegistry();
  const temporary = mkdtempSync(join(tmpdir(), "actuarial-source-validation-"));
  try {
    const reportPath = join(temporary, "vitest.json");
    const result = spawnSync(
      process.execPath,
      [
        join(sourceRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--exclude",
        "**/.claude/**",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${reportPath}`,
        ...new Set(registeredTests(registry).map((test) => test.path)),
      ],
      { cwd: sourceRoot, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Source test process failed (${result.status})`);
    verifySourceExecution(
      JSON.parse(readFileSync(reportPath, "utf8")),
      registry,
    );
    for (const entry of registry.entries) {
      const tests = [entry.test, ...(entry.additionalTests ?? [])];
      console.log(
        `${entry.id}: ${tests.reduce((sum, test) => sum + test.cases.length, 0)} cases / ${tests.reduce((sum, test) => sum + test.assertionCount, 0)} assertions passed`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await runSourceReconciliation();
