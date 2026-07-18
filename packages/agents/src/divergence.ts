/**
 * Divergence explainer (interchange spec rev 2.1, Section 9 item 3): the
 * agent invoked ONLY when the deterministic referee returns verdict
 * "disagree". It never re-judges the comparison - the referee's verdict is
 * final - it produces a structured HYPOTHESIS about why two engines diverged
 * ("engine b requested sigma_interpolation=log-linear; the mack1993-vw
 * profile requires mack; expected signature: SE-concentrated deviations -
 * observed"), for the reviewing actuary to act on.
 *
 * Architecture decisions (each is load-bearing):
 *
 * - EVIDENCE ASSEMBLY IS PURE AND DETERMINISTIC. assembleDivergenceEvidence
 *   is a pure function of (CrosscheckReportDoc, MethodResultDoc a,
 *   MethodResultDoc b) plus the interchange profile registry - no clock, no
 *   randomness, no I/O. The convention map travels AS DATA: the alignment
 *   requirements are imported from @actuarial-ts/interchange's
 *   CONVENTION_PROFILES (the executable form of docs/interop/
 *   convention-map.md), never re-read from a file. Identical inputs yield
 *   identical evidence and an identical prompt, so the fixture tests can
 *   assert exactly what any model would be shown.
 *
 * - ONLY-ON-DISAGREE IS STRUCTURAL. A report whose verdict is not
 *   "disagree" throws AgentsError("VERDICT_NOT_DISAGREE") at assembly time;
 *   there is no flag to loosen. Agreement needs no explaining, and running
 *   an explainer on an agree/verified-by-value report would manufacture
 *   doubt about a comparison the referee already settled.
 *
 * - VIOLATIONS SURFACE FIRST. The requirement-by-requirement alignment
 *   check orders findings violated > unverifiable > satisfied, so the most
 *   probable root cause (a profile requirement the engine visibly did not
 *   run) is the first thing both the model and the human read.
 *
 * - READ-ONLY BY CONSTRUCTION. The explainer gets exactly one tool, and it
 *   only returns the already-assembled evidence (carried on the
 *   RequestContext under DIVERGENCE_EVIDENCE_CONTEXT_KEY); there is no
 *   action tool to reach for. The prompt also embeds the full evidence, so
 *   a single generate call suffices and the tool exists for follow-up
 *   turns, not as a required hop.
 *
 * HOUSE GOTCHA honored: no literal backtick characters in instruction
 * content (a backtick inside a template literal once broke server boot).
 */

import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { ReservingError } from "@actuarial-ts/core";
import {
  CONVENTION_PROFILES,
  crosscheckReportDocSchema,
  methodResultDocSchema,
  type ConventionProfile,
  type CrosscheckReportDoc,
  type EngineAlignment,
  type MethodResultDoc,
} from "@actuarial-ts/interchange";
import { z } from "zod";
import { AgentsError } from "./errors.js";
import { defineActuarialTool, toolRegistry } from "./tools.js";

// ---------------------------------------------------------------------------
// Evidence shapes

/** One profile requirement checked against what an engine actually ran. */
export interface AlignmentFinding {
  /** Which side of the crosscheck this finding is about. */
  engine: "a" | "b";
  engineName: string;
  parameter: string;
  /** The value the convention profile requires for this parameter. */
  required: unknown;
  /** What the engine requested; undefined = the engine recorded no such parameter. */
  requested: unknown;
  /** What the engine says it actually ran when it deviated; undefined = as requested. */
  effective: unknown;
  /**
   * violated = the engine's effective-else-requested value differs from the
   * requirement; satisfied = it matches; unverifiable = the requirement is
   * prose (not a literal pin) or the engine recorded no value to compare.
   */
  status: "violated" | "satisfied" | "unverifiable";
  detail: string;
}

/** One engine's parameter story: what it claimed, requested, and ran. */
export interface EngineParameterEvidence {
  name: string;
  version: string;
  conventionProfile: string | null;
  method: string;
  requested: Record<string, unknown>;
  /** null = the engine deviated nowhere (no effectiveParameters recorded). */
  effective: Record<string, unknown> | null;
  /** The profile's alignment requirements for this engine (entry point,
   * pinned parameters, trap notes), or null when the profile does not know
   * the engine. This IS the convention map, as data. */
  profileAlignment: EngineAlignment | null;
}

