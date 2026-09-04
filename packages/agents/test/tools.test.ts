import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RequestContext } from "@mastra/core/request-context";
import {
  standardSchemaToJSONSchema,
  toStandardSchema,
  type StandardSchemaWithJSON,
} from "@mastra/core/schema";
import { makeCoreTool } from "@mastra/core/utils";
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
    const err = Object.assign(new Error("triangle not found"), {
      code: "NOT_FOUND",
    });
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
    expect(envelopeFailure(new Error("boom"), "IMPORT_FAILED").error.code).toBe(
      "IMPORT_FAILED",
    );
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
    expect(
      envelopeFailure({ code: "CUSTOM", message: "plain object" }),
    ).toEqual({
      success: false,
      error: { code: "CUSTOM", message: "plain object" },
    });
  });
});

describe("tenantOf", () => {
  it("reads the tenant id from the request context (default and custom key)", () => {
    expect(tenantOf({ requestContext: contextWithTenant("p-1") })).toBe("p-1");
    expect(
      tenantOf(
        { requestContext: contextWithTenant("acct-9", "accountId") },
        "accountId",
      ),
    ).toBe("acct-9");
  });

  it("throws NO_TENANT_CONTEXT for missing, non-string, or empty ids", () => {
    expectAgentsError(() => tenantOf(undefined), "NO_TENANT_CONTEXT");
    expectAgentsError(() => tenantOf({}), "NO_TENANT_CONTEXT");
    const numeric = new RequestContext();
    numeric.set("projectId", 42);
    expectAgentsError(
      () => tenantOf({ requestContext: numeric }),
      "NO_TENANT_CONTEXT",
    );
    const empty = new RequestContext();
    empty.set("projectId", "");
    expectAgentsError(
      () => tenantOf({ requestContext: empty }),
      "NO_TENANT_CONTEXT",
    );
  });
});

