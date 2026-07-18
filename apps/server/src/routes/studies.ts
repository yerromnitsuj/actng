import { Router } from "express";
import { z } from "zod";
import { getProject } from "../db/repo.js";
import { HttpError } from "../services/workspaceService.js";
import {
  advancePromotion,
  getPromotionView,
  listPromotionViews,
  startPromotion,
  type PromotionGateId,
} from "../mastra/promotionRuns.js";

/**
 * Study promotion routes (interchange spec rev 2.1, section 6): import a
 * notebook-authored StudyDoc and walk it through the four-gate judgment
 * chain. The UI drives these routes directly - the promotion is a governed
 * surface, deliberately NOT exposed as advisor tools in this phase.
 *
 * POST   /                 body = the StudyDoc JSON; starts the promotion
 * GET    /                 all promotion runs for the project (newest first)
 * GET    /:runId           the described gate/outcome view
 * POST   /:runId/advance   one gate decision (zod-validated per gate)
 *
 * The clock crosses into the promotion chain HERE: packages never read
 * Date, the application supplies it at its boundary.
 */

const isoNow = (): string => new Date().toISOString();

export const studiesRouter = Router({ mergeParams: true });

function requireProject(id: string) {
  const project = getProject(id);
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return project;
}

const rationaleField = z.string().max(4000).optional();
const actorField = z.string().trim().min(1).max(120).optional();

/**
 * One schema per gate (spec 6): intake/replay accept-or-abort, rationale
 * approve-or-abort with the attestation, apply apply-or-abort. Rationale
 * and attestation BLANKNESS is checked after parsing so those violations
 * answer 422 with a named code (the chain enforces the same rule again).
 */
const advanceSchema = z.discriminatedUnion("gate", [
  z.object({
    gate: z.literal("study-intake"),
    decision: z.enum(["accept", "abort"]),
    rationale: rationaleField,
    actor: actorField,
  }),
  z.object({
    gate: z.literal("replay-verify"),
    decision: z.enum(["accept", "abort"]),
    rationale: rationaleField,
    actor: actorField,
  }),
  z.object({
    gate: z.literal("rationale"),
    decision: z.enum(["approve", "abort"]),
    rationale: rationaleField,
    attestation: z.string().max(1000).optional(),
    actor: actorField,
  }),
  z.object({
    gate: z.literal("apply"),
    decision: z.enum(["apply", "abort"]),
    rationale: rationaleField,
    actor: actorField,
  }),
]);

studiesRouter.post("/", async (req, res, next) => {
  try {
    const project = requireProject((req.params as { id: string }).id);
    const study: unknown = req.body;
    if (typeof study !== "object" || study === null || Array.isArray(study)) {
      throw new HttpError(
        422,
        "BAD_INTERCHANGE",
        "The request body must be a StudyDoc JSON object (kind \"study\")",
      );
    }
    const promotion = await startPromotion(project.id, study, isoNow);
    res.status(201).json({ promotion });
  } catch (err) {
    next(err);
  }
});

studiesRouter.get("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  res.json({ promotions: listPromotionViews(project.id) });
});

studiesRouter.get("/:runId", (req, res) => {
  const params = req.params as unknown as { id: string; runId: string };
  const project = requireProject(params.id);
  res.json({ promotion: getPromotionView(project.id, params.runId) });
});

studiesRouter.post("/:runId/advance", async (req, res, next) => {
  try {
    const params = req.params as unknown as { id: string; runId: string };
    const project = requireProject(params.id);
    const body = advanceSchema.parse(req.body);

    // Every decision enters the audit trail with its verbatim rationale.
    const rationale = body.rationale?.trim() ?? "";
    if (rationale === "") {
      throw new HttpError(
        422,
        "RATIONALE_REQUIRED",
        `The ${body.gate} gate requires a non-blank rationale; undocumented judgment is what the ledger exists to prevent`,
      );
    }
    const resumeData: Record<string, unknown> = {
      decision: body.decision,
      rationale: body.rationale,
    };
    if (body.actor !== undefined) resumeData.actor = body.actor;
    if (body.gate === "rationale") {
      // The chain's resume schema requires the attestation for EVERY
      // rationale-gate decision (who authored/reviewed the text on file).
      const attestation = body.attestation?.trim() ?? "";
      if (attestation === "") {
        throw new HttpError(
          422,
          "ATTESTATION_REQUIRED",
          "The rationale gate requires an attestation (who authored/reviewed the rationale); it is recorded verbatim in the assumption ledger",
        );
      }
      resumeData.attestation = body.attestation;
    }

    const promotion = await advancePromotion(
      project.id,
      params.runId,
      body.gate as PromotionGateId,
      resumeData,
      isoNow,
    );
    res.json({ promotion });
  } catch (err) {
    next(err);
  }
});
