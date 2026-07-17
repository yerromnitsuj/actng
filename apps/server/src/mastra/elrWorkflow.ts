import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  recordAssumption,
  type AssumptionEntry,
  type AssumptionLedger,
  type JsonValue,
} from "@actuarial-ts/compliance";
import {
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
} from "../services/workspaceService.js";
import { insertNote } from "../db/repo.js";

/**
 * The derive-expected-losses workflow: the pricing-grade a-priori chain
 * (cap -> restoration -> trends -> ELR) as a Mastra workflow with a
 * SUSPEND GATE at every actuarial judgment. Each step gathers evidence
 * through the same service layer the UI uses, states a recommendation with
 * its rationale, and suspends; the advisor presents the gate in chat and
 * resumes with the human's decision. Nothing is applied without a decision,
 * and the accepted trail is persisted as a note at the end.
 *
 * Each decided gate ALSO records its applied assumptions into an
 * @actuarial-ts/compliance ledger threaded through step outputs (the package's
 * recordAssumption helper assigns seq, requires the rationale, and freezes).
 * On completion the ledger JSON is persisted as a second advisor note next to
 * the trail note, so the ASOP 41 assumptions-and-judgments record falls out
 * of running the derivation.
 *
 * NOTE deliberately NOT re-expressed through @actuarial-ts/agents
 * createJudgmentChain: the chain factory's surface (skip gates add trail
 * notes, the outcome is { trail, ledger }, blank rationales hard-fail) would
 * change the suspend/resume/result contract that the advisor tools, the web
 * client, and the integration tests pin ({ trail, selectedElr, noteId },
 * 3-entry trail on the skip path). The workflow keeps its own createWorkflow
 * and borrows the package's ledger-recording helper instead.
 *
 * projectId travels in the workflow requestContext, never in step inputs -
 * the same security seam as every advisor tool.
 */

const requestContextSchema = z.object({ projectId: z.string() });

const trailEntry = z.object({
  stage: z.string(),
  decision: z.string(),
  rationale: z.string(),
});
type Trail = z.infer<typeof trailEntry>[];

// Declares EVERY AssumptionEntry field: zod strips undeclared keys when a
// step's output passes to the next step, and losing previousValue/source
// between gates would corrupt the ledger.
const ledgerEntry = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  actor: z.enum(["default", "actuary", "agent"]),
  field: z.string(),
  value: z.unknown(),
  previousValue: z.unknown().optional(),
  source: z.string().optional(),
  rationale: z.string().optional(),
});

/** The chain state threaded between gates: the human trail plus the compliance ledger. */
const gateState = z.object({
  trail: z.array(trailEntry),
  ledgerEntries: z.array(ledgerEntry),
});

/** Snapshot storage may JSON round-trip step state; restore the concrete entry type. */
function entriesOf(input: { ledgerEntries?: unknown }): AssumptionEntry[] {
  return Array.isArray(input.ledgerEntries) ? (input.ledgerEntries as AssumptionEntry[]) : [];
}

/**
 * Appends one gate's applied assumptions to the threaded ledger via the
 * compliance package's recordAssumption (seq assignment, rationale
 * enforcement, freezing). A blank rationale records nothing rather than
 * failing the gate: recordAssumption refuses undocumented judgment, and this
 * workflow has always tolerated a blank rationale - the trail note still
 * captures the decision either way.
 */
function recordGateEntries(
  existing: readonly AssumptionEntry[],
  stage: string,
  rationale: string,
  fields: { field: string; value: JsonValue }[],
): AssumptionEntry[] {
  if (rationale.trim() === "") return [...existing];
  let ledger: AssumptionLedger = { entries: existing };
  const timestamp = new Date().toISOString();
  for (const f of fields) {
    ledger = recordAssumption(ledger, {
      timestamp,
      actor: "actuary",
      field: f.field,
      value: f.value,
      source: `derive-expected-losses ${stage} gate`,
      rationale,
    });
  }
  return [...ledger.entries];
}

function projectIdOf(requestContext: { get(key: string): unknown }): string {
  const projectId = requestContext.get("projectId");
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("projectId missing from the workflow request context");
  }
  return projectId;
}

// ---------------------------------------------------------------------------
// Gate 1: the development layer (cap or stay unlimited)

