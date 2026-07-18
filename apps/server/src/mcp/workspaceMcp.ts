/**
 * The governed workspace, exposed over the Model Context Protocol (interop
 * spec rev 2.1 SECTION 8 — a SECURITY policy, followed exactly).
 *
 * The staged-write policy in one sentence: external AI clients READ everything
 * and MUTATE nothing directly; the only way a change enters the workspace over
 * MCP is the SAME four-gate promotion path a human walks, with the deciding
 * actor recorded verbatim in the assumption ledger.
 *
 * EXPOSURE ALLOWLIST (a test asserts the exposed tool list equals this set
 * exactly). Nothing here is a direct mutation — no patchWorkspace, no set_*,
 * no apply_ldf_selections, no run_analysis, no save_note:
 *
 *   READ (7): get_workspace_overview, analyze_development_factors,
 *     assess_data_quality, get_analysis_results, get_diagnostic_detail,
 *     run_sensitivity, crosscheck_with_python
 *   WRITE-shaped (exactly 2, both gated): stage_study, advance_promotion
 *   AGENT: advisor -> ask_advisor (a READ-ONLY advisor, no action tools)
 *
 * TENANT SEAM. Every exposed tool resolves its project id EXCLUSIVELY via
 * requireMcpTenant (the server-set MCP auth info), never from the model. The
 * existing advisor tools read tenantOf(requestContext); the MCP read tools are
 * THIN adapters that bridge authInfo -> a projectId RequestContext and then
 * call the SAME underlying tool logic (no forked business logic). A boot
 * self-test (assertFailClosed) proves the seam fails closed before any client
 * is accepted; startup aborts if it does not.
 *
 * SINGLE-TENANT (v1). One bearer token grants exactly one project
 * (ACTNG_MCP_PROJECT_ID); the bearer middleware places it on req.auth, which
 * the MCP SDK surfaces to tools as context.mcp.extra.authInfo. Absent
 * ACTNG_MCP_TOKEN => MCP is disabled entirely (mountWorkspaceMcp returns
 * false, logged once at boot).
 */

import { timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { MCPServer } from "@mastra/mcp";
import { RequestContext } from "@mastra/core/request-context";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  assertFailClosed,
  createReservingAdvisor,
  defineActuarialTool,
  requireMcpTenant,
  type McpToolContext,
  type ToolEnvelopeFailure,
} from "@actuarial-ts/agents";
import { env } from "../env.js";
import { HttpError } from "../services/workspaceService.js";
import {
  advancePromotion,
  startPromotion,
  type PromotionGateId,
} from "../mastra/promotionRuns.js";
import {
  READ_TOOL_INPUT_SCHEMAS,
  analyzeDevelopmentFactors,
  assessDataQuality,
  crosscheckWithPython,
  getAnalysisResults,
  getDiagnosticDetail,
  getWorkspaceOverview,
  runSensitivityTool,
} from "../mastra/tools.js";
import { WORKBENCH_CONDUCT, WORKBENCH_DOMAIN_INSTRUCTIONS } from "../mastra/advisor.js";

/** Semantic version stamped on the MCP server info. */
const MCP_SERVER_VERSION = "0.1.0";

/** The clock crosses into the promotion chain HERE — the app's boundary. */
const isoNow = (): string => new Date().toISOString();

/** Actor recorded for a promotion decision an MCP client makes without naming one. */
export const DEFAULT_MCP_ACTOR = "external-mcp-client";

// ---------------------------------------------------------------------------
// Tenant-bridged read tools
//
// Each MCP read tool reuses an existing advisor tool's business logic
// unchanged. The bridge: resolve the project id from the MCP auth info (the
// server-set identity), then invoke the underlying tool with a RequestContext
// carrying that project id — the exact seam tenantOf reads. If the auth info
// is absent, requireMcpTenant throws and the defineActuarialTool wrapper turns
// it into a { success:false } envelope: the tool FAILS CLOSED.

/** The structural slice of an underlying advisor tool this adapter drives. */
interface UnderlyingTool {
  id: string;
  description: string;
  /** The Mastra Tool execute; typed opaquely (its input is narrowly typed per tool) and cast at the call site. */
  execute?: unknown;
}

/** The runtime call shape of a Mastra tool's execute: (validated input, execution context). */
type ToolExecute = (input: unknown, context: unknown) => Promise<unknown>;

