import type { CrosscheckReportDoc } from "@actuarial-ts/interchange";
import type { EstimateMetadata } from "./metadata.js";
import type { AssumptionLedger, ChangedAssumptions } from "./ledger.js";
import { MODEL_CARDS, type MethodId } from "./modelCards.js";
import { canonicalJson, fnv1a64 } from "./bundle.js";

/**
 * ASOP No. 41 (Actuarial Communications) disclosure generator.
 *
 * ASOP 41 requires disclosure of the methods, procedures, assumptions, and
 * data underlying the findings with enough clarity that another qualified
 * actuary could objectively appraise the reasonableness of the work. The
 * SDK already knows every method invoked, every parameter, and (through the
 * assumption ledger) which values were machine defaults versus human or
 * agent judgment — so it can render that appendix instead of the actuary
 * reconstructing it by hand.
 *
 * DETERMINISM CONTRACT: identical DisclosureInput yields byte-identical
 * markdown. No clock reads, no randomness — `generatedAt` is an input.
 *
 * The generated document is a DRAFT SUPPORT DOCUMENT for the responsible
 * actuary to review, edit, and adopt; generating it is not compliance.
 */

export interface MethodResultSummary {
  ultimate?: number;
  ibnr?: number;
  unpaid?: number;
  standardError?: number;
}

export interface MethodUse {
  methodId: MethodId;
  /** e.g. "paid", "incurred", "capped layer". */
  basisLabel?: string;
  /** The parameters the method actually ran with (JSON-serializable). */
  parameters?: unknown;
  resultSummary?: MethodResultSummary;
}

/**
 * Structural stand-in for @actuarial-ts/data's DataReviewReport (no package
 * dependency; anything with this shape renders).
 */
export interface DataReviewLike {
  checks: { id: string; description: string; status: string; details: string[] }[];
  summary: { pass: number; warning: number; fail: number; notEvaluated?: number };
}

export interface PriorComparison {
  priorLabel?: string;
  changes: ChangedAssumptions;
  priorReserve?: number;
  currentReserve?: number;
}

export interface DisclosureInput {
  title?: string;
  /** Identification of the responsible actuary (ASOP 41 section 3.1.4). */
  preparedBy?: string;
  metadata: EstimateMetadata;
  methods: MethodUse[];
  ledger?: AssumptionLedger;
  dataReview?: DataReviewLike;
  priorComparison?: PriorComparison;
  reliances?: string[];
  limitations?: string[];
  /**
   * Cross-implementation referee reports (interchange spec 5), rendered as
   * "## 4b. Cross-implementation verification" after Section 4. Omitted or
   * empty = no Section 4b (the disclosure never claims a verification that
   * was not performed).
   */
  crossImplementation?: CrosscheckReportDoc[];
  sdkVersion: string;
  /** Caller-supplied ISO timestamp (determinism: the generator never reads a clock). */
  generatedAt: string;
}

const fmtNumber = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

function describeMeasure(m: EstimateMetadata["intendedMeasure"]): string {
  switch (m.kind) {
    case "central-estimate":
      return "central estimate (actuarial central estimate / expected value)";
    case "high-estimate":
      return "high estimate";
    case "low-estimate":
      return "low estimate";
    case "specified-percentile":
      return `specified percentile (${m.percentile ?? "unstated"})`;
    case "range":
      return "range of reasonable estimates";
  }
}

function describeBasis(b: EstimateMetadata["basis"]): string {
  const gross = {
    gross: "gross of reinsurance",
    "net-of-reinsurance": "net of reinsurance",
    "net-of-salvage-subro": "net of salvage and subrogation",
    "net-all": "net of reinsurance, salvage, and subrogation",
  }[b.grossNet];
  const lae = {
    "excluding-lae": "excluding loss adjustment expenses",
    "including-all-lae": "including all loss adjustment expenses",
    "dcc-only": "including defense and cost containment (DCC) expenses only",
    "aao-only": "including adjusting and other (A&O) expenses only",
  }[b.laeTreatment];
  return `${gross}, ${lae}`;
}

