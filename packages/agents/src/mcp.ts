/**
 * MCP tenant seam + boot self-test for the governed workspace.
 *
 * When the workspace is exposed over the Model Context Protocol, external AI
 * clients read everything and mutate nothing directly. The one hard guarantee
 * is that EVERY exposed tool resolves its tenant (project id) from the MCP
 * request's auth info, never from the model — the same secureToolWrapper rule
 * the ActNG server proved in production, restated for the MCP transport.
 *
 * @mastra/mcp gives no built-in per-tool authorization outside its EE FGA path,
 * so a missed wire-up FAILS OPEN: a tool that forgets to read authInfo would
 * happily serve an unauthenticated caller. These two helpers close that caveat:
 *
 * 1. requireMcpTenant — the read side. A tool calls it instead of trusting the
 *    model; absent auth info it THROWS AgentsError("NO_TENANT_CONTEXT"), which
 *    the defineActuarialTool wrapper turns into a { success:false } envelope.
 *    A tool built on it fails CLOSED.
 *
 * 2. assertFailClosed — the proof. At server startup, drive a probe read tool
 *    through the server WITHOUT auth and assert it fails closed. If the probe
 *    SUCCEEDS, the seam is not wired up: this throws MCP_SELF_TEST_FAILED and
 *    startup MUST abort.
 *
 * ---------------------------------------------------------------------------
 * VERIFIED against the installed @mastra/mcp 1.14.0 (house rule — types and
 * compiled source, not memory):
 *
 * - MCPServer.executeTool(toolId, args, executionContext?: { messages?,
 *   toolCallId?, requestContext? }): Promise<any> returns the tool's execute
 *   result VERBATIM (dist/index.js: `const result = await tool.execute(...);
 *   return result;`). For a defineActuarialTool with no outputSchema the core
 *   tool builder passes the value through untouched, so an executeTool caller
 *   sees exactly the { success:false, error:{ code } } envelope the wrapper
 *   produced. Argument validation runs FIRST and, on failure, short-circuits
 *   to a { error:true, message } object before the tool ever executes — hence
 *   assertFailClosed passes minimal VALID probe args.
 *
 * - Auth-context access path. On the real streamable-HTTP call path the SDK
 *   copies the transport `extra` (with `authInfo` from `req.auth`) into the
 *   tool context TWO ways: directly at `context.mcp.extra`, and — via
 *   createProxiedRequestContext — as INDIVIDUAL keys set on a fresh
 *   RequestContext (`context.requestContext.get("authInfo")`). NOTE the
 *   surprise: the installed 1.14.0 sets each extra key on the RequestContext
 *   verbatim, so the tenant lives at `requestContext.get("authInfo")`, NOT
 *   under a single `"mcp.extra"` key as the research draft documented. This
 *   helper tries all three shapes so it is correct against both the installed
 *   package and the documented pattern.
 */

import type { ActuarialToolContext, ToolEnvelopeFailure } from "./tools.js";
import { resolveTenant } from "./tools.js";
import { AgentsError, type AgentsErrorCode } from "./errors.js";

// ---------------------------------------------------------------------------
// Tenant seam (read side)

/**
 * The MCP auth-info bag: whatever the host's bearer-token middleware set on
 * `req.auth` before delegating to startHTTP (e.g. `{ projectId }`). Values are
 * unknown — requireMcpTenant proves the tenant is a non-empty string.
 */
export interface McpAuthInfo {
  [key: string]: unknown;
}

/**
 * The transport `extra` (MCP SDK RequestHandlerExtra) surfaced to a tool at
 * `context.mcp.extra`. Only `authInfo` is load-bearing here; the rest
 * (sessionId, requestInfo, signal, ...) is carried opaquely.
 */
export interface McpRequestExtra {
  authInfo?: McpAuthInfo;
  [key: string]: unknown;
}

/**
 * The structural slice of a Mastra tool-execution context this seam needs on
 * the MCP path: the tenant-seam `requestContext` (inherited from
 * ActuarialToolContext) plus the MCP-specific `mcp.extra`. Typed structurally
 * so tests exercise the helper with a plain object and no live MCP server.
 */
