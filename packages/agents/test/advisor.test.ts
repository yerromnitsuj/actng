import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import {
  assembleInstructions,
  BASE_INSTRUCTIONS,
  createReservingAdvisor,
} from "../src/advisor.js";

describe("BASE_INSTRUCTIONS", () => {
  it("carries the hardened non-domain rules", () => {
    expect(BASE_INSTRUCTIONS.workingRules).toContain("EVERY number you cite must come from a tool result");
    expect(BASE_INSTRUCTIONS.workingRules).toContain("Call read tools BEFORE forming recommendations");
    expect(BASE_INSTRUCTIONS.workingRules).toContain("Do NOT recite full tables");
    expect(BASE_INSTRUCTIONS.actionConsent).toContain("A direct parameterized instruction is consent");
    expect(BASE_INSTRUCTIONS.failureRecovery).toContain("success: false");
    expect(BASE_INSTRUCTIONS.professionalGrounding).toContain("ASOP 43");
    expect(BASE_INSTRUCTIONS.selectionWeighting).toContain("Bornhuetter-Ferguson");
  });

  it("contains no literal backtick characters (house gotcha: broke server boot once)", () => {
    for (const [section, text] of Object.entries(BASE_INSTRUCTIONS)) {
      expect(text.includes("`"), `section ${section} contains a backtick`).toBe(false);
    }
  });

  it("leaves workbench-specific exhibits out of the base template", () => {
    const assembled = assembleInstructions();
    // Named workbench tools and exhibits belong to host domainInstructions.
    for (const workbenchism of ["get_workspace_overview", "set_loss_cap", "derive_expected_losses", "ActNG"]) {
      expect(assembled).not.toContain(workbenchism);
    }
  });
});

describe("assembleInstructions", () => {
  it("is deterministic: identical inputs yield byte-identical output", () => {
    const options = {
      domainInstructions: ["## LDF selections\nPrefer volume-weighted averages."],
      conductOverrides: "Be terse.",
    };
    expect(assembleInstructions(options)).toBe(assembleInstructions(options));
    expect(assembleInstructions()).toBe(assembleInstructions({}));
  });

  it("assembles every base section under its header", () => {
    const assembled = assembleInstructions();
    expect(assembled.startsWith(BASE_INSTRUCTIONS.role)).toBe(true);
    expect(assembled).toContain("## Professional grounding\n" + BASE_INSTRUCTIONS.professionalGrounding);
    expect(assembled).toContain("## Non-negotiable working rules\n" + BASE_INSTRUCTIONS.workingRules);
    expect(assembled).toContain("## Acting on the working state\n" + BASE_INSTRUCTIONS.actionConsent);
    expect(assembled).toContain("## Failure recovery\n" + BASE_INSTRUCTIONS.failureRecovery);
    expect(assembled).toContain("## Selection of ultimates\n" + BASE_INSTRUCTIONS.selectionWeighting);
    expect(assembled).toContain("## Conversational conduct\n" + BASE_INSTRUCTIONS.conduct);
    expect(assembled.includes("`")).toBe(false);
  });

  it("splices domain sections in order, between the base analytics and conduct", () => {
    const domain = ["## Loss capping\nDevelop the capped layer.", "## Tails\nExponential decay for casualty paid."];
    const assembled = assembleInstructions({ domainInstructions: domain });
    const capIdx = assembled.indexOf(domain[0]!);
    const tailIdx = assembled.indexOf(domain[1]!);
    const weightingIdx = assembled.indexOf("## Selection of ultimates");
    const conductIdx = assembled.indexOf("## Conversational conduct");
    expect(capIdx).toBeGreaterThan(weightingIdx);
    expect(tailIdx).toBeGreaterThan(capIdx);
    expect(conductIdx).toBeGreaterThan(tailIdx);

    // A single string splices identically to a one-element array.
    expect(assembleInstructions({ domainInstructions: domain[0] })).toBe(
      assembleInstructions({ domainInstructions: [domain[0]!] }),
    );
  });

  it("replaces the conduct section wholesale when overridden", () => {
    const assembled = assembleInstructions({ conductOverrides: "Answer in haiku." });
    expect(assembled).toContain("## Conversational conduct\nAnswer in haiku.");
    expect(assembled).not.toContain(BASE_INSTRUCTIONS.conduct);
  });
});

describe("createReservingAdvisor", () => {
  it("builds an Agent with the assembled instructions and sensible defaults", () => {
    const agent = createReservingAdvisor({ model: "anthropic/claude-sonnet-4-5" });
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.id).toBe("reserving-advisor");
    expect(agent.name).toBe("Reserving Advisor");
  });

  it("honors id/name overrides and passes tools through", () => {
    const agent = createReservingAdvisor({
      id: "workbench-advisor",
      name: "Workbench Advisor",
      model: "anthropic/claude-sonnet-4-5",
      tools: {},
      domainInstructions: "## Workbench\nUse the workbench tools.",
    });
    expect(agent.id).toBe("workbench-advisor");
    expect(agent.name).toBe("Workbench Advisor");
  });
});