/** Where the disagreement concentrates, measured against the applied tolerance. */
export interface DeviationSignature {
  tolerance: { central: number; standardError: number | null };
  /** Max relative deviation across per-origin and total ultimates/unpaid. */
  maxCentral: number;
  /** Max relative SE deviation; null when no SE cell was compared. */
  maxStandardError: number | null;
  centralExceedsTolerance: boolean;
  standardErrorExceedsTolerance: boolean;
  /** central | standard-error | mixed: which metric family breaches tolerance. */
  concentration: "central" | "standard-error" | "mixed" | "none";
  totals: { ultimate: number | null; unpaid: number | null; standardError: number | null };
  /** The largest per-origin deviations, ranked descending (top 5). */
  worstOrigins: {
    origin: string;
    metric: "ultimate" | "unpaid" | "standardError";
    deviation: number;
  }[];
}

/** Everything the explainer (model or human) needs to hypothesize a cause. */
export interface DivergenceEvidence {
  verdict: "disagree";
  profile: {
    /** The convention profile both results claim, or null when none stated. */
    id: string | null;
    /** false = the claimed profile is not in this package's registry. */
    known: boolean;
    description: string | null;
    tolerance: { central: number; standardError: number | null } | null;
  };
  /** Requirement-by-requirement check, VIOLATIONS FIRST (then unverifiable,
   * then satisfied). */
  alignmentFindings: AlignmentFinding[];
  engines: { a: EngineParameterEvidence; b: EngineParameterEvidence };
  deviationSignature: DeviationSignature;
  warnings: { report: string[]; engineA: string[]; engineB: string[] };
}

export interface AssembleDivergenceEvidenceOptions {
  report: CrosscheckReportDoc;
  a: MethodResultDoc;
  b: MethodResultDoc;
}

// ---------------------------------------------------------------------------
// Evidence assembly (pure)

