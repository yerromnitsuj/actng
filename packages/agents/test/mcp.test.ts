import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPServer } from "@mastra/mcp";
import { RequestContext } from "@mastra/core/request-context";
import { AgentsError } from "../src/errors.js";
import { defineActuarialTool } from "../src/tools.js";
import {
  assertFailClosed,
  requireMcpTenant,
  type McpToolContext,
  type McpToolServer,
} from "../src/mcp.js";

/** A RequestContext seeded with the given key/value pairs (structural { get }). */
function requestContext(entries: Record<string, unknown>): { get(key: string): unknown } {
  const rc = new RequestContext();
  for (const [key, value] of Object.entries(entries)) rc.set(key, value);
  return rc;
}

async function expectAgentsErrorAsync(
  promise: Promise<unknown>,
  code: string,
): Promise<AgentsError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(AgentsError);
  expect((thrown as AgentsError).code).toBe(code);
  return thrown as AgentsError;
}

describe("requireMcpTenant", () => {
  it("reads the tenant from context.mcp.extra.authInfo (primary path, default + custom key)", () => {
    const context: McpToolContext = { mcp: { extra: { authInfo: { projectId: "p-1" } } } };
    expect(requireMcpTenant(context)).toBe("p-1");

    const custom: McpToolContext = { mcp: { extra: { authInfo: { accountId: "acct-9" } } } };
    expect(requireMcpTenant(custom, "accountId")).toBe("acct-9");
  });

  it("reads the tenant via the documented requestContext 'mcp.extra' fallback", () => {
    const context: McpToolContext = {
      requestContext: requestContext({ "mcp.extra": { authInfo: { projectId: "p-2" } } }),
    };
    expect(requireMcpTenant(context)).toBe("p-2");
  });

  it("reads the tenant via the installed-1.14.0 requestContext top-level 'authInfo' fallback", () => {
    const context: McpToolContext = {
      requestContext: requestContext({ authInfo: { projectId: "p-3" } }),
    };
    expect(requireMcpTenant(context)).toBe("p-3");
  });

  it("throws NO_TENANT_CONTEXT when auth info or the key is absent", () => {
    const cases: (McpToolContext | undefined)[] = [
      undefined,
      {},
      { mcp: {} },
      { mcp: { extra: {} } },
      { mcp: { extra: { authInfo: {} } } },
      { requestContext: requestContext({}) },
      { requestContext: requestContext({ authInfo: { otherKey: "x" } }) },
    ];
    for (const context of cases) {
      let thrown: unknown;
      try {
        requireMcpTenant(context);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AgentsError);
      expect((thrown as AgentsError).code).toBe("NO_TENANT_CONTEXT");
    }
  });

  it("throws NO_TENANT_CONTEXT for an empty-string or non-string tenant", () => {
    const empty: McpToolContext = { mcp: { extra: { authInfo: { projectId: "" } } } };
    expect(() => requireMcpTenant(empty)).toThrow(AgentsError);
    let thrown: unknown;
    try {
      requireMcpTenant(empty);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as AgentsError).code).toBe("NO_TENANT_CONTEXT");

    const numeric: McpToolContext = { mcp: { extra: { authInfo: { projectId: 42 } } } };
    expect(() => requireMcpTenant(numeric)).toThrow(AgentsError);
  });
});

// A read tool that correctly resolves its tenant from the MCP auth info: with
// no auth it must fail closed (the wrapper envelopes the NO_TENANT_CONTEXT throw).
const guardedProbe = defineActuarialTool({
  id: "get_overview",
  description: "reads the workspace overview; tenant enforced by the seam",
  kind: "read",
  inputSchema: z.object({}),
  tenant: "required",
  tenantSource: "mcp-auth",
  execute: async (_input, tenant) => ({
    success: true as const,
    tenant,
  }),
});

// The fail-open regression the boot self-test must catch. Since the factory
// now enforces the read for tenant:"required" tools, the way this mistake is
// made TODAY is declaring tenant:"none" on a tool that actually serves
// tenant-scoped data — the opt-out is greppable, but a wrong declaration
// still needs a runtime backstop, which is what assertFailClosed provides.
const unguardedProbe = defineActuarialTool({
  id: "leaky_overview",
  description: "reads the workspace overview WITHOUT a tenant check (wire-up regression)",
  kind: "read",
  inputSchema: z.object({}),
  tenant: "none",
  execute: async () => ({ success: true as const, data: "leaked" }),
});

