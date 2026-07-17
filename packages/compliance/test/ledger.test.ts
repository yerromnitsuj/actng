import { describe, expect, it } from "vitest";
import { ComplianceError } from "../src/bundle.js";
import type { AssumptionLedger, NewAssumptionEntry } from "../src/ledger.js";
import {
  changedAssumptions,
  createLedger,
  judgmentEntries,
  recordAssumption,
} from "../src/ledger.js";

function entry(overrides: Partial<NewAssumptionEntry> = {}): NewAssumptionEntry {
  return {
    timestamp: "2026-07-17T09:00:00Z",
    actor: "default",
    field: "chainLadder.tailFactor",
    value: 1.05,
    ...overrides,
  };
}

function expectComplianceError(fn: () => unknown, code: string): ComplianceError {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ComplianceError);
  const complianceError = thrown as ComplianceError;
  expect(complianceError.code).toBe(code);
  return complianceError;
}

describe("createLedger", () => {
  it("starts empty", () => {
    expect(createLedger().entries).toEqual([]);
  });
});

describe("recordAssumption", () => {
  it("assigns seq = entries.length + 1 and preserves the entry fields", () => {
    let ledger = createLedger();
    ledger = recordAssumption(ledger, entry({ field: "a" }));
    ledger = recordAssumption(
      ledger,
      entry({ field: "b", actor: "actuary", rationale: "industry benchmark", source: "Friedland Table 15" }),
    );
    ledger = recordAssumption(ledger, entry({ field: "c", value: { x: 1 } }));

    expect(ledger.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    const second = ledger.entries[1]!;
    expect(second.field).toBe("b");
    expect(second.actor).toBe("actuary");
    expect(second.rationale).toBe("industry benchmark");
    expect(second.source).toBe("Friedland Table 15");
    expect(second.timestamp).toBe("2026-07-17T09:00:00Z");
  });

  it("returns a NEW ledger and never mutates the input (immutability)", () => {
    const before = recordAssumption(createLedger(), entry({ field: "a" }));
    const beforeEntries = before.entries;

    const after = recordAssumption(before, entry({ field: "b" }));

    expect(after).not.toBe(before);
    expect(before.entries).toBe(beforeEntries);
    expect(before.entries).toHaveLength(1);
    expect(after.entries).toHaveLength(2);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.entries)).toBe(true);
    expect(Object.isFrozen(after.entries[1])).toBe(true);
  });

  it("throws MISSING_RATIONALE when an actuary omits the rationale", () => {
    const err = expectComplianceError(
      () => recordAssumption(createLedger(), entry({ actor: "actuary" })),
      "MISSING_RATIONALE",
    );
    expect(err.message).toContain("chainLadder.tailFactor");
    expect(err.message).toContain("actuary");
  });

  it("throws MISSING_RATIONALE on a blank rationale", () => {
    expectComplianceError(
      () => recordAssumption(createLedger(), entry({ actor: "agent", rationale: "   " })),
      "MISSING_RATIONALE",
    );
  });

  it("allows actor default without a rationale, and judgment with one", () => {
    let ledger = createLedger();
    ledger = recordAssumption(ledger, entry({ actor: "default" }));
    ledger = recordAssumption(
      ledger,
      entry({ field: "bf.aprioriLossRatio", actor: "agent", rationale: "fit to latest three diagonals" }),
    );
    expect(ledger.entries).toHaveLength(2);
  });
});

describe("judgmentEntries", () => {
  it("returns only entries where actor is not default, in ledger order", () => {
    let ledger = createLedger();
    ledger = recordAssumption(ledger, entry({ field: "a", actor: "default" }));
    ledger = recordAssumption(ledger, entry({ field: "b", actor: "actuary", rationale: "r1" }));
    ledger = recordAssumption(ledger, entry({ field: "c", actor: "agent", rationale: "r2" }));
    expect(judgmentEntries(ledger).map((e) => e.field)).toEqual(["b", "c"]);
  });
});

describe("changedAssumptions", () => {
  function ledgerOf(...entries: NewAssumptionEntry[]): AssumptionLedger {
    return entries.reduce((ledger, e) => recordAssumption(ledger, e), createLedger());
  }

  it("reports added, removed, and value-changed fields, sorted by field", () => {
    const prior = ledgerOf(
      entry({ field: "tail", value: 1.05 }),
      entry({ field: "trend", value: 0.03 }),
      entry({ field: "elr", value: 0.65 }),
    );
    const current = ledgerOf(
      entry({ field: "tail", value: 1.1 }),
      entry({ field: "elr", value: 0.65 }),
      entry({ field: "capeCod.decay", value: 0.75 }),
    );

    const report = changedAssumptions(prior, current);
    expect(report.added).toEqual(["capeCod.decay"]);
    expect(report.removed).toEqual(["trend"]);
    expect(report.changed).toEqual([{ field: "tail", priorValue: 1.05, currentValue: 1.1 }]);
  });

  it("uses the LATEST entry per field on each side", () => {
    const prior = ledgerOf(
      entry({ field: "tail", value: 1.02 }),
      entry({ field: "tail", value: 1.05, actor: "actuary", rationale: "override" }),
    );
    const current = ledgerOf(
      entry({ field: "tail", value: 1.05 }),
      entry({ field: "tail", value: 1.1, actor: "actuary", rationale: "new fit" }),
    );

    const report = changedAssumptions(prior, current);
    expect(report.changed).toEqual([{ field: "tail", priorValue: 1.05, currentValue: 1.1 }]);
    // A field whose latest value is unchanged is not reported even if its history moved.
    const backToStart = ledgerOf(
      entry({ field: "tail", value: 1.1, actor: "actuary", rationale: "tried" }),
      entry({ field: "tail", value: 1.05 }),
    );
    expect(changedAssumptions(prior, backToStart)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("compares values canonically: key order and -0 never cause a false change", () => {
    const prior = ledgerOf(
      entry({ field: "curve", value: { a: 1, b: [1, 2] } }),
      entry({ field: "zero", value: -0 }),
    );
    const current = ledgerOf(
      entry({ field: "curve", value: { b: [1, 2], a: 1 } }),
      entry({ field: "zero", value: 0 }),
    );
    expect(changedAssumptions(prior, current)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("still flags genuinely different structured values", () => {
    const prior = ledgerOf(entry({ field: "curve", value: { a: 1, b: [1, 2] } }));
    const current = ledgerOf(entry({ field: "curve", value: { a: 1, b: [2, 1] } }));
    const report = changedAssumptions(prior, current);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]!.field).toBe("curve");
  });

  it("sorts every output list by field for deterministic disclosure rendering", () => {
    const prior = ledgerOf(entry({ field: "z", value: 1 }), entry({ field: "a", value: 1 }));
    const current = ledgerOf(entry({ field: "m", value: 1 }), entry({ field: "b", value: 1 }));
    const report = changedAssumptions(prior, current);
    expect(report.added).toEqual(["b", "m"]);
    expect(report.removed).toEqual(["a", "z"]);
  });

  it("returns an empty report for identical ledgers", () => {
    const ledger = ledgerOf(entry({ field: "tail", value: 1.05 }));
    expect(changedAssumptions(ledger, ledger)).toEqual({ added: [], removed: [], changed: [] });
  });
});
