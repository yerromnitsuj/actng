import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { env } from "../env.js";
import { advisorAgent } from "./advisor.js";
import { deriveExpectedLossesWorkflow } from "./elrWorkflow.js";
import { registerMastra } from "./instanceRegistry.js";

/**
 * Instance storage backs workflow-run snapshots: a paused ELR derivation must
 * survive a server restart (the advisor promises resumability by runId).
 * Without it Mastra falls back to an in-memory store and paused runs die with
 * the process. Chat memory is separate, on the advisor's own Memory store.
 */
export const mastra = new Mastra({
  agents: { advisorAgent },
  workflows: { deriveExpectedLossesWorkflow },
  storage: new LibSQLStore({ id: "workflow-storage", url: `file:${env.workflowDbPath}` }),
});

registerMastra(mastra);

export { advisorAgent };
