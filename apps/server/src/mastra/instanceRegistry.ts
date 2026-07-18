/**
 * Late-bound Mastra instance registry. Tools need the instance to run
 * workflows, but a static import of ./index.js from tools.ts closes the
 * module cycle index -> advisor -> tools, and a DYNAMIC import deadlocks
 * inside tool execution under the tsx loader. This module has zero imports,
 * so both sides can depend on it safely; index.ts registers the instance at
 * construction time.
 *
 * addWorkflow is part of the structural surface because study promotions
 * register per-run workflows LATE (promoteStudy constructs the chain from
 * the imported study document, which does not exist at boot).
 */

export interface MastraInstanceLike {
  getWorkflow(id: string): unknown;
  addWorkflow(workflow: unknown, key?: string): void;
}

let instance: MastraInstanceLike | null = null;

export function registerMastra(mastra: MastraInstanceLike): void {
  instance = mastra;
}

export function getMastra(): MastraInstanceLike {
  if (!instance) {
    throw new Error("Mastra instance not registered yet (server still booting?)");
  }
  return instance;
}