function stableJson(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

function sameValue(x: unknown, y: unknown): boolean {
  return x === y || JSON.stringify(x) === JSON.stringify(y);
}

function validateDoc<T>(
  label: string,
  doc: unknown,
  schema: { safeParse(input: unknown): { success: boolean; data?: T; error?: z.ZodError } },
): T {
  const parsed = schema.safeParse(doc);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `assembleDivergenceEvidence input "${label}" is malformed: ${parsed
        .error!.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data as T;
}

function engineMatches(
  doc: MethodResultDoc,
  stamp: { name: string; version: string },
): boolean {
  return doc.result.engine.name === stamp.name && doc.result.engine.version === stamp.version;
}

const STATUS_RANK: Record<AlignmentFinding["status"], number> = {
  violated: 0,
  unverifiable: 1,
  satisfied: 2,
};

function alignmentFindingsFor(
  side: "a" | "b",
  doc: MethodResultDoc,
  profile: ConventionProfile | null,
  claimedProfileId: string | null,
): AlignmentFinding[] {
  const engineName = doc.result.engine.name;
  if (profile === null) {
    return [
      {
        engine: side,
        engineName,
        parameter: "*",
        required: undefined,
        requested: undefined,
        effective: undefined,
        status: "unverifiable",
        detail:
          claimedProfileId === null
            ? `engine ${side} (${engineName}): no convention profile is claimed on either result, so ` +
              "no alignment requirements exist to check against"
            : `engine ${side} (${engineName}): claimed profile "${claimedProfileId}" is not in the ` +
              "interchange profile registry; its requirements cannot be checked",
      },
    ];
  }
  const alignment =
    (profile.alignment as Record<string, EngineAlignment | undefined>)[engineName] ?? null;
  if (alignment === null) {
    return [
      {
        engine: side,
        engineName,
        parameter: "*",
        required: undefined,
        requested: undefined,
        effective: undefined,
        status: "unverifiable",
        detail:
          `engine ${side} (${engineName}): profile "${profile.id}" has no alignment entry for ` +
          "this engine name; its requirements cannot be checked",
      },
    ];
  }
  const requestedParams = doc.result.parameters;
  const effectiveParams = doc.result.effectiveParameters;
  const findings: AlignmentFinding[] = [];
  for (const [parameter, required] of Object.entries(alignment.parameters)) {
    const requested = requestedParams[parameter];
    const effective = effectiveParams?.[parameter];
    const ran = effective !== undefined ? effective : requested;
    const base: Omit<AlignmentFinding, "status" | "detail"> = {
      engine: side,
      engineName,
      parameter,
      required,
      requested,
      effective,
    };
    if (ran === undefined) {
      findings.push({
        ...base,
        status: "unverifiable",
        detail:
          `engine ${side} (${engineName}) parameter "${parameter}": profile "${profile.id}" requires ` +
          `${stableJson(required)}, but the result records no such parameter (a prose requirement or ` +
          "an unrecorded setting); not mechanically checkable",
      });
    } else if (sameValue(required, ran)) {
      findings.push({
        ...base,
        status: "satisfied",
        detail:
          `engine ${side} (${engineName}) parameter "${parameter}": profile "${profile.id}" requires ` +
          `${stableJson(required)}; the engine ran ${stableJson(ran)}`,
      });
    } else {
      const deviationNote =
        effective !== undefined && !sameValue(effective, requested)
          ? ` (requested ${stableJson(requested)}, effective ${stableJson(effective)})`
          : "";
      findings.push({
        ...base,
        status: "violated",
        detail:
          `VIOLATED: profile "${profile.id}" requires ${parameter}=${stableJson(required)} for ` +
          `${engineName}; engine ${side} ran ${parameter}=${stableJson(ran)}${deviationNote}`,
      });
    }
  }
  return findings;
}

function deviationSignatureOf(report: CrosscheckReportDoc): DeviationSignature {
  const body = report.report;
  const tolerance = {
    central: body.tolerance.central,
    standardError: body.tolerance.standardError,
  };
  let maxCentral = 0;
  let maxSe: number | null = null;
  const ranked: DeviationSignature["worstOrigins"] = [];
  for (const row of body.deviations.perOrigin) {
    for (const metric of ["ultimate", "unpaid"] as const) {
      const deviation = row[metric];
      if (deviation === null) continue;
      maxCentral = Math.max(maxCentral, deviation);
      ranked.push({ origin: row.origin, metric, deviation });
    }
    if (row.standardError !== null) {
      maxSe = Math.max(maxSe ?? 0, row.standardError);
      ranked.push({ origin: row.origin, metric: "standardError", deviation: row.standardError });
    }
  }
  const totals = body.deviations.totals;
  for (const metric of ["ultimate", "unpaid"] as const) {
    const deviation = totals[metric];
    if (deviation !== null) maxCentral = Math.max(maxCentral, deviation);
  }
  if (totals.standardError !== null) maxSe = Math.max(maxSe ?? 0, totals.standardError);

  const centralExceeds = maxCentral > tolerance.central;
  const seExceeds =
    tolerance.standardError !== null && maxSe !== null && maxSe > tolerance.standardError;
  const concentration: DeviationSignature["concentration"] =
    centralExceeds && seExceeds
      ? "mixed"
      : centralExceeds
        ? "central"
        : seExceeds
          ? "standard-error"
          : "none";
  ranked.sort((x, y) => y.deviation - x.deviation);
  return {
    tolerance,
    maxCentral,
    maxStandardError: maxSe,
    centralExceedsTolerance: centralExceeds,
    standardErrorExceedsTolerance: seExceeds,
    concentration,
    totals: {
      ultimate: totals.ultimate,
      unpaid: totals.unpaid,
      standardError: totals.standardError,
    },
    worstOrigins: ranked.slice(0, 5),
  };
}

/**
 * Assembles the divergence evidence for a disagree crosscheck: pure and
 * deterministic (see the module doc). Throws:
 * - AgentsError("VERDICT_NOT_DISAGREE") when the report's verdict is not
 *   "disagree" - the only-on-disagree rule is structural, not advisory;
 * - AgentsError("DIVERGENCE_INPUT_MISMATCH") when the supplied result docs
 *   do not match the report's engine stamps (wrong docs, or a/b swapped);
 * - ReservingError("BAD_INTERCHANGE") when any input document is malformed.
 */
export function assembleDivergenceEvidence(
  options: AssembleDivergenceEvidenceOptions,
): DivergenceEvidence {
  const report = validateDoc<CrosscheckReportDoc>(
    "report",
    options.report,
    crosscheckReportDocSchema,
  );
  const a = validateDoc<MethodResultDoc>("a", options.a, methodResultDocSchema);
  const b = validateDoc<MethodResultDoc>("b", options.b, methodResultDocSchema);
  const body = report.report;

  if (body.verdict !== "disagree") {
    throw new AgentsError(
      "VERDICT_NOT_DISAGREE",
      `The divergence explainer is invoked ONLY on a "disagree" crosscheck verdict (spec 9 item 3); ` +
        `this report's verdict is "${body.verdict}" - there is no divergence to explain`,
    );
  }
  if (!engineMatches(a, body.engines.a) || !engineMatches(b, body.engines.b)) {
    const swapped = engineMatches(a, body.engines.b) && engineMatches(b, body.engines.a);
    throw new AgentsError(
      "DIVERGENCE_INPUT_MISMATCH",
      swapped
        ? "The supplied result docs are SWAPPED relative to the report: doc a matches the report's " +
            "engine b and vice versa; pass them in the report's a/b order"
        : `The supplied result docs do not match the report's engine stamps: report compared ` +
            `a=${body.engines.a.name}@${body.engines.a.version} vs ` +
            `b=${body.engines.b.name}@${body.engines.b.version}, got ` +
            `a=${a.result.engine.name}@${a.result.engine.version} and ` +
            `b=${b.result.engine.name}@${b.result.engine.version}`,
    );
  }

  const claimedProfileId =
    a.result.engine.conventionProfile ?? b.result.engine.conventionProfile ?? null;
  const profile = claimedProfileId !== null ? (CONVENTION_PROFILES[claimedProfileId] ?? null) : null;

  const engineEvidenceOf = (doc: MethodResultDoc): EngineParameterEvidence => ({
    name: doc.result.engine.name,
    version: doc.result.engine.version,
    conventionProfile: doc.result.engine.conventionProfile ?? null,
    method: doc.result.method,
    requested: doc.result.parameters,
    effective: doc.result.effectiveParameters ?? null,
    profileAlignment:
      profile === null
        ? null
        : ((profile.alignment as Record<string, EngineAlignment | undefined>)[
            doc.result.engine.name
          ] ?? null),
  });

  const findings = [
    ...alignmentFindingsFor("a", a, profile, claimedProfileId),
    ...alignmentFindingsFor("b", b, profile, claimedProfileId),
  ].sort((x, y) => STATUS_RANK[x.status] - STATUS_RANK[y.status]);

  return {
    verdict: "disagree",
    profile: {
      id: claimedProfileId,
      known: profile !== null,
      description: profile?.description ?? null,
      tolerance: profile !== null ? { ...profile.tolerance } : null,
    },
    alignmentFindings: findings,
    engines: { a: engineEvidenceOf(a), b: engineEvidenceOf(b) },
    deviationSignature: deviationSignatureOf(report),
    warnings: {
      report: [...body.warnings],
      engineA: [...(a.result.warnings ?? [])],
      engineB: [...(b.result.warnings ?? [])],
    },
  };
}

