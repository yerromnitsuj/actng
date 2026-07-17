import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RequestContext } from "@mastra/core/request-context";
import { AgentsError } from "../src/errors.js";
import {
  defineActuarialTool,
  envelopeFailure,
  tenantOf,
  toolRegistry,
  type ToolEnvelopeFailure,
} from "../src/tools.js";

/** Minimal execution context for direct tool.execute calls (no agent boot). */
function toolContext(requestContext?: { get(key: string): unknown }) {
  return { requestContext } as never;
}

function contextWithTenant(id: string, key = "projectId") {
  const requestContext = new RequestContext();
  requestContext.set(key, id);
  return requestContext;
}

function expectAgentsError(fn: () => unknown, code: string): AgentsError {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(AgentsError);
  const agentsError = thrown as AgentsError;
  expect(agentsError.code).toBe(code);
  return agentsError;
}

describe("envelopeFailure", () => {
  it("keeps a string code from HttpError-like coded errors", () => {
    const err = Object.assign(new Error("triangle not found"), { code: "NOT_FOUND" });
    expect(envelopeFailure(err)).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "triangle not found" },
    });
  });

  it("falls back to TOOL_ERROR for plain errors and honors an explicit fallback", () => {
    expect(envelopeFailure(new Error("boom"))).toEqual({
      success: false,
      error: { code: "TOOL_ERROR", message: "boom" },
    });
    expect(envelopeFailure(new Error("boom"), "IMPORT_FAILED").error.code).toBe("IMPORT_FAILED");
  });

  it("never throws, even for non-Error values", () => {
    expect(envelopeFailure("string throw")).toEqual({
      success: false,
      error: { code: "TOOL_ERROR", message: "string throw" },
    });
    expect(envelopeFailure(undefined)).toEqual({
      success: false,
      error: { code: "TOOL_ERROR", message: "Unknown error" },
    });
    expect(envelopeFailure({ code: "CUSTOM", message: "plain object" })).toEqual({
      success: false,
      error: { code: "CUSTOM", message: "plain object" },
    });
  });
});

describe("tenantOf", () => {
  it("reads the tenant id from the request context (default and custom key)", () => {
    expect(tenantOf({ requestContext: contextWithTenant("p-1") })).toBe("p-1");
    expect(tenantOf({ requestContext: contextWithTenant("acct-9", "accountId") }, "accountId")).toBe(
      "acct-9",
    );
  });

  it("throws NO_TENANT_CONTEXT for missing, non-string, or empty ids", () => {
    expectAgentsError(() => tenantOf(undefined), "NO_TENANT_CONTEXT");
    expectAgentsError(() => tenantOf({}), "NO_TENANT_CONTEXT");
    const numeric = new RequestContext();
    numeric.set("projectId", 42);
    expectAgentsError(() => tenantOf({ requestContext: numeric }), "NO_TENANT_CONTEXT");
    const empty = new RequestContext();
    empty.set("projectId", "");
    expectAgentsError(() => tenantOf({ requestContext: empty }), "NO_TENANT_CONTEXT");
  });
});