describe("defineActuarialTool", () => {
  it("parses type-changing input exactly once and exposes identity-validation metadata", async () => {
    let transforms = 0;
    const inputSchema = z.object({
      nested: z.object({
        value: z.string().transform((value) => {
          transforms += 1;
          return Number(value);
        }),
      }),
    });
    const tool = defineActuarialTool({
      id: "transformed-input",
      tenant: "none",
      description: "checks once-only parsing",
      kind: "read",
      inputSchema,
      execute: async (input) => ({
        success: true as const,
        doubled: input.nested.value * 2,
      }),
    });
    await expect(
      tool.execute({ nested: { value: "3" } }, toolContext()),
    ).resolves.toEqual({ success: true, doubled: 6 });
    expect(transforms).toBe(1);

    const bridge = tool.inputSchema as StandardSchemaWithJSON<unknown, unknown>;
    expect(
      await bridge["~standard"].validate({ nested: { value: "not parsed" } }),
    ).toEqual({ value: { nested: { value: "not parsed" } } });
    expect(standardSchemaToJSONSchema(bridge, { io: "input" })).toEqual(
      standardSchemaToJSONSchema(toStandardSchema(inputSchema), {
        io: "input",
      }),
    );
  });

  it("normalizes bad input through both direct execute and public makeCoreTool", async () => {
    let calls = 0;
    const tool = defineActuarialTool({
      id: "core-path",
      tenant: "none",
      description: "core conversion",
      kind: "read",
      inputSchema: z.object({ n: z.number() }),
      execute: async () => {
        calls += 1;
        return { success: true as const };
      },
    });
    await expect(
      tool.execute({ n: "bad" } as never, toolContext()),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_INPUT_INVALID",
        message: "Tool input failed schema validation",
      },
    });
    const requestContext = new RequestContext();
    const core = makeCoreTool(tool, { name: tool.id, requestContext });
    await expect(
      core.execute!({ n: "bad" }, { requestContext } as never),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_INPUT_INVALID",
        message: "Tool input failed schema validation",
      },
    });
    expect(calls).toBe(0);
  });

  it("validates observable output exactly once and rejects success-only schemas", async () => {
    const failure = z
      .object({
        success: z.literal(false),
        error: z.object({ code: z.string(), message: z.string() }).strict(),
      })
      .strict();
    const success = z
      .object({ success: z.literal(true), value: z.number() })
      .strict();
    let transforms = 0;
    const output = z.union([success, failure]).transform((value) => {
      transforms += 1;
      return value;
    });
    const tool = defineActuarialTool({
      id: "validated-output",
      tenant: "none",
      description: "validates output",
      kind: "read",
      inputSchema: z.object({}),
      outputSchema: output,
      execute: async () => ({ success: true as const, value: 4 }),
    });
    expect(transforms).toBe(1); // the documented construction probe
    await expect(tool.execute({}, toolContext())).resolves.toEqual({
      success: true,
      value: 4,
    });
    expect(transforms).toBe(2);
    expect(() =>
      defineActuarialTool({
        id: "bad-output",
        tenant: "none",
        description: "omits failure",
        kind: "read",
        inputSchema: z.object({}),
        outputSchema: success,
        execute: async () => ({ success: true as const, value: 1 }),
      }),
    ).toThrowError(AgentsError);
  });

  it("normalizes malformed, undefined, throwing, and rewritten outputs", async () => {
    const failure = z
      .object({
        success: z.literal(false),
        error: z.object({ code: z.string(), message: z.string() }).strict(),
      })
      .strict();
    const success = z
      .object({ success: z.literal(true), value: z.number() })
      .strict();
    const output = z.union([success, failure]);
    const malformed = defineActuarialTool({
      id: "malformed-output",
      tenant: "none",
      description: "bad body",
      kind: "read",
      inputSchema: z.object({}),
      outputSchema: output,
      execute: async () => ({ success: true as const, value: "bad" }) as never,
    });
    await expect(malformed.execute({}, toolContext())).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_OUTPUT_INVALID",
        message: "Tool output failed schema validation",
      },
    });

    const missing = defineActuarialTool({
      id: "missing-output",
      tenant: "none",
      description: "undefined body",
      kind: "read",
      inputSchema: z.object({}),
      execute: async () => undefined,
    });
    await expect(missing.execute({}, toolContext())).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_OUTPUT_INVALID",
        message: "Tool output failed schema validation",
      },
    });

    const throwingInput = defineActuarialTool({
      id: "throwing-input",
      tenant: "none",
      description: "throwing transform",
      kind: "read",
      inputSchema: z.object({
        value: z.string().transform(() => {
          throw new Error("bad transform");
        }),
      }),
      execute: async () => ({ success: true as const }),
    });
    await expect(
      throwingInput.execute({ value: "x" }, toolContext()),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "TOOL_INPUT_INVALID" },
    });

    const conditional = z
      .union([success, failure])
      .transform((value) =>
        value.success === false && value.error.code !== "TOOL_OUTPUT_INVALID"
          ? { ...value, error: { ...value.error, message: "rewritten" } }
          : value,
      );
    const protectedFailure = defineActuarialTool({
      id: "protected-failure",
      tenant: "none",
      description: "protects envelopes",
      kind: "read",
      inputSchema: z.object({}),
      outputSchema: conditional,
      execute: async () => {
        throw new Error("body failed");
      },
    });
    await expect(protectedFailure.execute({}, toolContext())).resolves.toEqual({
      success: false,
      error: {
        code: "TOOL_OUTPUT_INVALID",
        message: "Tool output failed schema validation",
      },
    });

    expect(() =>
      defineActuarialTool({
        id: "throwing-probe",
        tenant: "none",
        description: "throws in output probe",
        kind: "read",
        inputSchema: z.object({}),
        outputSchema: z.any().transform(() => {
          throw new Error("probe");
        }),
        execute: async () => ({ success: true as const }),
      }),
    ).toThrowError(AgentsError);
  });

  it("returns the execute result untouched on success", async () => {
    const tool = defineActuarialTool({
      id: "get_thing",
      tenant: "required",
      description: "reads a thing",
      kind: "read",
      inputSchema: z.object({ label: z.string() }),
      execute: async (input, tenant, _context) => ({
        success: true,
        tenant,
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
      tenant: "none",
      description: "throws an HttpError-like coded error",
      kind: "read",
      inputSchema: z.object({}),
      execute: async (_input, _tenant) => {
        throw Object.assign(new Error("no analysis yet"), {
          code: "NOT_FOUND",
        });
      },
    });
    const result = (await tool.execute!(
      {},
      toolContext(),
    )) as ToolEnvelopeFailure;
    expect(result).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "no analysis yet" },
    });
  });

  it("converts a plain thrown error into a TOOL_ERROR envelope (never throws into the model)", async () => {
    const tool = defineActuarialTool({
      id: "explodes_plain",
      tenant: "none",
      description: "throws a plain error",
      kind: "action",
      inputSchema: z.object({}),
      execute: async (_input, _tenant) => {
        throw new Error("service blew up");
      },
    });
    await expect(tool.execute!({}, toolContext())).resolves.toEqual({
      success: false,
      error: { code: "TOOL_ERROR", message: "service blew up" },
    });
  });

  it("fails closed on a missing tenant WITHOUT ever invoking the body", async () => {
    // The seam is enforced by construction now: the wrapper resolves the
    // tenant before execute, so the body cannot forget the check — it never
    // runs. The flag is the proof.
    let executeRan = false;
    const tool = defineActuarialTool({
      id: "needs_tenant",
      description: "reads the tenant",
      kind: "read",
      inputSchema: z.object({}),
      tenant: "required",
      execute: async (_input, tenant, _context) => {
        executeRan = true;
        return { success: true, tenant };
      },
    });

    const result = (await tool.execute!(
      {},
      toolContext(),
    )) as ToolEnvelopeFailure;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NO_TENANT_CONTEXT");
    expect(result.error.message).toContain("projectId");
    expect(executeRan).toBe(false);

    // And with a tenant present, the body receives it as an argument.
    const ok = (await tool.execute!(
      {},
      toolContext(contextWithTenant("p-42")),
    )) as { success: true; tenant: string };
    expect(ok.success).toBe(true);
    expect(ok.tenant).toBe("p-42");
    expect(executeRan).toBe(true);
  });

  it("rejects tenant-id keys in the input schema at definition time", () => {
    for (const key of [
      "projectId",
      "tenantId",
      "project_id",
      "tenant_id",
      "ProjectID",
    ]) {
      const err = expectAgentsError(
        () =>
          defineActuarialTool({
            id: "leaky",
            tenant: "none",
            description: "declares a tenant id",
            kind: "read",
            inputSchema: z.object({ [key]: z.string() }),
            execute: async (_input, _tenant) => ({ success: true }),
          }),
        "TENANT_IN_SCHEMA",
      );
      expect(err.message).toContain(key);
    }
  });

  it("catches a tenant id nested inside EVERY zod container, not just the common ones", () => {
    // Each of these smuggled z.object({ projectId }) past the old lint, which
    // recursed into known wrappers and silently returned for everything else.
    // .readonly(), .brand() and z.tuple() are things people write without
    // thinking; a fail-open lint on a security seam is a hole, not a gap.
    const leaky = z.object({ projectId: z.string() });
    const containers: Record<string, z.ZodTypeAny> = {
      tuple: z.tuple([leaky]),
      intersection: z.intersection(leaky, z.object({ other: z.string() })),
      lazy: z.lazy(() => leaky),
      pipeline: z.string().pipe(leaky as never),
      set: z.set(leaky),
      promise: z.promise(leaky),
      catch: leaky.catch({ projectId: "x" }),
      readonly: leaky.readonly(),
      branded: leaky.brand("Branded"),
    };
    for (const [name, schema] of Object.entries(containers)) {
      expectAgentsError(
        () =>
          defineActuarialTool({
            id: `leaky-${name}`,
            tenant: "none",
            description: `tenant id inside ${name}`,
            kind: "read",
            inputSchema: z.object({ payload: schema }),
            execute: async (_input, _tenant) => ({ success: true }),
          }),
        "TENANT_IN_SCHEMA",
      );
    }
  });

  it("refuses containers that admit arbitrary keys or arbitrary values outright", () => {
    // A map keyed by strings is a record by another name; any/unknown admit
    // whole objects the lint cannot see into. On a security seam, "cannot
    // inspect" must mean "refused", not "waved through".
    const cases: Record<string, z.ZodTypeAny> = {
      map: z.map(z.string(), z.number()),
      any: z.any(),
      unknown: z.unknown(),
    };
    for (const [name, schema] of Object.entries(cases)) {
      expectAgentsError(
        () =>
          defineActuarialTool({
            id: `opaque-${name}`,
            tenant: "none",
            description: `uninspectable ${name}`,
            kind: "read",
            inputSchema: z.object({ payload: schema }),
            execute: async (_input, _tenant) => ({ success: true }),
          }),
        "BAD_INPUT_SCHEMA",
      );
    }
  });

  it("still accepts the ordinary leaves and containers a real tool uses", () => {
    expect(() =>
      defineActuarialTool({
        id: "kitchen-sink",
        tenant: "none",
        description: "every legitimate shape at once",
        kind: "read",
        inputSchema: z.object({
          name: z.string(),
          count: z.number().int().optional(),
          flag: z.boolean().default(false),
          mode: z.enum(["a", "b"]),
          when: z.literal("now").nullable(),
          pair: z.tuple([z.string(), z.number()]),
          tags: z.array(z.string()),
          nested: z.object({ analysisId: z.string() }).readonly(),
          either: z.union([z.string(), z.number()]),
        }),
        execute: async (_input, _tenant) => ({ success: true }),
      }),
    ).not.toThrow();
  });

  it("permits a DECLARED opaque path and refuses the undeclared one beside it", () => {
    // The opt-out is per-path: naming one slot must not loosen its siblings.
    expect(() =>
      defineActuarialTool({
        id: "declared-slot",
        tenant: "none",
        description: "one declared document slot",
        kind: "read",
        inputSchema: z.object({ doc: z.unknown(), other: z.string() }),
        allowUninspected: ["input.doc"],
        execute: async (_input, _tenant) => ({ success: true }),
      }),
    ).not.toThrow();

    expectAgentsError(
      () =>
        defineActuarialTool({
          id: "undeclared-sibling",
          tenant: "none",
          description: "second opaque slot not declared",
          kind: "read",
          inputSchema: z.object({ doc: z.unknown(), also: z.unknown() }),
          allowUninspected: ["input.doc"],
          execute: async (_input, _tenant) => ({ success: true }),
        }),
      "BAD_INPUT_SCHEMA",
    );
  });

  it("refuses a stale allowUninspected declaration, so the list cannot rot", () => {
    const err = expectAgentsError(
      () =>
        defineActuarialTool({
          id: "stale-allowance",
          tenant: "none",
          description: "declares a path that is not opaque",
          kind: "read",
          inputSchema: z.object({ name: z.string() }),
          allowUninspected: ["input.name"],
          execute: async (_input, _tenant) => ({ success: true }),
        }),
      "BAD_INPUT_SCHEMA",
    );
    expect(err.message).toContain("stale");
  });

  it("allows non-tenant keys that merely resemble ids", () => {
    expect(() =>
      defineActuarialTool({
        id: "fine",
        tenant: "none",
        description: "ordinary ids are fine",
        kind: "read",
        inputSchema: z.object({
          analysisId: z.string(),
          projection: z.number(),
        }),
        execute: async (_input, _tenant) => ({ success: true }),
      }),
    ).not.toThrow();
  });
});

