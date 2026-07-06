import { Mastra } from "@mastra/core/mastra";
import { advisorAgent } from "./advisor.js";

export const mastra = new Mastra({
  agents: { advisorAgent },
});

export { advisorAgent };