// ---------------------------------------------------------------------------
// Structured hypothesis

/** The explainer's structured output (spec 9 item 3). */
export const divergenceHypothesisSchema = z.object({
  /** The single most probable root cause, stated as a testable claim. */
  suspectedCause: z.string().min(1),
  /** The exact misaligned parameter/flag name (e.g. "sigma_interpolation"),
   * or null when no specific flag is implicated. */
  misalignedFlag: z.string().min(1).nullable(),
  /** The deviation signature the suspected cause WOULD produce. */
  expectedSignature: z.string().min(1),
  /** The deviation signature the evidence actually shows. */
  observedSignature: z.string().min(1),
  /** What the operator should do next to confirm or fix. */
  recommendation: z.string().min(1),
});

export type DivergenceHypothesis = z.infer<typeof divergenceHypothesisSchema>;

// ---------------------------------------------------------------------------
// Instructions + prompt assembly (pure, deterministic)

/** RequestContext key the evidence tool reads (set by explainDivergence). */
export const DIVERGENCE_EVIDENCE_CONTEXT_KEY = "divergenceEvidence";

/**
 * The explainer's instruction template. A constant, not a builder: the
 * explainer has exactly one job and no host-specific domain sections. No
 * backtick characters (house gotcha).
 */
export const DIVERGENCE_EXPLAINER_INSTRUCTIONS = [
  "You are a cross-engine divergence diagnostician inside an actuarial reserving toolchain. A deterministic referee compared the same computation run by two independent engines and returned the verdict \"disagree\". Your job is to produce a structured HYPOTHESIS about the root cause - you never re-litigate the verdict, and you never change any state.",
  "## Working rules",
  [
    "1. Every claim you make must come from the supplied divergence evidence (in the user message, and available again via the get_divergence_evidence tool). Never invent parameters, deviations, or profile requirements.",
    "2. The alignment findings are ordered violations first. A VIOLATED finding - a convention-profile requirement the engine visibly did not run - is the strongest root-cause candidate; check whether its expected deviation signature matches the observed one before settling on it.",
    "3. The deviation signature tells you WHERE the disagreement lives: central estimates (ultimates/unpaid), standard errors, or both. A sigma/variance-convention misalignment concentrates in standard errors while central estimates agree; a factor/selection misalignment moves central estimates.",
    "4. In misalignedFlag, name the exact parameter as it appears in the evidence (for example sigma_interpolation), or use null when no specific flag is implicated.",
    "5. Be direct and technical; the reader is a credentialed actuary. State the hypothesis, the expected vs observed signature, and one concrete next step.",
  ].join("\n"),
].join("\n\n");