describe("toolRegistry", () => {
  const read = defineActuarialTool({
    id: "get_overview",
    tenant: "none",
    description: "read",
    kind: "read",
    inputSchema: z.object({}),
    execute: async (_input, _tenant) => ({ success: true }),
  });
  const action = defineActuarialTool({
    id: "apply_selections",
    tenant: "none",
    description: "action",
    kind: "action",
    inputSchema: z.object({}),
    execute: async (_input, _tenant) => ({ success: true }),
  });

  it("keys tools by id and classifies action tools", () => {
    const registry = toolRegistry([read, action]);
    expect(Object.keys(registry.tools).sort()).toEqual([
      "apply_selections",
      "get_overview",
    ]);
    expect(registry.tools["get_overview"]).toBe(read);
    expect(registry.actionToolIds).toEqual(new Set(["apply_selections"]));
  });

  it("rejects duplicate tool ids", () => {
    expectAgentsError(() => toolRegistry([read, read]), "DUPLICATE_TOOL_ID");
  });

  it("treats prototype-named tool ids as ordinary registry entries", () => {
    const prototypeTool = { ...read, id: "__proto__" };
    const registry = toolRegistry([prototypeTool]);
    expect(Object.keys(registry.tools)).toEqual(["__proto__"]);
    expect(registry.tools.__proto__).toBe(prototypeTool);
    expectAgentsError(
      () => toolRegistry([prototypeTool, prototypeTool]),
      "DUPLICATE_TOOL_ID",
    );
  });
});