const capGate = createStep({
  id: "cap-gate",
  inputSchema: z.object({}),
  outputSchema: gateState,
  suspendSchema: z.object({
    stage: z.literal("cap"),
    recommendation: z.string(),
    evidence: z.unknown(),
  }),
  resumeSchema: z.object({
    decision: z.enum(["accept", "adjust", "skip"]),
    cap: z.number().positive().nullable().optional(),
    indexRate: z.number().gt(-1).optional(),
    rationale: z.string().default(""),
  }),
  execute: async ({ resumeData, suspend, requestContext }) => {
    const projectId = projectIdOf(requestContext);
    if (!resumeData) {
      const view = getWorkspaceView(projectId);
      const review = view.layerReview;
      // Recommend the smallest candidate cap whose pierce share sits in the
      // credible band (1-6%) - or staying unlimited when nothing does.
      const candidate = review.diagnostics.candidates.find(
        (c) => c.totalPierceShare > 0.01 && c.totalPierceShare <= 0.06,
      );
      const recommendation = candidate
        ? `Cap at ${candidate.cap.toLocaleString()} per occurrence (${(candidate.totalPierceShare * 100).toFixed(1)}% of claims pierce, ${(candidate.totalExcessShare * 100).toFixed(1)}% of dollars excess); index it at roughly the severity trend once one is selected`
        : "No candidate cap removes only a thin tail; recommend staying on the unlimited layer";
      await suspend({ stage: "cap", recommendation, evidence: review.diagnostics.candidates });
      return { trail: [], ledgerEntries: [] };
    }
    const trail: Trail = [];
    if (resumeData.decision === "skip") {
      trail.push({
        stage: "cap",
        decision: "stay unlimited",
        rationale: resumeData.rationale,
      });
      return { trail, ledgerEntries: [] };
    }
    if (resumeData.cap == null) {
      throw new Error("accept/adjust at the cap gate needs a cap value");
    }
    patchWorkspace(projectId, {
      layer: {
        cap: resumeData.cap,
        ...(resumeData.indexRate !== undefined ? { indexRate: resumeData.indexRate } : {}),
        active: "capped",
      },
    });
    // Give the capped layer working selections so downstream exhibits exist.
    const view = getWorkspaceView(projectId);
    for (const basis of ["paid", "incurred"] as const) {
      const vw = view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")?.values;
      if (vw) patchWorkspace(projectId, { selections: { basis, selected: vw } });
    }
    runFullAnalysis(projectId, "ELR derivation - capped baseline");
    trail.push({
      stage: "cap",
      decision: `capped at ${resumeData.cap.toLocaleString()}${resumeData.indexRate !== undefined ? ` indexed ${(resumeData.indexRate * 100).toFixed(1)}%/yr` : ""}`,
      rationale: resumeData.rationale,
    });
    const ledgerEntries = recordGateEntries([], "cap", resumeData.rationale, [
      { field: "layer.cap", value: resumeData.cap },
      ...(resumeData.indexRate !== undefined
        ? [{ field: "layer.indexRate", value: resumeData.indexRate }]
        : []),
    ]);
    return { trail, ledgerEntries };
  },
});

// ---------------------------------------------------------------------------
// Gate 2: restoration (only meaningful when the capped layer is active)