/**
 * Deterministic user-prompt assembly: a readable summary (violations first,
 * then the deviation signature) followed by the full evidence as JSON.
 * Identical evidence yields a byte-identical prompt, so tests can pin
 * exactly what any model is shown.
 */
export function assembleDivergencePrompt(evidence: DivergenceEvidence): string {
  const sig = evidence.deviationSignature;
  const profileLine =
    evidence.profile.id === null
      ? "Convention profile: none claimed."
      : `Convention profile: "${evidence.profile.id}"${evidence.profile.known ? "" : " (NOT in the registry)"} - ${
          evidence.profile.description ?? "no description"
        }`;
  const findingLines = evidence.alignmentFindings.map(
    (f) => `- [${f.status.toUpperCase()}] ${f.detail}`,
  );
  const seLine =
    sig.maxStandardError === null
      ? "standard errors: not compared"
      : `max standard-error deviation ${sig.maxStandardError} (tolerance ${
          sig.tolerance.standardError ?? "out of scope"
        }; ${sig.standardErrorExceedsTolerance ? "EXCEEDED" : "within"})`;
  const sections = [
    "A crosscheck referee compared two engines running the same computation and returned verdict DISAGREE.",
    `Engine a: ${evidence.engines.a.name}@${evidence.engines.a.version} (method ${evidence.engines.a.method}). ` +
      `Engine b: ${evidence.engines.b.name}@${evidence.engines.b.version} (method ${evidence.engines.b.method}).`,
    profileLine,
    "Alignment findings (violations first):\n" + findingLines.join("\n"),
    `Deviation signature: concentration ${sig.concentration}; max central deviation ${sig.maxCentral} ` +
      `(tolerance ${sig.tolerance.central}; ${sig.centralExceedsTolerance ? "EXCEEDED" : "within"}); ${seLine}.`,
    "Full assembled evidence (JSON):\n" + JSON.stringify(evidence, null, 2),
    "Produce the structured hypothesis: suspectedCause, misalignedFlag (the exact parameter name, or null), expectedSignature, observedSignature, recommendation.",
  ];
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// The read-only evidence tool

/**
 * The explainer's single tool: returns the already-assembled evidence from
 * the request context. Read-only by construction - it can only restate what
 * explainDivergence assembled; there is nothing to mutate.
 */
export function createDivergenceEvidenceTool() {
  return defineActuarialTool({
    id: "get_divergence_evidence",
    description:
      "Returns the assembled divergence evidence for the disagree crosscheck under review: " +
      "convention-profile alignment requirements, each engine's requested vs effective parameters, " +
      "requirement-by-requirement findings (violations first), the deviation signature, and all " +
      "warnings. Read-only.",
    kind: "read",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const evidence = context.requestContext?.get(DIVERGENCE_EVIDENCE_CONTEXT_KEY);
      if (evidence === undefined) {
        throw new AgentsError(
          "NO_DIVERGENCE_EVIDENCE",
          `No assembled divergence evidence in the request context (key "${DIVERGENCE_EVIDENCE_CONTEXT_KEY}"); ` +
            "drive this agent through explainDivergence, which assembles and injects it",
        );
      }
      return { success: true as const, evidence: evidence as DivergenceEvidence };
    },
  });
}