/** Builds the RequestContext the underlying tool logic expects from a tenant id. */
function tenantRequestContext(projectId: string): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("projectId", projectId);
  return { requestContext };
}

/**
 * Wraps an existing read tool in an MCP variant that resolves its tenant via
 * requireMcpTenant (auth info), then delegates to the SAME tool logic. The
 * input schema is the shared source-of-truth schema, so the variant advertises
 * exactly what the underlying tool validates.
 */
function mcpReadVariant<TShape extends z.ZodRawShape>(
  underlying: UnderlyingTool,
  inputSchema: z.ZodObject<TShape>,
) {
  if (typeof underlying.execute !== "function") {
    throw new Error(`Underlying tool "${underlying.id}" has no execute to bridge over MCP`);
  }
  const runUnderlying = underlying.execute as ToolExecute;
  return defineActuarialTool({
    id: underlying.id,
    description: underlying.description,
    kind: "read",
    inputSchema,
    execute: async (input, context) => {
      const projectId = requireMcpTenant(context as McpToolContext);
      return runUnderlying(input, tenantRequestContext(projectId));
    },
  });
}

const readVariants = {
  get_workspace_overview: mcpReadVariant(
    getWorkspaceOverview,
    READ_TOOL_INPUT_SCHEMAS.get_workspace_overview,
  ),
  analyze_development_factors: mcpReadVariant(
    analyzeDevelopmentFactors,
    READ_TOOL_INPUT_SCHEMAS.analyze_development_factors,
  ),
  assess_data_quality: mcpReadVariant(
    assessDataQuality,
    READ_TOOL_INPUT_SCHEMAS.assess_data_quality,
  ),
  get_analysis_results: mcpReadVariant(
    getAnalysisResults,
    READ_TOOL_INPUT_SCHEMAS.get_analysis_results,
  ),
  get_diagnostic_detail: mcpReadVariant(
    getDiagnosticDetail,
    READ_TOOL_INPUT_SCHEMAS.get_diagnostic_detail,
  ),
  run_sensitivity: mcpReadVariant(runSensitivityTool, READ_TOOL_INPUT_SCHEMAS.run_sensitivity),
  crosscheck_with_python: mcpReadVariant(
    crosscheckWithPython,
    READ_TOOL_INPUT_SCHEMAS.crosscheck_with_python,
  ),
};

// ---------------------------------------------------------------------------
// Write-shaped tools (exactly two — the ONLY way a change enters over MCP)

/**
 * Imports a notebook-authored StudyDoc into the governed promotion path (spec
 * 6). Starts the four-gate chain and returns the intake gate view. This does
 * NOT apply anything: the client then drives advance_promotion gate by gate,
 * exactly as a human reviewer does.
 */
export const stageStudy = defineActuarialTool({
  id: "stage_study",
  description:
    "Import a notebook-authored StudyDoc (interchange kind \"study\") into the workbench's governed study-promotion path and return the first (study-intake) gate view. This is the ONLY way an external MCP client introduces a change, and it applies nothing on its own: read the intake evidence, then drive advance_promotion through replay-verify, rationale, and apply. The project id comes from the MCP request's auth info, never from the model. Pass the whole StudyDoc object under `study`.",
  kind: "action",
  inputSchema: z.object({
    study: z
      .unknown()
      .describe("The StudyDoc JSON object (interchange kind \"study\"), authored via the interchange SDK in a notebook"),
  }),
  execute: async (input, context) => {
    const projectId = requireMcpTenant(context as McpToolContext);
    const study = (input as { study?: unknown }).study;
    if (typeof study !== "object" || study === null || Array.isArray(study)) {
      return {
        success: false,
        error: {
          code: "BAD_INTERCHANGE",
          message: "stage_study requires `study` to be a StudyDoc JSON object (kind \"study\").",
        },
      } satisfies ToolEnvelopeFailure;
    }
    const promotion = await startPromotion(projectId, study, isoNow);
    return { success: true as const, promotion };
  },
});

/**
 * Advances a staged promotion by one governed gate (spec 6). The Gate-2 hard
 * block (a disagreeing cross-engine replay structurally refuses accept -> a
 * DECISION_REJECTED envelope) and the one-advance-at-a-time PROMOTION_BUSY
 * guard flow through the underlying advancePromotion unchanged. The deciding
 * `actor` lands verbatim in the assumption ledger; it defaults to
 * "external-mcp-client" for MCP callers.
 */