const ilfGate = createStep({
  id: "ilf-gate",
  inputSchema: gateState,
  outputSchema: gateState,
  suspendSchema: z.object({
    stage: z.literal("ilf"),
    recommendation: z.string(),
    evidence: z.unknown(),
  }),
  resumeSchema: z.object({
    decision: z.enum(["accept", "adjust", "skip"]),
    source: z.enum(["fitted", "table", "illustrative"]).optional(),
    fittedKind: z.enum(["lognormal", "pareto"]).optional(),
    curveId: z.string().nullable().optional(),
    targetLimit: z.number().positive().nullable().optional(),
    rationale: z.string().default(""),
  }),
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const projectId = projectIdOf(requestContext);
    const priorEntries = entriesOf(inputData);
    const view = getWorkspaceView(projectId);
    if (view.state.layer.active !== "capped") {
      // unlimited path: nothing to restore
      return { trail: inputData.trail, ledgerEntries: priorEntries };
    }
    if (!resumeData) {
      const fits = view.ilfReview.fits;
      const usable = fits
        ? (["lognormal", "pareto"] as const).filter((k) => fits[k].valid)
        : [];
      const recommendation =
        usable.length > 0
          ? `Restore via the fitted ${usable[0]} curve (valid; check the quantile table), unlimited target if the mean is finite - or import an ILF table for a licensed source`
          : "No credible own-data fit: import an ILF table, or use an illustrative curve knowingly (never book against it without judgment)";
      await suspend({
        stage: "ilf",
        recommendation,
        evidence: { fits, unresolvedReason: view.ilfReview.unresolvedReason },
      });
      return { trail: inputData.trail, ledgerEntries: priorEntries };
    }
    const trail = [...inputData.trail];
    if (resumeData.decision === "skip") {
      trail.push({
        stage: "ilf",
        decision: "stay LIMITED (no restoration)",
        rationale: resumeData.rationale,
      });
      return { trail, ledgerEntries: priorEntries };
    }
    patchWorkspace(projectId, {
      ilf: {
        ...(resumeData.source ? { source: resumeData.source } : {}),
        ...(resumeData.fittedKind ? { fittedKind: resumeData.fittedKind } : {}),
        ...(resumeData.curveId !== undefined ? { curveId: resumeData.curveId } : {}),
        ...(resumeData.targetLimit !== undefined
          ? { targetLimit: resumeData.targetLimit }
          : {}),
      },
    });
    runFullAnalysis(projectId, "ELR derivation - restored");
    trail.push({
      stage: "ilf",
      decision: `restore via ${resumeData.source ?? "configured source"}${resumeData.targetLimit ? ` to ${resumeData.targetLimit.toLocaleString()}` : " to unlimited"}`,
      rationale: resumeData.rationale,
    });
    const ledgerEntries = recordGateEntries(priorEntries, "ilf", resumeData.rationale, [
      ...(resumeData.source !== undefined ? [{ field: "ilf.source", value: resumeData.source }] : []),
      ...(resumeData.fittedKind !== undefined
        ? [{ field: "ilf.fittedKind", value: resumeData.fittedKind }]
        : []),
      ...(resumeData.curveId !== undefined ? [{ field: "ilf.curveId", value: resumeData.curveId }] : []),
      ...(resumeData.targetLimit !== undefined
        ? [{ field: "ilf.targetLimit", value: resumeData.targetLimit }]
        : []),
    ]);
    return { trail, ledgerEntries };
  },
});

// ---------------------------------------------------------------------------
// Gate 3: trends

const trendGate = createStep({
  id: "trend-gate",
  inputSchema: gateState,
  outputSchema: gateState,
  suspendSchema: z.object({
    stage: z.literal("trends"),
    recommendation: z.string(),
    evidence: z.unknown(),
  }),
  resumeSchema: z.object({
    decision: z.enum(["accept", "adjust"]),
    frequency: z.number().gt(-1).nullable(),
    severity: z.number().gt(-1).nullable(),
    targetYear: z.number().int().nullable().optional(),
    rationale: z.string().default(""),
  }),
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const projectId = projectIdOf(requestContext);
    if (!resumeData) {
      const view = getWorkspaceView(projectId);
      const review = view.trendReview;
      const best = (fits: { key: string; annualRate: number | null; rSquared: number | null }[]) =>
        fits.find((f) => f.key === "all" && f.annualRate !== null) ?? null;
      const sev = review ? best(review.severity.fits) : null;
      const freq = review ? best(review.frequency.fits) : null;
      const recommendation = review
        ? `Severity ${sev?.annualRate !== null && sev ? `${((sev.annualRate ?? 0) * 100).toFixed(1)}%/yr (all-years fit, R² ${(sev.rSquared ?? 0).toFixed(2)})` : "judgmental (no usable fit)"}; frequency ${freq?.annualRate !== null && freq ? `${((freq.annualRate ?? 0) * 100).toFixed(1)}%/yr (R² ${(freq.rSquared ?? 0).toFixed(2)})` : "flat (no usable fit)"} - treat sub-0.5 R² as noise and select judgmentally`
        : "Run an analysis first; the trend exhibit derives from the latest run";
      await suspend({
        stage: "trends",
        recommendation,
        evidence: review ? { severity: review.severity.fits, frequency: review.frequency.fits, level: review.level } : null,
      });
      return { trail: inputData.trail, ledgerEntries: entriesOf(inputData) };
    }
    const view = getWorkspaceView(projectId);
    const layer = view.state.layer.active;
    patchWorkspace(projectId, {
      trend: {
        frequency: { source: "manual", value: resumeData.frequency },
        severity: { layer, source: "manual", value: resumeData.severity },
        ...(resumeData.targetYear !== undefined ? { targetYear: resumeData.targetYear } : {}),
      },
    });
    runFullAnalysis(projectId, "ELR derivation - trends applied");
    const trail = [...inputData.trail];
    trail.push({
      stage: "trends",
      decision: `frequency ${resumeData.frequency !== null ? `${(resumeData.frequency * 100).toFixed(1)}%/yr` : "none"}, severity ${resumeData.severity !== null ? `${(resumeData.severity * 100).toFixed(1)}%/yr` : "none"}`,
      rationale: resumeData.rationale,
    });
    const ledgerEntries = recordGateEntries(entriesOf(inputData), "trends", resumeData.rationale, [
      { field: "trend.frequency", value: resumeData.frequency },
      { field: `trend.severity.${layer}`, value: resumeData.severity },
      ...(resumeData.targetYear !== undefined
        ? [{ field: "trend.targetYear", value: resumeData.targetYear }]
        : []),
    ]);
    return { trail, ledgerEntries };
  },
});

