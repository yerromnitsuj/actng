import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
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
  outputSchema: z.object({ trail: z.array(trailEntry) }),
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
      return { trail: [] };
    }
    const trail: Trail = [];
    if (resumeData.decision === "skip") {
      trail.push({
        stage: "cap",
        decision: "stay unlimited",
        rationale: resumeData.rationale,
      });
      return { trail };
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
    return { trail };
  },
});

// ---------------------------------------------------------------------------
// Gate 2: restoration (only meaningful when the capped layer is active)

const ilfGate = createStep({
  id: "ilf-gate",
  inputSchema: z.object({ trail: z.array(trailEntry) }),
  outputSchema: z.object({ trail: z.array(trailEntry) }),
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
    const view = getWorkspaceView(projectId);
    if (view.state.layer.active !== "capped") {
      return { trail: inputData.trail }; // unlimited path: nothing to restore
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
      return { trail: inputData.trail };
    }
    const trail = [...inputData.trail];
    if (resumeData.decision === "skip") {
      trail.push({
        stage: "ilf",
        decision: "stay LIMITED (no restoration)",
        rationale: resumeData.rationale,
      });
      return { trail };
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
    return { trail };
  },
});

// ---------------------------------------------------------------------------
// Gate 3: trends

const trendGate = createStep({
  id: "trend-gate",
  inputSchema: z.object({ trail: z.array(trailEntry) }),
  outputSchema: z.object({ trail: z.array(trailEntry) }),
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
      return { trail: inputData.trail };
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
    return { trail };
  },
});

// ---------------------------------------------------------------------------
// Gate 4: the ELR itself

const elrGate = createStep({
  id: "elr-gate",
  inputSchema: z.object({ trail: z.array(trailEntry) }),
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