export const advancePromotionTool = defineActuarialTool({
  id: "advance_promotion",
  description:
    "Advance a staged study promotion by one governed gate: study-intake -> replay-verify -> rationale -> apply. Supply the runId (from stage_study), the gate, and the decision (accept/approve/apply, or abort). EVERY decision requires a non-blank rationale, recorded verbatim in the assumption ledger; the rationale gate additionally requires an attestation (who authored/reviewed the rationale). `actor` records WHO decided and lands verbatim in the ledger, defaulting to \"external-mcp-client\". The Gate-2 hard block (a disagreeing cross-engine replay refuses accept) and the PROMOTION_BUSY concurrency guard apply unchanged. The project id comes from the MCP request's auth info, never from the model.",
  kind: "action",
  inputSchema: z.object({
    runId: z.string().min(1).describe("The promotion run id returned by stage_study"),
    gate: z.enum(["study-intake", "replay-verify", "rationale", "apply"]),
    decision: z
      .enum(["accept", "approve", "apply", "abort"])
      .describe("study-intake/replay-verify: accept|abort; rationale: approve|abort; apply: apply|abort"),
    rationale: z
      .string()
      .describe("The decision rationale, recorded verbatim in the assumption ledger; must be non-blank"),
    attestation: z
      .string()
      .nullable()
      .optional()
      .describe("Required at the rationale gate: who authored/reviewed the rationale; recorded verbatim"),
    actor: z
      .string()
      .nullable()
      .optional()
      .describe("Who is deciding; recorded verbatim in the ledger. Defaults to \"external-mcp-client\"."),
  }),
  execute: async (input, context) => {
    const projectId = requireMcpTenant(context as McpToolContext);
    if (input.rationale.trim() === "") {
      throw new HttpError(
        422,
        "RATIONALE_REQUIRED",
        `The ${input.gate} gate requires a non-blank rationale; undocumented judgment is what the ledger exists to prevent`,
      );
    }
    const actor = input.actor?.trim();
    const resumeData: Record<string, unknown> = {
      decision: input.decision,
      rationale: input.rationale,
      actor: actor && actor.length > 0 ? actor : DEFAULT_MCP_ACTOR,
    };
    if (input.gate === "rationale") {
      const attestation = input.attestation?.trim() ?? "";
      if (attestation === "") {
        throw new HttpError(
          422,
          "ATTESTATION_REQUIRED",
          "The rationale gate requires an attestation (who authored/reviewed the rationale); it is recorded verbatim in the assumption ledger",
        );
      }
      resumeData.attestation = input.attestation;
    }
    const promotion = await advancePromotion(
      projectId,
      input.runId,
      input.gate as PromotionGateId,
      resumeData,
      isoNow,
    );
    return { success: true as const, promotion };
  },
});

// ---------------------------------------------------------------------------
// Read-only advisor (plan D4 recommendation, pulled forward)
//
// ask_advisor over MCP gets a DEDICATED advisor assembled with ONLY the read
// tools and NO action tools, so prompt injection cannot drive it to mutate the
// workspace: even a fully-compromised prompt has nothing but read tools to
// call. Those read tools are the same tenant-bridged variants exposed
// directly, so they still resolve the tenant via requireMcpTenant — the
// ask_advisor path copies the MCP auth info onto the RequestContext it hands
// the agent, so the advisor's own tool calls read authInfo and work; a call
// that somehow lacks it fails CLOSED. The domain grounding is reused; a
// read-only preamble tells the model it cannot act here and that changes only
// travel through stage_study -> advance_promotion.

const MCP_READONLY_PREAMBLE = `## MCP read-only mode
You are the ActNG reserving advisor exposed over the Model Context Protocol to an external AI client. In this mode you have ONLY read/analyze tools (get_workspace_overview, analyze_development_factors, assess_data_quality, get_diagnostic_detail, get_analysis_results, run_sensitivity, crosscheck_with_python). You CANNOT mutate the workspace here: no applying selections, setting tails, running analyses, capping, or saving notes. The action tools named in the sections below are NOT available to you over MCP; do not attempt to call them. To change the workspace, the external client must go through the governed study-promotion path (stage_study, then advance_promotion gate by gate) exactly as a human reviewer does - that is the only way a change enters, and every decision is recorded with its actor and rationale in the assumption ledger.`;