// ---------------------------------------------------------------------------
// Agent factory + driver

/** Config slices lifted from the installed Agent constructor so the factory tracks the host's Mastra version. */
type AgentCtorConfig = ConstructorParameters<typeof Agent>[0];

export interface CreateDivergenceExplainerOptions {
  /** Defaults to "divergence-explainer". */
  id?: string;
  /** Defaults to "Divergence Explainer". */
  name?: string;
  description?: string;
  /** The language model (same type the host's Agent constructor takes). */
  model: AgentCtorConfig["model"];
}

/**
 * Builds the divergence-explainer Agent: the constant instruction template
 * plus the single read-only evidence tool. Drive it with explainDivergence,
 * which assembles the evidence, injects it into the request context, and
 * runs the one structured-output generate call.
 */
export function createDivergenceExplainer(options: CreateDivergenceExplainerOptions): Agent {
  return new Agent({
    id: options.id ?? "divergence-explainer",
    name: options.name ?? "Divergence Explainer",
    description:
      options.description ??
      "Cross-engine divergence diagnostician: on a disagree crosscheck verdict, reads the assembled " +
        "evidence (profile requirements, requested vs effective parameters, deviation signature) and " +
        "produces a structured root-cause hypothesis. Read-only; never re-judges the referee.",
    instructions: DIVERGENCE_EXPLAINER_INSTRUCTIONS,
    model: options.model,
    tools: toolRegistry([createDivergenceEvidenceTool()]).tools,
  });
}

/**
 * The structural slice of an agent explainDivergence needs: generate with a
 * structured-output option resolving to { object }. Structural on purpose
 * (mirrors evals.ts' ToolStreamingAgent): package tests substitute a canned
 * stub with no LLM, and hosts pass any compatible Mastra Agent.
 */
export interface StructuredGeneratingAgent {
  generate(
    messages: Array<{ role: "user"; content: string }>,
    options?: Record<string, unknown>,
  ): Promise<{ object?: unknown }>;
}

/** The request-context slice explainDivergence needs (Mastra's RequestContext satisfies it). */
export interface DivergenceRequestContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface ExplainDivergenceOptions {
  explainer: StructuredGeneratingAgent;
  report: CrosscheckReportDoc;
  a: MethodResultDoc;
  b: MethodResultDoc;
  /**
   * Host request context (the evidence is set on it under
   * DIVERGENCE_EVIDENCE_CONTEXT_KEY); a fresh RequestContext is created when
   * omitted. The tenant seam is untouched either way - this key carries
   * evidence, never identity.
   */
  requestContext?: DivergenceRequestContext;
  /** Max agent steps for the single generate call. Default 4 (evidence is
   * in the prompt; the tool is an optional re-read, not a required hop). */
  maxSteps?: number;
}

export interface DivergenceExplanation {
  hypothesis: DivergenceHypothesis;
  evidence: DivergenceEvidence;
  /** The exact prompt the model was shown (byte-deterministic per evidence). */
  prompt: string;
}

/**
 * Drives one structured-output generate call: assembles the evidence
 * (throwing on a non-disagree verdict), injects it into the request context
 * for the evidence tool, prompts the explainer, and zod-validates the
 * model's hypothesis before returning it - the boundary is validated in
 * both directions.
 */
export async function explainDivergence(
  options: ExplainDivergenceOptions,
): Promise<DivergenceExplanation> {
  const evidence = assembleDivergenceEvidence({
    report: options.report,
    a: options.a,
    b: options.b,
  });
  const requestContext = options.requestContext ?? new RequestContext();
  requestContext.set(DIVERGENCE_EVIDENCE_CONTEXT_KEY, evidence);
  const prompt = assembleDivergencePrompt(evidence);
  const result = await options.explainer.generate([{ role: "user", content: prompt }], {
    structuredOutput: { schema: divergenceHypothesisSchema },
    requestContext,
    maxSteps: options.maxSteps ?? 4,
  });
  const hypothesis = divergenceHypothesisSchema.parse(result.object);
  return { hypothesis, evidence, prompt };
}