describe("tenant-key lint: fail-closed and recursive (adversarial-review hardening)", () => {
  const define = (inputSchema: z.ZodObject<z.ZodRawShape>) =>
    defineActuarialTool({
      id: "probe",
      tenant: "none",
      description: "probe",
      kind: "read",
      inputSchema,
      execute: async () => ({ success: true as const }),
    });

  it("rejects a schema whose shape cannot be inspected (fail closed)", () => {
    expect(() =>
      defineActuarialTool({
        id: "probe",
        tenant: "none",
        description: "probe",
        kind: "read",
        // Not an object schema at all; cast past the types like a JS caller could.
        inputSchema: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
        execute: async () => ({ success: true as const }),
      }),
    ).toThrowError(/BAD_INPUT_SCHEMA|shape is unreadable/);
  });

  it("finds tenant keys nested inside objects, arrays, and wrappers", () => {
    expect(() =>
      define(z.object({ filter: z.object({ projectId: z.string() }) })),
    ).toThrowError(/filter\.projectId/);
    expect(() =>
      define(z.object({ items: z.array(z.object({ tenant_id: z.string() })) })),
    ).toThrowError(/items\[\]\.tenant_id/);
    expect(() =>
      define(
        z.object({
          maybe: z.object({ TenantId: z.string() }).nullable().optional(),
        }),
      ),
    ).toThrowError(/maybe\.TenantId/);
  });

  it("rejects passthrough, catchall, and record escape hatches", () => {
    expect(() =>
      define(z.object({ q: z.string() }).passthrough()),
    ).toThrowError(/passthrough/);
    expect(() =>
      define(z.object({ q: z.string() }).catchall(z.string())),
    ).toThrowError(/catchall/);
    expect(() => define(z.object({ bag: z.record(z.string()) }))).toThrowError(
      /arbitrary string keys/,
    );
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

  it("reports a schema cycle that never passes through an object key as a typed error, not a RangeError", () => {
    // Each cycle is routed purely through dotless containers; the old guard
    // counted dots and blew the call stack at definition time.
    const viaArray: z.ZodTypeAny = z.lazy(() =>
      z.union([z.string(), z.array(viaArray)]),
    );
    const viaSet: z.ZodTypeAny = z.lazy(() =>
      z.union([z.string(), z.set(viaSet)]),
    );
    const viaTuple: z.ZodTypeAny = z.lazy(() =>
      z.union([z.string(), z.tuple([viaTuple])]),
    );
    const direct: z.ZodTypeAny = z.lazy(() => direct); // the case the code comment promises to catch
    for (const schema of [viaArray, viaSet, viaTuple, direct]) {
      const err = expectAgentsError(
        () => define(z.object({ tree: schema })),
        "BAD_INPUT_SCHEMA",
      );
      expect(err.message).toMatch(/self-referential/);
    }
  });

  it("still reports an object-keyed cycle as BAD_INPUT_SCHEMA (regression pin)", () => {
    const node: z.ZodTypeAny = z.lazy(() =>
      z.object({ children: z.array(node) }),
    );
    expectAgentsError(
      () => define(z.object({ tree: node })),
      "BAD_INPUT_SCHEMA",
    );
  });

  it("terminates a generative lazy (fresh node every resolution) with the frame budget", () => {
    const make = (): z.ZodTypeAny => z.lazy(make);
    const err = expectAgentsError(
      () => define(z.object({ deep: make() })),
      "BAD_INPUT_SCHEMA",
    );
    expect(err.message).toMatch(/frame budget|nests deeper/);
  });

  it("re-visits a shared non-cyclic subschema per path, so allowUninspected stays per-path", () => {
    // Guards against a global visited-set implementation: the same node under
    // two keys must be linted (and allowance-marked) at BOTH paths.
    const doc = z.unknown();
    expect(() =>
      defineActuarialTool({
        id: "shared-doc",
        tenant: "none",
        description: "same opaque node under two declared paths",
        kind: "read",
        inputSchema: z.object({ a: doc, b: doc }),
        allowUninspected: ["input.a", "input.b"],
        execute: async () => ({ success: true as const }),
      }),
    ).not.toThrow();
  });
});
