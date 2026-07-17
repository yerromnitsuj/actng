import { describe, expect, it } from "vitest";
import { generateDisclosure, type DisclosureInput } from "../src/disclosure.js";
import { MODEL_CARDS, MODEL_CARD_IDS } from "../src/modelCards.js";

describe("model cards (ASOP 56)", () => {
  it("ships a complete card for every method id", () => {
    expect(MODEL_CARD_IDS.length).toBeGreaterThanOrEqual(13);
    for (const id of MODEL_CARD_IDS) {
      const card = MODEL_CARDS[id];
      expect(card.method).toBe(id);
      expect(card.title.length).toBeGreaterThan(3);
      expect(card.intendedUse.length).toBeGreaterThan(20);
      expect(card.specification.length).toBeGreaterThan(40);
      expect(card.keyAssumptions.length).toBeGreaterThan(0);
      expect(card.weaknesses.length).toBeGreaterThan(0);
      expect(card.sensitivities.length).toBeGreaterThan(0);
      expect(card.literature.length).toBeGreaterThan(0);
    }
  });

  it("never claims ASOP approval", () => {
    const text = JSON.stringify(MODEL_CARDS);
    expect(text).not.toMatch(/ASOP[- ]approved/i);
    expect(text).not.toMatch(/ASOP[- ]certified/i);
  });
});

const input: DisclosureInput = {
  title: "GL occurrence reserve analysis — 2025-12-31",
  preparedBy: "Jane Doe, FCAS",
  metadata: {
    intendedPurpose: "Estimate unpaid claims for year-end statutory reporting",
    intendedUsers: ["Chief actuary", "External auditor"],
    intendedMeasure: { kind: "central-estimate" },
    basis: { grossNet: "gross", laeTreatment: "dcc-only" },
    accountingDate: "2025-12-31",
    valuationDate: "2025-12-31",
    reviewDate: "2026-02-15",
    currency: "USD",
  },
  methods: [
    {
      methodId: "chainLadder",
      basisLabel: "paid",
      parameters: { selected: [2.9, 1.6, 1.3, 1.1], tailFactor: 1.02 },
      resultSummary: { ultimate: 12_345_678, unpaid: 4_222_111 },
    },
    {
      methodId: "mack",
      basisLabel: "paid",
      parameters: { tailFactor: 1.02 },
      resultSummary: { standardError: 811_000 },
    },
  ],
  ledger: {
    entries: [
      {
        seq: 1,
        timestamp: "2026-01-05T10:00:00Z",
        actor: "default",
        field: "paid.selections",
        value: [2.9, 1.6, 1.3, 1.1],
      },
      {
        seq: 2,
        timestamp: "2026-01-05T10:05:00Z",
        actor: "actuary",
        field: "paid.tailFactor",
        value: 1.02,
        previousValue: 1.0,
        rationale: "Exponential-decay fit valid with R^2 0.97; judgmentally confirmed",
        source: "fitted",
      },
    ],
  },
  dataReview: {
    checks: [
      { id: "negative-paid", description: "Cumulative paid amounts are non-negative", status: "pass", details: [] },
      {
        id: "paid-exceeds-incurred",
        description: "Paid never exceeds incurred in any cell",
        status: "fail",
        details: ["2023 age 12: paid 105 > incurred 100"],
      },
    ],
    summary: { pass: 1, warning: 0, fail: 1 },
  },
  priorComparison: {
    priorLabel: "2025-09-30 quarterly review",
    priorReserve: 4_050_000,
    currentReserve: 4_222_111,
    changes: {
      added: [],
      removed: [],
      changed: [{ field: "paid.tailFactor", priorValue: 1.0, currentValue: 1.02 }],
    },
  },
  reliances: ["Loss run supplied by TPA XYZ as of 2025-12-31; reconciliation to control totals performed"],
  limitations: ["No explicit provision for unreported mass-tort exposure"],
  sdkVersion: "0.1.0",
  generatedAt: "2026-01-05T10:15:00Z",
};

describe("generateDisclosure (ASOP 41)", () => {
  it("is deterministic: identical inputs yield byte-identical markdown", () => {
    const a = generateDisclosure(input);
    const b = generateDisclosure(structuredClone(input));
    expect(a).toBe(b);
  });

  it("carries every load-bearing section and the sanctioned positioning", () => {
    const doc = generateDisclosure(input);
    expect(doc).toContain("## 1. Identification and intended purpose");
    expect(doc).toContain("central estimate");
    expect(doc).toContain("## 2. Scope, dates, and basis");
    expect(doc).toContain("gross of reinsurance, including defense and cost containment");
    expect(doc).toContain("## 3. Data and data review (ASOP No. 23)");
    expect(doc).toContain("paid-exceeds-incurred");
    expect(doc).toContain("## 4. Methods and models (ASOP No. 56)");
    expect(doc).toContain("Chain ladder");
    expect(doc).toContain("Mack distribution-free standard errors");
    expect(doc).toContain("## 5. Assumptions and judgments");
    expect(doc).toContain("judgmentally confirmed");
    expect(doc).toContain("## 6. Changes from the prior analysis");
    expect(doc).toContain("paid.tailFactor");
    expect(doc).toContain("## 7. Reliances and limitations");
    expect(doc).toContain("TPA XYZ");
    expect(doc).toContain("## 8. Reproducibility");
    expect(doc).toContain("responsibility for the actuarial communication and for compliance");
    expect(doc).not.toMatch(/ASOP[- ]approved/i);
  });

  it("states plainly when reviews/ledgers/priors are absent (never overstates)", () => {
    const bare = generateDisclosure({
      metadata: input.metadata,
      methods: [{ methodId: "chainLadder" }],
      sdkVersion: "0.1.0",
      generatedAt: "2026-01-05T10:15:00Z",
    });
    expect(bare).toContain("No automated data review report was attached");
    expect(bare).toContain("No assumption ledger was attached");
    expect(bare).toContain("No prior-analysis comparison was attached");
    expect(bare).toContain("No reliances on data or analyses supplied by others were recorded");
  });

  it("matches the golden snapshot", () => {
    expect(generateDisclosure(input)).toMatchSnapshot();
  });
});