export interface McpToolContext extends ActuarialToolContext {
  mcp?: { extra?: McpRequestExtra };
}



/**
 * Reads the tenant id (default key "projectId") from the MCP execution
 * context's auth info — the server-set identity, never the model. THROWS a
 * typed AgentsError("NO_TENANT_CONTEXT") when the auth info or the key is
 * absent, non-string, or empty. Inside a defineActuarialTool execute the
 * wrapper converts that throw into a { success:false } envelope, so a tool
 * built on requireMcpTenant fails CLOSED for any unauthenticated MCP caller.
 */
export function requireMcpTenant(context: McpToolContext | undefined, key = "projectId"): string {
  // One seam, one reader: this is resolveTenant with the MCP source pinned.
  // Prefer declaring `tenant: "required", tenantSource: "mcp-auth"` on the
  // tool itself, which makes the wrapper do this before the body runs.
  return resolveTenant(context, { source: "mcp-auth", key });
}

// ---------------------------------------------------------------------------
// Boot self-test (proof side)

/**
 * The structural slice of @mastra/mcp's MCPServer that assertFailClosed drives.
 * A real MCPServer satisfies it; so does a bare `{ executeTool }` stub, so the
 * self-test is unit-testable without booting a transport. Verified against the
 * installed executeTool signature (see the file header).
 */
export interface McpToolServer {
  executeTool(
    toolId: string,
    args: Record<string, unknown>,
    executionContext?: { requestContext?: unknown; messages?: unknown[]; toolCallId?: string },
  ): Promise<unknown>;
  /**
   * Tool enumeration, present on the installed @mastra/mcp MCPServer
   * (verified: `getToolListInfo()` returns `{ tools: [{ id, ... }] }`).
   * Optional so a bare `{ executeTool }` stub still satisfies the type; the
   * self-test's probe-everything form requires it and says so when absent.
   */
  getToolListInfo?(): { tools: Array<{ id: string }> };
}

export interface AssertFailClosedOptions {
  /** The MCP server whose exposed tools are being wired up (typically the workspace MCPServer). */
  server: McpToolServer;
  /**
   * Probe ONE tool instead of every tool. Prefer omitting this: the
   * single-tool form proved exactly one wire-up, and a sibling tool that
   * skipped the tenant seam sailed through boot while serving every tenant's
   * data to unauthenticated callers.
   */
  probeToolId?: string;
  /**
   * Minimal VALID args for the single-tool form. Defaults to `{}`
   * (correct for read tools whose schema is `z.object({})` or all-optional).
   * Args that fail schema validation would short-circuit before the tenant
   * check runs, so pass real minimal args for probes that require input.
   */
  probeArgs?: Record<string, unknown>;
  /**
   * Per-tool minimal valid args for the probe-everything form, keyed by tool
   * id. Any tool not listed is driven with `{}`.
   */
  argsByTool?: Record<string, Record<string, unknown>>;
  /**
   * Tools that are tenant-free BY DESIGN and therefore expected to succeed
   * without auth. The same contract as `tenant: "none"` on the definition:
   * greppable, deliberate, reviewable. A name listed here that is not on the
   * server fails the self-test — a stale exemption is how the next leak hides.
   */
  exempt?: string[];
  /** The failure code every probed tool must fail closed with. Defaults to NO_TENANT_CONTEXT. */
  expectedErrorCode?: AgentsErrorCode;
}

/** Structural check for the { success:false, error:{ code } } tool-failure envelope. */
function isFailureEnvelope(result: unknown): result is ToolEnvelopeFailure {
  if (typeof result !== "object" || result === null) return false;
  if ((result as { success?: unknown }).success !== false) return false;
  const error = (result as { error?: { code?: unknown } }).error;
  return typeof error?.code === "string";
}