const anthropic = createAnthropic({
  apiKey: env.anthropicApiKey,
  baseURL: env.anthropicBaseUrl,
});

export const mcpAdvisor = createReservingAdvisor({
  id: "reserving-advisor-readonly",
  name: "Reserving Advisor (read-only)",
  description:
    "Read-only actuarial reserving advisor exposed over MCP: analyzes triangles, development factors, data-quality diagnostics, and analysis results, and cross-checks against the independent second engine. It has NO action tools - over MCP it reads and explains but cannot mutate the workspace; changes travel only through the governed stage_study -> advance_promotion promotion path.",
  model: anthropic(env.advisorModel),
  tools: readVariants,
  domainInstructions: [MCP_READONLY_PREAMBLE, ...WORKBENCH_DOMAIN_INSTRUCTIONS],
  conductOverrides: WORKBENCH_CONDUCT,
});

// ---------------------------------------------------------------------------
// The MCP server

export const workspaceMcp = new MCPServer({
  name: "actng-workspace",
  version: MCP_SERVER_VERSION,
  tools: {
    ...readVariants,
    stage_study: stageStudy,
    advance_promotion: advancePromotionTool,
  },
  agents: { advisor: mcpAdvisor },
});

/**
 * The policy allowlist: the EXACT set of tool names the MCP server exposes
 * (the seven read tools, the two gated write tools, and the read-only
 * advisor's ask_advisor). A test asserts server.getToolListInfo() equals this
 * set — no direct-mutation name (set_*, patch*, apply_*, run_analysis) present.
 */
export const EXPECTED_MCP_TOOL_NAMES: readonly string[] = [
  "get_workspace_overview",
  "analyze_development_factors",
  "assess_data_quality",
  "get_analysis_results",
  "get_diagnostic_detail",
  "run_sensitivity",
  "crosscheck_with_python",
  "stage_study",
  "advance_promotion",
  "ask_advisor",
];

/** The read tool the boot self-test drives without auth to prove fail-closed. */
export const MCP_PROBE_TOOL_ID = "get_workspace_overview";

/**
 * The boot self-test: drive the probe read tool through the server WITHOUT
 * auth info and assert it fails closed with NO_TENANT_CONTEXT. Throws
 * AgentsError("MCP_SELF_TEST_FAILED") if the seam is not wired up. Call at
 * startup when MCP is enabled and ABORT startup if it throws.
 */
export async function runMcpBootSelfTest(): Promise<void> {
  await assertFailClosed({ server: workspaceMcp, probeToolId: MCP_PROBE_TOOL_ID });
}

// ---------------------------------------------------------------------------
// HTTP mount

/** Constant-time bearer comparison (length guard first; timingSafeEqual needs equal lengths). */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Mounts the streamable-HTTP MCP endpoint at /mcp on the given Express app,
 * gated by the bearer token. Returns whether MCP was mounted: absent
 * ACTNG_MCP_TOKEN (or ACTNG_MCP_PROJECT_ID) => not mounted, returns false, and
 * MCP is disabled entirely (the caller logs that once at boot).
 */
export function mountWorkspaceMcp(app: Express): boolean {
  const token = env.mcpToken;
  const projectId = env.mcpProjectId;
  if (!token || !projectId) return false;

  app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? "";
      const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (!presented || !tokensMatch(presented, token)) {
        res.status(401).json({
          error: { code: "MCP_UNAUTHORIZED", message: "Missing or invalid bearer token for the MCP endpoint." },
        });
        return;
      }
      // The tenant seam: the MCP SDK surfaces req.auth as
      // context.mcp.extra.authInfo, which every exposed tool reads via
      // requireMcpTenant. v1 single-tenant: one token grants this one project.
      (req as unknown as { auth?: unknown }).auth = { projectId };
      await workspaceMcp.startHTTP({
        url: new URL(req.originalUrl, `http://${req.headers.host ?? "localhost"}`),
        httpPath: "/mcp",
        req,
        res,
      });
    } catch (err) {
      next(err);
    }
  });
  return true;
}
