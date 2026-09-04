import { afterEach, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import registry from "./source-reconciliation.json";

export interface SourceTestCase {
  fullName: string;
  assertions: number;
}
interface Anchor {
  id: string;
  expected: Record<string, unknown>;
  tolerances: Record<string, number>;
  test: { path: string; cases: SourceTestCase[] };
  additionalTests?: Array<{ path: string; cases: SourceTestCase[] }>;
}
const anchors = registry.entries as unknown as Anchor[];
function anchor(id: string): Anchor {
  const result = anchors.find((entry) => entry.id === id);
  if (!result) throw new Error(`Unregistered source anchor ${id}`);
  return result;
}

/** Typed access to reviewed numbers; fixtures retain immutable source transcription. */
export function sourceExpected<T>(id: string, key: string): T {
  const values = anchor(id).expected;
  if (!Object.hasOwn(values, key))
    throw new Error(`${id}: unregistered expected value ${key}`);
  return structuredClone(values[key]) as T;
}

export function sourceTolerance(id: string, key: string): number {
  const values = anchor(id).tolerances;
  if (!Object.hasOwn(values, key))
    throw new Error(`${id}: unregistered tolerance ${key}`);
  return values[key]!;
}

/** Every executed case retains its reviewed assertion cardinality, including loops. */
export function registerSourceFile(url: string): void {
  const pathname = relative(
    fileURLToPath(new URL("../../", import.meta.url)),
    fileURLToPath(url),
  );
  const entries = anchors
    .flatMap((entry) => [entry.test, ...(entry.additionalTests ?? [])])
    .filter((test) => test.path === pathname);
  if (!entries.length)
    throw new Error(`Unregistered source test file ${pathname}`);
  afterEach(() => {
    const state = expect.getState();
    const name = state.currentTestName!;
    const cases = entries
      .flatMap((entry) => entry.cases ?? [])
      .filter((test) => test.fullName === name);
    if (cases.length !== 1)
      throw new Error(
        `${pathname}: source test must have exactly one registry entry: ${name}`,
      );
    expect.assertions(cases[0]!.assertions);
  });
}