/** A short, log-safe description of an unexpected probe result for the abort message. */
function describeResult(result: unknown): string {
  if (isFailureEnvelope(result)) {
    return `a { success: false } envelope with code "${result.error.code}"`;
  }
  if (typeof result === "object" && result !== null) {
    if ((result as { error?: unknown }).error === true) {
      return "an argument-validation error (the probe never reached the tenant check — pass valid probeArgs)";
    }
    if ((result as { success?: unknown }).success === true) {
      return "a { success: true } result (the probe SUCCEEDED without tenant context — the seam is not wired up)";
    }
  }
  return "a non-envelope result (the probe did not fail closed on tenant context)";
}

/**
 * The boot self-test. Drives EVERY tool on the server WITHOUT any auth info
 * and asserts each fails closed with the tenant error code, reporting every
 * hole at once. THROWS AgentsError("MCP_SELF_TEST_FAILED") loudly for any
 * other outcome — most importantly if a probe SUCCEEDED, which means that tool
 * did not require tenant context and the MCP tenant seam is a fail-open hole.
 * Tenant-free-by-design tools are excused only via the greppable `exempt`
 * list; a single-tool form remains for targeted re-checks.
 *
 * Call this at server startup whenever MCP is enabled, and ABORT startup if it
 * throws: a governed workspace must never accept unauthenticated MCP clients.
 */
export async function assertFailClosed(options: AssertFailClosedOptions): Promise<void> {
  const { server, probeToolId, probeArgs = {}, expectedErrorCode = "NO_TENANT_CONTEXT" } = options;

  // Single-tool form: kept for hosts that need a targeted re-check, but the
  // probe-everything form below is the one to call at boot.
  if (probeToolId !== undefined) {
    await probeOne(server, probeToolId, probeArgs, expectedErrorCode);
    return;
  }

  if (typeof server.getToolListInfo !== "function") {
    throw new AgentsError(
      "MCP_SELF_TEST_FAILED",
      "MCP boot self-test cannot enumerate this server's tools (no getToolListInfo); " +
        "pass probeToolId per tool, or upgrade @mastra/mcp. Refusing to certify a server " +
        "whose tool list cannot be inspected.",
    );
  }

  const toolIds = server.getToolListInfo().tools.map((tool) => tool.id);
  const exempt = new Set(options.exempt ?? []);
  const failures: string[] = [];

  // A stale exemption is a future hole: the tool it excused is gone, and the
  // next tool to take that name inherits a free pass nobody remembers granting.
  for (const name of exempt) {
    if (!toolIds.includes(name)) {
      failures.push(`"${name}" is exempted but not on the server; remove the stale exemption`);
    }
  }

  for (const toolId of toolIds) {
    if (exempt.has(toolId)) continue;
    try {
      await probeOne(server, toolId, options.argsByTool?.[toolId] ?? {}, expectedErrorCode);
    } catch (err) {
      // Collect EVERY hole before reporting: a boot test that stops at the
      // first one hides the second.
      failures.push(err instanceof AgentsError ? err.message : String(err));
    }
  }

  if (failures.length > 0) {
    throw new AgentsError(
      "MCP_SELF_TEST_FAILED",
      `MCP boot self-test failed on ${failures.length} of ${toolIds.length} tool(s):\n` +
        failures.map((message) => `  - ${message}`).join("\n") +
        "\nAbort startup: a governed workspace must never accept unauthenticated MCP clients.",
    );
  }
}

/** Drives one tool with no auth info; it must fail closed with the expected code. */
async function probeOne(
  server: McpToolServer,
  toolId: string,
  args: Record<string, unknown>,
  expectedErrorCode: AgentsErrorCode,
): Promise<void> {
  // No requestContext, no mcp.extra -> the probe sees no auth info at all.
  const result = await server.executeTool(toolId, args, {});

  if (isFailureEnvelope(result) && result.error.code === expectedErrorCode) {
    return;
  }

  throw new AgentsError(
    "MCP_SELF_TEST_FAILED",
    `probe tool "${toolId}" did not fail closed without auth. ` +
      `Expected a { success: false, error.code: "${expectedErrorCode}" } envelope but got ${describeResult(result)}. ` +
      `An MCP-exposed tool must either enforce the tenant seam (tenant: "required", tenantSource: "mcp-auth") ` +
      "or be a declared exemption; this outcome means it is neither.",
  );
}
