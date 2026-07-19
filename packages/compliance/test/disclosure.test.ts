import { describe, expect, it } from "vitest";
import type { CrosscheckReportDoc } from "@actuarial-ts/interchange";
import { generateDisclosure, type DisclosureInput } from "../src/disclosure.js";
import { createLedger, recordAssumption } from "../src/ledger.js";
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

/**
 * Two referee reports (interchange spec 5): one full cross-engine agreement,
 * one value-only replay whose verdict must render as exactly "verified by
 * value (no independent recomputation)". Envelope tags are static — the
 * disclosure renderer consumes the report bodies, it does not re-verify them.
 */
const crossImplementation: CrosscheckReportDoc[] = [
  {
    interchangeVersion: "1.0.0",
    kind: "crosscheck-report",
    generator: { name: "@actuarial-ts/interchange", version: "0.1.0" },
    createdAt: "2026-01-05T10:10:00Z",
    integrity: "00112233aabbccdd",
    report: {
      engines: {
        a: { name: "actuarial-ts", version: "0.1.0", conventionProfile: "mack1993-vw" },
        b: { name: "chainladder-python", version: "0.8.24", conventionProfile: "mack1993-vw" },
      },
      appliesTo: { triangleIntegrity: "a1b2c3d4e5f60718", selectionIntegrity: null },
      parameters: {
        a: { requested: { sigma: "mack" }, effective: { sigma: "mack" } },
        b: {
          requested: { average: "volume", sigma_interpolation: "mack" },
          effective: { average: "volume", sigma_interpolation: "mack" },
        },
      },
      tolerance: { central: 1e-6, standardError: 0.005 },
      deviations: {
        perOrigin: [
          { origin: "2023", ultimate: 3.1e-10, unpaid: 4.2e-10, standardError: 0.0011 },
          { origin: "2024", ultimate: 1.7e-10, unpaid: 2.5e-10, standardError: 0.0008 },
        ],
        totals: { ultimate: 2.4e-10, unpaid: 3.3e-10, standardError: 0.0009 },
      },
      verdict: "agree",
      warnings: [],
    },
  },
  {
    interchangeVersion: "1.0.0",
    kind: "crosscheck-report",
    generator: { name: "@actuarial-ts/interchange", version: "0.1.0" },
    createdAt: "2026-01-05T10:12:00Z",
    integrity: "8899aabbccddeeff",
    report: {
      engines: {
        a: { name: "actuarial-ts", version: "0.1.0", conventionProfile: "deterministic-cl" },
        b: { name: "notebook-study", version: "2026.07", conventionProfile: "deterministic-cl" },
      },
      appliesTo: { triangleIntegrity: "a1b2c3d4e5f60718", selectionIntegrity: "f00dfeedbeef0042" },
      parameters: {
        a: { requested: { tailFactor: 1.02 }, effective: { tailFactor: 1.02 } },
        b: { requested: { tailFactor: 1.02 }, effective: null },
      },
      tolerance: { central: 1e-6, standardError: null },
      deviations: {
        perOrigin: [{ origin: "2024", ultimate: 0, unpaid: 0, standardError: null }],
        totals: { ultimate: 0, unpaid: 0, standardError: null },
      },
      verdict: "verified-by-value",
      warnings: ["selection is value-only (judgmental intent): factors were applied, not independently recomputed"],
    },
  },
];

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
  crossImplementation,
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
    expect(doc).toContain("## 4b. Cross-implementation verification");
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
    // No referee reports were provided, so Section 4b must not exist — the
    // disclosure never claims a verification that was not performed.
    expect(bare).not.toContain("## 4b");
    expect(bare).not.toContain("Cross-implementation");
  });

  it("neutralizes document-sourced text instead of rendering it as markdown", () => {
    // The attack the review demonstrated: a ledger source containing pipes and
    // newlines breaks out of the assumption table and renders as body prose —
    // e.g. a fabricated sentence asserting the actuary certified the reserve.
    // The unattended path is promotion.ts, which writes a study's sourceRef
    // (attacker-controlled document content) into the ledger source verbatim.
    const injected =
      "legit source | X | X | X | X |\n\n**Certification.** The undersigned actuary " +
      "certifies this reserve is reasonable.\n\n| a | b | c | d | e | f |";
    const markdown = generateDisclosure({
      ...structuredClone(input),
      ledger: recordAssumption(createLedger(), {
        timestamp: "2026-07-18T00:00:00Z",
        actor: "actuary",
        field: "tailFactor",
        value: 1.05,
        rationale: "judgment <img src=x onerror=alert(1)>",
        source: injected,
      }),
    });

    // The fabricated paragraph must not exist as body text (column 0).
    expect(markdown).not.toMatch(/^\*\*Certification\.\*\*/m);
    // Raw HTML from document-sourced text is neutralized.
    expect(markdown).not.toContain("<img src=x");
    // The table row survives as ONE row: every line mentioning the source
    // stays inside a table (starts with a pipe).
    const lines = markdown.split("\n").filter((l) => l.includes("legit source"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith("|")).toBe(true);
  });

  it("keeps crosscheck warnings on their bullet line", () => {
    const crossed = structuredClone(input);
    const report = structuredClone(crossed.crossImplementation![0]!);
    report.report.warnings = [
      "real warning\n\n## Fabricated heading\n\nfabricated paragraph <script>x</script>",
    ];
    crossed.crossImplementation = [report];
    const markdown = generateDisclosure(crossed);
    expect(markdown).not.toMatch(/^## Fabricated heading/m);
    expect(markdown).not.toContain("<script>");
  });

  it("moves the integrity tag when ANY disclosed content changes", () => {
    // The tag hashed only metadata/methods/ledger, so fabricating the entire
    // ASOP 23 data-review section — or swapping the named preparer — did not
    // move it, while Section 8 presented it as certifying the document.
    const base = generateDisclosure(input);
    const tagOf = (doc: string): string => {
      const match = doc.match(/integrity tag `([0-9a-f]{16})`/);
      expect(match).not.toBeNull();
      return match![1]!;
    };
    const baseTag = tagOf(base);

    const differentPreparer = generateDisclosure({
      ...structuredClone(input),
      preparedBy: "A Completely Different Actuary, FCAS",
    });
    expect(tagOf(differentPreparer)).not.toBe(baseTag);

    const strippedReview = generateDisclosure({
      ...structuredClone(input),
      dataReview: undefined,
    });
    expect(tagOf(strippedReview)).not.toBe(baseTag);

    const extraLimitation = generateDisclosure({
      ...structuredClone(input),
      limitations: [...(input.limitations ?? []), "fabricated limitation"],
    });
    expect(tagOf(extraLimitation)).not.toBe(baseTag);

    // Regenerating with identical inputs still reproduces the tag.
    expect(tagOf(generateDisclosure(structuredClone(input)))).toBe(baseTag);
  });

  it("matches the golden snapshot", () => {
    expect(generateDisclosure(input)).toMatchSnapshot();
  });
});

