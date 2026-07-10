/**
 * Late-bound Mastra instance registry. Tools need the instance to run
 * workflows, but a static import of ./index.js from tools.ts closes the
 * module cycle index -> advisor -> tools, and a DYNAMIC import deadlocks
 * inside tool execution under the tsx loader. This module has zero imports,
 * so both sides can depend on it safely; index.ts registers the instance at
 * construction time.
 */

let instance: { getWorkflow(id: string): unknown } | null = null;

export function registerMastra(mastra: { getWorkflow(id: string): unknown }): void {
  instance = mastra;
}

export function getMastra(): { getWorkflow(id: string): unknown } {
  if (!instance) {
    throw new Error("Mastra instance not registered yet (server still booting?)");
  }
  return instance;
}
