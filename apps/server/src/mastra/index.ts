import { Mastra } from "@mastra/core/mastra";
import { advisorAgent } from "./advisor.js";
import { deriveExpectedLossesWorkflow } from "./elrWorkflow.js";
import { registerMastra } from "./instanceRegistry.js";

export const mastra = new Mastra({
  agents: { advisorAgent },
  workflows: { deriveExpectedLossesWorkflow },
});

registerMastra(mastra);

export { advisorAgent };