describe("assertFailClosed (real in-memory MCPServer)", () => {
  it("PASSES: a guarded probe fails closed without auth", async () => {
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { get_overview: guardedProbe },
    });
    await expect(
      assertFailClosed({ server, probeToolId: "get_overview" }),
    ).resolves.toBeUndefined();
  });

  it("THROWS MCP_SELF_TEST_FAILED: an unguarded probe succeeds without auth", async () => {
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { leaky_overview: unguardedProbe },
    });
    await expectAgentsErrorAsync(
      assertFailClosed({ server, probeToolId: "leaky_overview" }),
      "MCP_SELF_TEST_FAILED",
    );
  });

  it("probes EVERY tool when no probeToolId is given, catching the leaky sibling", async () => {
    // The single-probe form proved exactly one tool. A sibling that serves
    // tenant-scoped data with tenant:"none" declared passed boot while
    // answering unauthenticated callers. Enumerating the server closes that.
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { get_overview: guardedProbe, leaky_overview: unguardedProbe },
    });
    const err = await expectAgentsErrorAsync(
      assertFailClosed({ server }),
      "MCP_SELF_TEST_FAILED",
    );
    expect(err.message).toContain("leaky_overview");
    // The report names every hole, not just the first.
    expect(err.message).not.toContain("get_overview: ");
  });

  it("passes a fully guarded multi-tool server", async () => {
    const secondGuarded = defineActuarialTool({
      id: "get_detail",
      description: "second guarded read",
      kind: "read",
      inputSchema: z.object({}),
      tenant: "required",
      tenantSource: "mcp-auth",
      execute: async (_input, tenant) => ({ success: true as const, tenant }),
    });
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { get_overview: guardedProbe, get_detail: secondGuarded },
    });
    await expect(assertFailClosed({ server })).resolves.toBeUndefined();
  });

  it("honours a declared exemption but refuses a stale one", async () => {
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { get_overview: guardedProbe, leaky_overview: unguardedProbe },
    });
    // Declared exemption: boot passes, and the exemption is greppable.
    await expect(
      assertFailClosed({ server, exempt: ["leaky_overview"] }),
    ).resolves.toBeUndefined();
    // A stale exemption (tool no longer exists) is itself a failure.
    const err = await expectAgentsErrorAsync(
      assertFailClosed({ server, exempt: ["leaky_overview", "gone_tool"] }),
      "MCP_SELF_TEST_FAILED",
    );
    expect(err.message).toContain("gone_tool");
  });

  it("the guarded probe returns the tenant when the MCP server DOES supply authInfo", async () => {
    const server = new MCPServer({
      name: "test-workspace",
      version: "0.0.0",
      tools: { get_overview: guardedProbe },
    });
    const result = await server.executeTool(
      "get_overview",
      {},
      { requestContext: requestContext({ authInfo: { projectId: "p-live" } }) as RequestContext },
    );
    expect(result).toEqual({ success: true, tenant: "p-live" });
  });
});

describe("assertFailClosed (structural stub — no live server needed)", () => {
  it("PASSES when the stub returns the expected tenant-failure envelope", async () => {
    const server: McpToolServer = {
      executeTool: async () => ({
        success: false,
        error: { code: "NO_TENANT_CONTEXT", message: "no tenant" },
      }),
    };
    await expect(assertFailClosed({ server, probeToolId: "probe" })).resolves.toBeUndefined();
  });

  it("THROWS when the stub reports success (fail-open)", async () => {
    const server: McpToolServer = { executeTool: async () => ({ success: true, data: {} }) };
    await expectAgentsErrorAsync(
      assertFailClosed({ server, probeToolId: "probe" }),
      "MCP_SELF_TEST_FAILED",
    );
  });

  it("THROWS when the probe fails with a DIFFERENT code than expected", async () => {
    const server: McpToolServer = {
      executeTool: async () => ({ success: false, error: { code: "TOOL_ERROR", message: "boom" } }),
    };
    await expectAgentsErrorAsync(
      assertFailClosed({ server, probeToolId: "probe" }),
      "MCP_SELF_TEST_FAILED",
    );
  });

  it("THROWS on an argument-validation error (probe never reached the tenant check)", async () => {
    const server: McpToolServer = {
      executeTool: async () => ({ error: true, message: "Tool validation failed" }),
    };
    await expectAgentsErrorAsync(
      assertFailClosed({ server, probeToolId: "probe" }),
      "MCP_SELF_TEST_FAILED",
    );
  });

  it("forwards probeArgs and honors a custom expectedErrorCode", async () => {
    const seen: { toolId?: string; args?: unknown } = {};
    const server: McpToolServer = {
      executeTool: async (toolId, args) => {
        seen.toolId = toolId;
        seen.args = args;
        return { success: false, error: { code: "REMOTE_RESULT_INVALID", message: "x" } };
      },
    };
    await expect(
      assertFailClosed({
        server,
        probeToolId: "probe",
        probeArgs: { asOf: "2026-01-01" },
        expectedErrorCode: "REMOTE_RESULT_INVALID",
      }),
    ).resolves.toBeUndefined();
    expect(seen.toolId).toBe("probe");
    expect(seen.args).toEqual({ asOf: "2026-01-01" });
  });
});
