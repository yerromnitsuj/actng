import { describe, expect, it } from "vitest";
import { MODEL_CARDS, MODEL_CARD_IDS, type MethodId } from "../src/modelCards.js";

/**
 * The registry can never freeze again: every analysis-method discriminant
 * @actuarial-ts/core ships must have a model card, so generateDisclosure can
 * cite any method an analysis actually used. The list below is maintained by
 * hand ON PURPOSE - adding a method to core without updating it (and the
 * card registry) fails here, which is exactly the reminder ASOP 56 wants.
 * (Tail-fit discriminants exponentialDecay/inversePower live inside the
 * tailFitting card; berquist/capping/trend/onLevel result types carry no
 * method literal and keep their named cards.)
 */
const CORE_METHOD_DISCRIMINANTS: MethodId[] = [
  "chainLadder",
  "mack",
  "bornhuetterFerguson",
  "benktander",
  "capeCod",
  "expectedClaims",
  "frequencySeverity",
  "munichChainLadder",
  "odpBootstrap",
  "merzWuthrich",
  "clarkLdf",
  "clarkCapeCod",
  "caseOutstanding",
  "fisherLange",
  "salvageSubro",
  "netOfRecoveries",
  "discountUnpaid",
];

describe("model-card registry sync", () => {
  it("has a complete card for every core method discriminant", () => {
    for (const id of CORE_METHOD_DISCRIMINANTS) {
      const card = MODEL_CARDS[id];
      expect(card, `missing model card for core method "${id}"`).toBeDefined();
      expect(card.intendedUse.length).toBeGreaterThan(20);
      expect(card.specification.length).toBeGreaterThan(40);
      expect(card.keyAssumptions.length).toBeGreaterThan(0);
      expect(card.weaknesses.length).toBeGreaterThan(0);
      expect(card.literature.length).toBeGreaterThan(0);
    }
  });

  it("every registered card id is either a core discriminant or a named non-discriminant surface", () => {
    const named = new Set<MethodId>([
      ...CORE_METHOD_DISCRIMINANTS,
      "berquistCaseAdequacy",
      "berquistSettlement",
      "tailFitting",
      "cappingIlf",
      "trend",
      "onLevel",
      "ulae",
    ]);
    for (const id of MODEL_CARD_IDS) {
      expect(named.has(id), `unexpected card id "${id}" - update the sync lists`).toBe(true);
    }
  });
});