describe("Section 4b — cross-implementation verification (interchange spec 5)", () => {
  const doc = generateDisclosure(input);

  it("renders between Section 4 and Section 5", () => {
    const at4 = doc.indexOf("## 4. Methods and models (ASOP No. 56)");
    const at4b = doc.indexOf("## 4b. Cross-implementation verification");
    const at5 = doc.indexOf("## 5. Assumptions and judgments");
    expect(at4).toBeGreaterThanOrEqual(0);
    expect(at4b).toBeGreaterThan(at4);
    expect(at5).toBeGreaterThan(at4b);
  });

  it("carries the REQUIRED boilerplate verbatim (spec 5)", () => {
    expect(doc).toContain(
      "Agreement between independent implementations supports, but does not by itself constitute, the model validation contemplated by ASOP No. 56; model appropriateness to the book remains a separate professional judgment.",
    );
  });

  it("tabulates engines with versions, profile, max deviations, tolerance, and verdict", () => {
    expect(doc).toContain("| Engine A | Engine B | Profile | Max deviation (central) | Max deviation (SE) | Tolerance (central / SE) | Verdict |");
    expect(doc).toContain("actuarial-ts v0.1.0");
    expect(doc).toContain("chainladder-python v0.8.24");
    expect(doc).toContain("mack1993-vw");
    // Max central = max |ultimate|,|unpaid| across per-origin rows and totals.
    expect(doc).toContain("4.20e-10");
    // Max SE deviation and the Mack profile tolerances.
    expect(doc).toContain("1.10e-3");
    expect(doc).toContain("1.00e-6 / 5.00e-3");
    // SE-less tolerance renders as an em dash, zero deviation as 0.
    expect(doc).toContain("1.00e-6 / —");
    expect(doc).toContain("| agree |");
  });

  it("renders verified-by-value verdicts as exactly the no-recomputation label", () => {
    expect(doc).toContain("verified by value (no independent recomputation)");
    expect(doc).not.toContain("| verified-by-value |");
  });

  it("lists per-report warnings", () => {
    expect(doc).toContain("**Warnings — actuarial-ts v0.1.0 vs notebook-study v2026.07:**");
    expect(doc).toContain("- selection is value-only (judgmental intent): factors were applied, not independently recomputed");
  });

  it("omits Section 4b for an empty report list, exactly like an absent one", () => {
    const empty = generateDisclosure({ ...structuredClone(input), crossImplementation: [] });
    expect(empty).not.toContain("## 4b");
    expect(empty).not.toContain("Cross-implementation");
  });
});