/**
 * Neutralizes document-sourced free text before it is interpolated into the
 * disclosure. Ledger rationales and sources, crosscheck warnings and data
 * review details all originate in DOCUMENTS — and a study's narrative flows
 * into the ledger source with no human edit box in between (the promotion
 * chain writes sourceRef verbatim). Unescaped, a crafted value breaks out of
 * its context and renders as body prose: the demonstrated attack fabricated
 * a certification paragraph in an ASOP 41 disclosure.
 *
 * Division of labour, so nothing is escaped twice: this helper neutralizes
 * CONTENT constructs — backticks (code spans), `<` (raw HTML), newlines
 * (paragraph/bullet breaks) — at the sites where document text is
 * interpolated. mdTable below owns the TABLE-structural escape (pipes) for
 * every cell. Deliberately not a markdown stripper: bold or italics in a
 * rationale render harmlessly inline; only constructs that change document
 * structure are neutralized.
 */
function renderUntrusted(text: string): string {
  return text
    .replace(/`/g, "\\`")
    .replace(/</g, "&lt;")
    .replace(/\r?\n/g, " ");
}

function mdTable(header: string[], rows: string[][]): string[] {
  // Structural escaping for EVERY cell, trusted or not: a pipe or newline in
  // any cell breaks the table for every cell after it. GFM renders \| as a
  // literal pipe, including inside code spans, so code-span cells built from
  // canonicalJson survive intact. Pipes are escaped HERE and only here;
  // renderUntrusted never touches them, so nothing double-escapes.
  const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const out: string[] = [];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`|${header.map(() => "---").join("|")}|`);
  for (const r of rows) out.push(`| ${r.map(cell).join(" | ")} |`);
  return out;
}

function parameterLines(parameters: unknown): string {
  if (parameters === undefined || parameters === null) return "(engine defaults)";
  const json = canonicalJson(parameters);
  return json.length > 400 ? `${json.slice(0, 400)}… (truncated; full value in the reproducibility bundle)` : json;
}

/** REQUIRED Section 4b boilerplate — verbatim per interchange spec section 5. */
const CROSS_IMPLEMENTATION_BOILERPLATE =
  "Agreement between independent implementations supports, but does not by itself constitute, the model validation contemplated by ASOP No. 56; model appropriateness to the book remains a separate professional judgment.";

/** Relative deviations/tolerances render in scientific notation (they live at 1e-9…1e-2 scale). */
const fmtDeviation = (v: number | null): string =>
  v === null ? "—" : v === 0 ? "0" : v.toExponential(2);

type CrosscheckDeviationCell = { ultimate: number | null; unpaid: number | null; standardError: number | null };

function maxAbsDeviation(
  report: CrosscheckReportDoc["report"],
  pick: (cell: CrosscheckDeviationCell) => (number | null)[],
): number | null {
  const cells: CrosscheckDeviationCell[] = [...report.deviations.perOrigin, report.deviations.totals];
  const values = cells.flatMap((cell) => pick(cell).filter((v): v is number => v !== null).map(Math.abs));
  return values.length === 0 ? null : Math.max(...values);
}

const engineLabel = (e: { name: string; version: string }): string => `${e.name} v${e.version}`;

/**
 * `verified-by-value` renders as exactly "verified by value (no independent
 * recomputation)" — spec 5: the disclosure must not overstate what was
 * checked when the selection was value-only.
 */
function verdictLabel(verdict: CrosscheckReportDoc["report"]["verdict"]): string {
  return verdict === "verified-by-value" ? "verified by value (no independent recomputation)" : verdict;
}