describe("defineActuarialTool", () => {
  it("returns the execute result untouched on success", async () => {
    const tool = defineActuarialTool({
      id: "get_thing",
      description: "reads a thing",
      kind: "read",
      inputSchema: z.object({ label: z.string() }),
      execute: async (input, context) => ({
        success: true,
        tenant: tenantOf(context),
        label: input.label,
      }),
    });
    const result = await tool.execute!(
      { label: "hello" },
      toolContext(contextWithTenant("p-7")),
    );
    expect(result).toEqual({ success: true, tenant: "p-7", label: "hello" });
  });

  it("converts a thrown coded error into an envelope with code passthrough", async () => {
    const tool = defineActuarialTool({
      id: "explodes_coded",
      description: "throws an HttpError-like coded error",
      kind: "read",
      inputSchema: z.object({}),
      execute: async () => {
        throw Object.assign(new Error("no analysis yet"), { code: "NOT_FOUND" });
      },
    });
    const result = (await tool.execute!({}, toolContext())) as ToolEnvelopeFailure;
    expect(result).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "no analysis yet" },
    });
  });

  it("converts a plain thrown error into a TOOL_ERROR envelope (never throws into the model)", async () => {
    const tool = defineActuarialTool({
      id: "explodes_plain",
      description: "throws a plain error",
      kind: "action",
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error("service blew up");
      },
    });
    await expect(tool.execute!({}, toolContext())).resolves.toEqual({
      success: false,
      error: { code: "TOOL_ERROR", message: "service blew up" },
    });
  });

  it("turns a missing tenant context into an envelope, not a throw", async () => {
    const tool = defineActuarialTool({
      id: "needs_tenant",
      description: "reads the tenant",
      kind: "read",
      inputSchema: z.object({}),
      execute: async (_input, context) => ({ success: true, tenant: tenantOf(context) }),
    });
    const result = (await tool.execute!({}, toolContext())) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NO_TENANT_CONTEXT");
    expect(result.error.message).toContain("projectId");
  });

  it("rejects tenant-id keys in the input schema at definition time", () => {
    for (const key of ["projectId", "tenantId", "project_id", "tenant_id", "ProjectID"]) {
      const err = expectAgentsError(
        () =>
          defineActuarialTool({
            id: "leaky",
            description: "declares a tenant id",
            kind: "read",
            inputSchema: z.object({ [key]: z.string() }),
            execute: async () => ({ success: true }),
          }),
        "TENANT_IN_SCHEMA",
      );
      expect(err.message).toContain(key);
    }
  });

  it("allows non-tenant keys that merely resemble ids", () => {
    expect(() =>
      defineActuarialTool({
        id: "fine",
        description: "ordinary ids are fine",
        kind: "read",
        inputSchema: z.object({ analysisId: z.string(), projection: z.number() }),
        execute: async () => ({ success: true }),
      }),
    ).not.toThrow();
  });
});

describe("toolRegistry", () => {
  const read = defineActuarialTool({
    id: "get_overview",
    description: "read",
    kind: "read",
    inputSchema: z.object({}),
    execute: async () => ({ success: true }),
  });
  const action = defineActuarialTool({
    id: "apply_selections",
    description: "action",
    kind: "action",
    inputSchema: z.object({}),
    execute: async () => ({ success: true }),
  });

  it("keys tools by id and classifies action tools", () => {
    const registry = toolRegistry([read, action]);
    expect(Object.keys(registry.tools).sort()).toEqual(["apply_selections", "get_overview"]);
    expect(registry.tools["get_overview"]).toBe(read);
    expect(registry.actionToolIds).toEqual(new Set(["apply_selections"]));
  });

  it("rejects duplicate tool ids", () => {
    expectAgentsError(() => toolRegistry([read, read]), "DUPLICATE_TOOL_ID");
  });
});

describe("tenant-key lint: fail-closed and recursive (adversarial-review hardening)", () => {
  const define = (inputSchema: z.ZodObject<z.ZodRawShape>) =>
    defineActuarialTool({
      id: "probe",
      description: "probe",
      kind: "read",
      inputSchema,
      execute: async () => ({ success: true as const }),
    });

  it("rejects a schema whose shape cannot be inspected (fail closed)", () => {
    expect(() =>
      defineActuarialTool({
        id: "probe",
        description: "probe",
        kind: "read",
        // Not an object schema at all; cast past the types like a JS caller could.
        inputSchema: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
        execute: async () => ({ success: true as const }),
      }),
    ).toThrowError(/BAD_INPUT_SCHEMA|shape is unreadable/);
  });

  it("finds tenant keys nested inside objects, arrays, and wrappers", () => {
    expect(() => define(z.object({ filter: z.object({ projectId: z.string() }) }))).toThrowError(
      /filter\.projectId/,
    );
    expect(() =>
      define(z.object({ items: z.array(z.object({ tenant_id: z.string() })) })),
    ).toThrowError(/items\[\]\.tenant_id/);
    expect(() =>
      define(z.object({ maybe: z.object({ TenantId: z.string() }).nullable().optional() })),
    ).toThrowError(/maybe\.TenantId/);
  });

  it("rejects passthrough, catchall, and record escape hatches", () => {
    expect(() => define(z.object({ q: z.string() }).passthrough())).toThrowError(/passthrough/);
    expect(() => define(z.object({ q: z.string() }).catchall(z.string()))).toThrowError(
      /catchall/,
    );
    expect(() => define(z.object({ bag: z.record(z.string()) }))).toThrowError(/arbitrary string keys/);
  });

  it("still accepts the plain schemas real tools use", () => {
    expect(() =>
      define(
        z.object({
          basis: z.enum(["paid", "incurred"]).nullable(),
          selected: z.array(z.number().nullable()),
          label: z.string().optional(),
        }),
      ),
    ).not.toThrow();
  });
});