// ---------------------------------------------------------------------------
// Gate 4: the ELR itself

const elrGate = createStep({
  id: "elr-gate",
  inputSchema: gateState,
  outputSchema: z.object({
    trail: z.array(trailEntry),
    selectedElr: z.number().nullable(),
    noteId: z.string().nullable(),
  }),
  suspendSchema: z.object({
    stage: z.literal("elr"),
    recommendation: z.string(),
    evidence: z.unknown(),
  }),
  resumeSchema: z.object({
    decision: z.enum(["accept", "adjust", "abort"]),
    selected: z.number().positive().optional(),
    rationale: z.string().default(""),
  }),
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const projectId = projectIdOf(requestContext);
    if (!resumeData) {
      const view = getWorkspaceView(projectId);
      const review = view.elrReview;
      const isPP = review?.method === "pure-premium";
      const wtd = review?.averages.find((a) => a.key === "wtd-all")?.value ?? null;
      const cc = review?.capeCodElr.paid ?? null;
      const fmtA = (v: number | null): string =>
        v === null ? "n/a" : isPP ? "$" + Math.round(v).toLocaleString() + "/unit" : (v * 100).toFixed(1) + "%";
      const recommendation = review
        ? `${isPP ? "Exposure-weighted all-years pure premium" : "Premium-weighted all-years loss ratio"} ${fmtA(wtd)}; Cape Cod mechanical cross-check ${fmtA(cc)} (${review.level} level). Anchor on the weighted average unless recent years shifted; heed the circularity warning if a-priori methods carry weight`
        : `No ${view.state.elr.method === "pure-premium" ? "exposure-unit" : "premium"} data: the a-priori exhibit is unavailable`;
      await suspend({
        stage: "elr",
        recommendation,
        evidence: review
          ? { averages: review.averages, capeCodElr: review.capeCodElr, warnings: review.warnings, level: review.level }
          : null,
      });
      return { trail: inputData.trail, selectedElr: null, noteId: null };
    }
    if (resumeData.decision === "abort" || resumeData.selected === undefined) {
      return { trail: inputData.trail, selectedElr: null, noteId: null };
    }
    patchWorkspace(projectId, { elr: { selected: resumeData.selected } });
    runFullAnalysis(projectId, "ELR derivation - final");
    const finalMethod = getWorkspaceView(projectId).state.elr.method;
    const decisionText =
      finalMethod === "pure-premium"
        ? `selected pure premium $${Math.round(resumeData.selected).toLocaleString()}/unit at target level`
        : `selected ELR ${(resumeData.selected * 100).toFixed(1)}% at target level`;
    const trail = [
      ...inputData.trail,
      {
        stage: "elr",
        decision: decisionText,
        rationale: resumeData.rationale,
      },
    ];
    const note = insertNote(
      projectId,
      "advisor",
      `ELR derivation trail:\n${trail
        .map((t) => `- ${t.stage}: ${t.decision}${t.rationale ? ` - ${t.rationale}` : ""}`)
        .join("\n")}`,
    );
    // The compliance fusion: persist the derivation's assumption ledger next
    // to the trail note, entries carrying each gate's verbatim rationale.
    const ledgerEntries = recordGateEntries(entriesOf(inputData), "elr", resumeData.rationale, [
      { field: "elr.selected", value: resumeData.selected },
    ]);
    insertNote(
      projectId,
      "advisor",
      `ELR derivation assumption ledger:\n${JSON.stringify({ entries: ledgerEntries }, null, 2)}`,
    );
    return { trail, selectedElr: resumeData.selected, noteId: note.id };
  },
});

export const deriveExpectedLossesWorkflow = createWorkflow({
  id: "derive-expected-losses",
  inputSchema: z.object({}),
  outputSchema: z.object({
    trail: z.array(trailEntry),
    selectedElr: z.number().nullable(),
    noteId: z.string().nullable(),
  }),
  requestContextSchema,
})
  .then(capGate)
  .then(ilfGate)
  .then(trendGate)
  .then(elrGate)
  .commit();
