/**
 * Assumption ledger: an append-only record of every assumption an analysis
 * used, separating machine defaults from actuarial/agent judgment, feeding
 * the ASOP 41 assumptions-and-judgments and changes-from-prior disclosures.
 *
 * Ground truth:
 * - The ledger is IMMUTABLE: `recordAssumption` returns a NEW frozen ledger;
 *   the input ledger, its entries array, and every recorded entry are frozen.
 *   Nothing is ever edited or deleted — a corrected assumption is a new entry
 *   for the same field, and the LATEST entry per field is the live value.
 * - `seq` is assigned by the ledger (entries.length + 1), never by the caller.
 * - `rationale` is REQUIRED (throws MISSING_RATIONALE) whenever
 *   actor !== "default": undocumented judgment is exactly what the ledger
 *   exists to prevent. Machine defaults need no rationale — the method's
 *   model card documents them.
 * - `changedAssumptions` diffs the LATEST entry per field on each side and
 *   compares values by canonical JSON, so key insertion order never causes a
 *   false "changed". Output field lists are lexicographically sorted for
 *   deterministic disclosure rendering.
 * - Timestamps are caller-supplied ISO strings (purity: no clock reads).
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP No. 41; responsibility for compliance remains with the credentialed
 * actuary.
 */

import { canonicalJson, ComplianceError } from "./bundle.js";

/** Who set the assumption: the machine default, a credentialed actuary, or an AI agent. */
export type AssumptionActor = "default" | "actuary" | "agent";

/** JSON-representable assumption value (the ledger stores data, not behavior). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AssumptionEntry {
  /** 1-based position in the ledger; assigned by recordAssumption, never by the caller. */
  seq: number;
  /** Caller-supplied ISO timestamp (purity: no clock reads). */
  timestamp: string;
  actor: AssumptionActor;
  /** Dotted path identifying the assumption, e.g. "chainLadder.tailFactor". */
  field: string;
  value: JsonValue;
  /** The value this entry superseded, when the caller knows it. */
  previousValue?: JsonValue;
  /** Where the value came from (e.g. "Friedland Table 15", "rate filing 2024-07"). */
  source?: string;
  /** Why the value was chosen. REQUIRED when actor !== "default". */
  rationale?: string;
}

/** A not-yet-recorded entry: everything but the ledger-assigned seq. */
export type NewAssumptionEntry = Omit<AssumptionEntry, "seq">;

export interface AssumptionLedger {
  readonly entries: readonly AssumptionEntry[];
}

/** An empty, frozen ledger. */
export function createLedger(): AssumptionLedger {
  return Object.freeze({ entries: Object.freeze([]) as readonly AssumptionEntry[] });
}

/**
 * Appends an entry, returning a NEW frozen ledger; the input ledger is
 * untouched. Assigns seq = entries.length + 1. Throws
 * ComplianceError("MISSING_RATIONALE") when actor !== "default" and rationale
 * is missing or blank.
 */
export function recordAssumption(ledger: AssumptionLedger, entry: NewAssumptionEntry): AssumptionLedger {
  if (entry.actor !== "default" && (entry.rationale === undefined || entry.rationale.trim() === "")) {
    throw new ComplianceError(
      "MISSING_RATIONALE",
      `assumption "${entry.field}" set by actor "${entry.actor}" requires a rationale; only actor "default" may omit one`,
    );
  }
  const recorded: AssumptionEntry = Object.freeze({ ...entry, seq: ledger.entries.length + 1 });
  return Object.freeze({ entries: Object.freeze([...ledger.entries, recorded]) });
}

/** Entries that represent judgment (actor !== "default"), in ledger order. */
export function judgmentEntries(ledger: AssumptionLedger): AssumptionEntry[] {
  return ledger.entries.filter((e) => e.actor !== "default");
}

export interface AssumptionValueChange {
  field: string;
  priorValue: JsonValue;
  currentValue: JsonValue;
}

/** The ASOP 41 change-disclosure diff between two analyses' ledgers. */
export interface ChangedAssumptions {
  /** Fields set in current but never set in prior. */
  added: string[];
  /** Fields set in prior but never set in current. */
  removed: string[];
  /** Fields set on both sides whose latest values differ (canonical-JSON inequality). */
  changed: AssumptionValueChange[];
}

/** Latest entry per field; ledger order is seq order, so the last write wins. */
function latestByField(ledger: AssumptionLedger): Map<string, AssumptionEntry> {
  const latest = new Map<string, AssumptionEntry>();
  for (const entry of ledger.entries) latest.set(entry.field, entry);
  return latest;
}

/**
 * Diffs the LATEST entry per field between a prior analysis's ledger and the
 * current one. Values compare by canonical JSON (key order never matters).
 * All output lists are sorted by field for deterministic rendering.
 */
export function changedAssumptions(
  prior: AssumptionLedger,
  current: AssumptionLedger,
): ChangedAssumptions {
  const priorLatest = latestByField(prior);
  const currentLatest = latestByField(current);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: AssumptionValueChange[] = [];
  const fields = [...new Set([...priorLatest.keys(), ...currentLatest.keys()])].sort();
  for (const field of fields) {
    const before = priorLatest.get(field);
    const after = currentLatest.get(field);
    if (before === undefined) {
      if (after !== undefined) added.push(field);
      continue;
    }
    if (after === undefined) {
      removed.push(field);
      continue;
    }
    if (canonicalJson(before.value) !== canonicalJson(after.value)) {
      changed.push({ field, priorValue: before.value, currentValue: after.value });
    }
  }
  return { added, removed, changed };
}
