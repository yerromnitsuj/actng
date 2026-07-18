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
 * Resolves the MCP auth-info bag from a tool context, trying every shape the
 * installed and documented transports expose (see the file header). Returns
 * undefined when no auth info is present — the caller decides that is fatal.
 */
function resolveMcpAuthInfo(context: McpToolContext | undefined): McpAuthInfo | undefined {
  if (!context) return undefined;

  // Primary: the streamable-HTTP call path passes the transport extra at
  // context.mcp.extra (mcpOptions.mcp.extra in @mastra/mcp).
  const directAuthInfo = context.mcp?.extra?.authInfo;
  if (directAuthInfo) return directAuthInfo;

  const requestContext = context.requestContext;
  if (requestContext && typeof requestContext.get === "function") {
    // Documented universal fallback: the whole extra bag under "mcp.extra".
    const proxiedExtra = requestContext.get("mcp.extra") as McpRequestExtra | undefined;
    if (proxiedExtra?.authInfo) return proxiedExtra.authInfo;

    // Installed @mastra/mcp 1.14.0: createProxiedRequestContext copies each
    // extra key onto the RequestContext verbatim, so authInfo is top-level.
    const topLevelAuthInfo = requestContext.get("authInfo") as McpAuthInfo | undefined;
    if (topLevelAuthInfo) return topLevelAuthInfo;
  }

  return undefined;
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
  const authInfo = resolveMcpAuthInfo(context);
  const value = authInfo?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentsError(
      "NO_TENANT_CONTEXT",
      `MCP tool invoked without a non-empty "${key}" in the request's authInfo; the host's bearer-token middleware must set req.auth = { ${key} } so it reaches context.mcp.extra.authInfo — the tenant never comes from the model`,
    );
  }
  return value;
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
}

export interface AssertFailClosedOptions {
  /** The MCP server whose exposed tools are being wired up (typically the workspace MCPServer). */
  server: McpToolServer;
  /**
   * A READ tool that resolves its tenant via requireMcpTenant. Driven with no
   * auth info, it must fail closed with the tenant error code.
   */
  probeToolId: string;
  /**
   * Minimal VALID args for the probe tool's input schema. Defaults to `{}`
   * (correct for read tools whose schema is `z.object({})` or all-optional).
   * Args that fail schema validation would short-circuit before the tenant
   * check runs, so pass real minimal args for probes that require input.
   */
  probeArgs?: Record<string, unknown>;
  /** The failure code the probe must fail closed with. Defaults to NO_TENANT_CONTEXT. */
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
 * The boot self-test. Drives {@link AssertFailClosedOptions.probeToolId}
 * through the server WITHOUT any auth info and asserts it fails closed with the
 * tenant error code. THROWS AgentsError("MCP_SELF_TEST_FAILED") loudly for any
 * other outcome — most importantly if the probe SUCCEEDED, which means the tool
 * did not require tenant context and the MCP tenant seam is a fail-open hole.
 *
 * Call this at server startup whenever MCP is enabled, and ABORT startup if it
 * throws: a governed workspace must never accept unauthenticated MCP clients.
 */
export async function assertFailClosed(options: AssertFailClosedOptions): Promise<void> {
  const { server, probeToolId, probeArgs = {}, expectedErrorCode = "NO_TENANT_CONTEXT" } = options;

  // No requestContext, no mcp.extra -> the probe sees no auth info at all.
  const result = await server.executeTool(probeToolId, probeArgs, {});

  if (isFailureEnvelope(result) && result.error.code === expectedErrorCode) {
    return;
  }

  throw new AgentsError(
    "MCP_SELF_TEST_FAILED",
    `MCP boot self-test failed: probe tool "${probeToolId}" did not fail closed without auth. ` +
      `Expected a { success: false, error.code: "${expectedErrorCode}" } envelope but got ${describeResult(result)}. ` +
      `An MCP-exposed read tool must resolve its tenant with requireMcpTenant so an unauthenticated call is rejected; this outcome means the tenant seam is not wired up. Abort startup.`,
  );
}