/** Renders the ASOP 41-oriented methods-assumptions-and-data appendix. */
export function generateDisclosure(input: DisclosureInput): string {
  const L: string[] = [];
  const m = input.metadata;

  L.push(`# ${input.title ?? "Actuarial analysis: methods, assumptions, and data disclosure"}`);
  L.push("");
  L.push(
    "> Draft support document generated by the actuarial-ts SDK for the responsible actuary's review and adoption. It is designed to support disclosures under ASOP Nos. 41, 43, 23, and 56; responsibility for the actuarial communication and for compliance with the ASOPs remains with the credentialed actuary.",
  );
  L.push("");

  // 1. Identification, purpose, users, measure.
  L.push("## 1. Identification and intended purpose");
  L.push("");
  if (input.preparedBy) L.push(`- **Responsible actuary / preparer:** ${input.preparedBy}`);
  L.push(`- **Intended purpose:** ${m.intendedPurpose}`);
  if (m.intendedUsers && m.intendedUsers.length > 0) {
    L.push(`- **Intended users:** ${m.intendedUsers.join("; ")}`);
  }
  L.push(`- **Intended measure:** ${describeMeasure(m.intendedMeasure)}`);
  L.push(`- **Generated:** ${input.generatedAt} — actuarial-ts SDK v${input.sdkVersion}`);
  L.push("");

  // 2. Scope, dates, basis.
  L.push("## 2. Scope, dates, and basis");
  L.push("");
  L.push(`- **Accounting date:** ${m.accountingDate}`);
  L.push(`- **Valuation date:** ${m.valuationDate}`);
  if (m.reviewDate) L.push(`- **Review date:** ${m.reviewDate}`);
  L.push(`- **Basis:** ${describeBasis(m.basis)}`);
  if (m.currency) L.push(`- **Currency:** ${m.currency}`);
  if (m.scopeNotes) L.push(`- **Scope notes:** ${m.scopeNotes}`);
  L.push("");

  // 3. Data review (ASOP 23).
  L.push("## 3. Data and data review (ASOP No. 23)");
  L.push("");
  if (input.dataReview) {
    const r = input.dataReview;
    const notEvaluated = r.summary.notEvaluated ?? 0;
    L.push(
      `A data review was performed: ${r.checks.length} checks (${r.summary.pass} pass, ${r.summary.warning} warning, ${r.summary.fail} fail${notEvaluated > 0 ? `, ${notEvaluated} not evaluated` : ""}). The checks performed, and their findings, were:`,
    );
    L.push("");
    L.push(
      ...mdTable(
        ["Check", "Description", "Status", "Findings"],
        r.checks.map((c) => [
          c.id,
          c.description,
          c.status.toUpperCase(),
          // The <br> is OURS (one cell, many findings); the details are NOT.
          c.details.length === 0 ? "none" : c.details.map(renderUntrusted).join("<br>"),
        ]),
      ),
    );
  } else {
    L.push(
      "No automated data review report was attached. ASOP No. 23 requires the actuary to review data for reasonableness, consistency, and completeness, or to disclose that no such review was performed and the limitations that imposes.",
    );
  }
  L.push("");

  // 4. Methods and models (ASOP 56).
  L.push("## 4. Methods and models (ASOP No. 56)");
  L.push("");
  for (const use of input.methods) {
    const card = MODEL_CARDS[use.methodId];
    L.push(`### ${card.title}${use.basisLabel ? ` — ${use.basisLabel}` : ""}`);
    L.push("");
    L.push(`- **Intended use:** ${card.intendedUse}`);
    L.push(`- **Specification:** ${card.specification}`);
    L.push(`- **Key assumptions:** ${card.keyAssumptions.join(" ")}`);
    L.push(`- **Known weaknesses:** ${card.weaknesses.join(" ")}`);
    L.push(`- **Primary sensitivities:** ${card.sensitivities.join(" ")}`);
    L.push(`- **Literature:** ${card.literature.join("; ")}`);
    L.push(`- **Parameters this analysis ran with:** \`${parameterLines(use.parameters)}\``);
    if (use.resultSummary) {
      const s = use.resultSummary;
      const bits: string[] = [];
      if (s.ultimate !== undefined) bits.push(`ultimate ${fmtNumber(s.ultimate)}`);
      if (s.ibnr !== undefined) bits.push(`IBNR ${fmtNumber(s.ibnr)}`);
      if (s.unpaid !== undefined) bits.push(`unpaid ${fmtNumber(s.unpaid)}`);
      if (s.standardError !== undefined) bits.push(`standard error ${fmtNumber(s.standardError)}`);
      if (bits.length > 0) L.push(`- **Indicated:** ${bits.join(", ")}`);
    }
    L.push("");
  }

  // 4b. Cross-implementation verification (interchange spec 5) — rendered
  // only when referee reports were actually provided.
  if (input.crossImplementation !== undefined && input.crossImplementation.length > 0) {
    L.push("## 4b. Cross-implementation verification");
    L.push("");
    L.push(
      "The computations were cross-checked against independent implementations via the actuarial-interchange referee. Each row is one referee report (relative deviations; SE = standard error):",
    );
    L.push("");
    L.push(
      ...mdTable(
        [
          "Engine A",
          "Engine B",
          "Profile",
          "Max deviation (central)",
          "Max deviation (SE)",
          "Tolerance (central / SE)",
          "Verdict",
        ],
        input.crossImplementation.map((doc) => {
          const r = doc.report;
          return [
            engineLabel(r.engines.a),
            engineLabel(r.engines.b),
            r.engines.a.conventionProfile ?? r.engines.b.conventionProfile ?? "—",
            fmtDeviation(maxAbsDeviation(r, (cell) => [cell.ultimate, cell.unpaid])),
            fmtDeviation(maxAbsDeviation(r, (cell) => [cell.standardError])),
            `${fmtDeviation(r.tolerance.central)} / ${fmtDeviation(r.tolerance.standardError)}`,
            verdictLabel(r.verdict),
          ];
        }),
      ),
    );
    for (const doc of input.crossImplementation) {
      const r = doc.report;
      if (r.warnings.length === 0) continue;
      L.push("");
      L.push(`**Warnings — ${engineLabel(r.engines.a)} vs ${engineLabel(r.engines.b)}:**`);
      L.push("");
      for (const w of r.warnings) L.push(`- ${renderUntrusted(w)}`);
    }
    L.push("");
    L.push(CROSS_IMPLEMENTATION_BOILERPLATE);
    L.push("");
  }

  // 5. Assumptions and judgments.
  L.push("## 5. Assumptions and judgments");
  L.push("");
  if (input.ledger && input.ledger.entries.length > 0) {
    L.push(
      "Every recorded assumption, distinguishing machine defaults from human or agent judgment (judgment entries carry their rationale and source):",
    );
    L.push("");
    L.push(
      ...mdTable(
        ["#", "When", "Actor", "Assumption", "Value", "Rationale / source"],
        input.ledger.entries.map((e) => [
          String(e.seq),
          e.timestamp,
          e.actor,
          e.field,
          `\`${canonicalJson(e.value)}\``,
          [
            e.rationale === undefined ? "" : renderUntrusted(e.rationale),
            e.source ? `(source: ${renderUntrusted(e.source)})` : "",
          ]
            .filter(Boolean)
            .join(" ") || "—",
        ]),
      ),
    );
  } else {
    L.push("No assumption ledger was attached; assumptions are visible only through Section 4's parameters.");
  }
  L.push("");

  // 6. Changes from the prior analysis.
  L.push("## 6. Changes from the prior analysis");
  L.push("");
  if (input.priorComparison) {
    const pc = input.priorComparison;
    if (pc.priorLabel) L.push(`Prior analysis: ${pc.priorLabel}.`);
    if (pc.priorReserve !== undefined && pc.currentReserve !== undefined) {
      L.push(
        `Carried indication moved from ${fmtNumber(pc.priorReserve)} to ${fmtNumber(pc.currentReserve)} (${fmtNumber(pc.currentReserve - pc.priorReserve)}).`,
      );
    }
    const { added, removed, changed } = pc.changes;
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      L.push("No assumption or method changes were recorded against the prior analysis.");
    } else {
      if (changed.length > 0) {
        L.push("");
        L.push(
          ...mdTable(
            ["Assumption", "Prior", "Current"],
            changed.map((c) => [c.field, `\`${canonicalJson(c.priorValue)}\``, `\`${canonicalJson(c.currentValue)}\``]),
          ),
        );
      }
      if (added.length > 0) L.push(`- **New assumptions:** ${added.join(", ")}`);
      if (removed.length > 0) L.push(`- **Removed assumptions:** ${removed.join(", ")}`);
    }
  } else {
    L.push("No prior-analysis comparison was attached.");
  }
  L.push("");

  // 7. Reliances and limitations.
  L.push("## 7. Reliances and limitations");
  L.push("");
  if (input.reliances && input.reliances.length > 0) {
    for (const r of input.reliances) L.push(`- **Reliance:** ${r}`);
  } else {
    L.push("- No reliances on data or analyses supplied by others were recorded.");
  }
  if (input.limitations && input.limitations.length > 0) {
    for (const lim of input.limitations) L.push(`- **Limitation:** ${lim}`);
  }
  L.push("");

  // 8. Reproducibility.
  L.push("## 8. Reproducibility");
  L.push("");
  const inputHash = fnv1a64(
    canonicalJson({
      metadata: input.metadata,
      methods: input.methods,
      ledger: input.ledger ?? null,
    }),
  );
  L.push(
    `This disclosure derives deterministically from its inputs (integrity tag \`${inputHash}\`, actuarial-ts v${input.sdkVersion}). Rerunning the same inputs on the same SDK version reproduces the analysis and this document byte for byte; pair with a reproducibility bundle for auditor/examiner requests under ASOP No. 21.`,
  );
  L.push("");

  return L.join("\n");
}
