# @actuarial-ts/compliance

The compliance-support layer of the actuarial-ts SDK: the part no
calculator ships. It turns an analysis into the documentation the
Actuarial Standards of Practice ask for.

- **Estimate metadata** (ASOP 43): intended purpose and measure, gross/net
  basis, LAE treatment, and the accounting / valuation / review dates — as
  typed, validated fields instead of tribal knowledge.
- **Assumption ledger** (ASOPs 41/43/56): an immutable record of every
  selection, distinguishing machine defaults from human or agent judgment;
  judgment entries require a rationale.
- **Disclosure generator** (ASOP 41): renders a methods-assumptions-and-data
  appendix from the analysis itself — written to the "another qualified
  actuary could appraise it" bar, deterministic to the byte.
- **Model cards** (ASOP 56): intended use, specification, key assumptions,
  known weaknesses, and sensitivities for every method the SDK ships — the
  "basic understanding" content an actuary relying on vendor models must
  hold and disclose.
- **Reproducibility bundles** (ASOP 21 / 56): canonical serialization of
  inputs, parameters, and results with an integrity tag, so an analysis
  re-runs identically years later for an auditor or examiner.
- **Actual-vs-expected roll-forward**: expected emergence from the prior
  valuation's pattern versus actual, by origin.

Everything here is pure, deterministic, and browser-safe: no clock reads,
no randomness, no node builtins. Identical inputs produce byte-identical
documents.

## Quickstart

```ts
import { runChainLadder, runMack } from "@actuarial-ts/core";
import {
  createLedger,
  recordAssumption,
  generateDisclosure,
} from "@actuarial-ts/compliance";

let ledger = createLedger();
ledger = recordAssumption(ledger, {
  timestamp: "2026-01-05T10:05:00Z",
  actor: "actuary",
  field: "paid.tailFactor",
  value: 1.02,
  rationale: "Exponential-decay fit valid with R^2 0.97; judgmentally confirmed",
  source: "fitted",
});

const cl = runChainLadder(paidTriangle, { selected, tailFactor: 1.02 });
const mack = runMack(paidTriangle, { selected, tailFactor: 1.02 });

const markdown = generateDisclosure({
  metadata: {
    intendedPurpose: "Estimate unpaid claims for year-end statutory reporting",
    intendedMeasure: { kind: "central-estimate" },
    basis: { grossNet: "gross", laeTreatment: "dcc-only" },
    accountingDate: "2025-12-31",
    valuationDate: "2025-12-31",
  },
  methods: [
    { methodId: "chainLadder", basisLabel: "paid", parameters: { selected, tailFactor: 1.02 }, resultSummary: { ultimate: cl.totals.ultimate, unpaid: cl.totals.unpaid } },
    { methodId: "mack", basisLabel: "paid", resultSummary: { standardError: mack.totals.standardError } },
  ],
  ledger,
  sdkVersion: "0.1.0",
  generatedAt: "2026-01-05T10:15:00Z",
});
```

## The honest claim

The ASB does not approve, certify, or endorse software, and no software can
be "ASOP-compliant" on its own — compliance is a property of a credentialed
actuary's work in context. This package is **designed to support the
actuary's compliance** with ASOP Nos. 41, 43, 23, 56, and 21 by generating
the disclosures, documentation, and audit artifacts those standards call
for. The generated documents are draft support material for the responsible
actuary to review, edit, and adopt.

## License

Apache-2.0. Copyright 2026 Justin Morrey.
