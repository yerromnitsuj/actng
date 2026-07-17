/**
 * Actuarial tool factory: Mastra createTool with the two hard guarantees the
 * ActNG server proved in production, generalized for any host.
 *
 * 1. SECURITY SEAM. The tenant id (project id) ALWAYS comes from the
 *    server-side request context, never from the model. tenantOf reads it;
 *    defineActuarialTool REJECTS, at definition time, any input schema that
 *    declares a tenant-id key - the model must not even be able to express
 *    one. (Verified against @mastra/core 1.49: tools execute as
 *    (inputData, context) with context.requestContext.get(key).)
 *
 * 2. ERROR CONTRACT. Tools never throw into the model. Anything the host's
 *    execute throws is converted to { success: false, error: { code, message } }
 *    so the agent can recover: retry with adjusted parameters, suggest an
 *    alternative, or ask. Errors carrying a string code (the server's
 *    HttpError, this package's AgentsError, compliance's ComplianceError)
 *    keep their code; everything else gets the fallback.
 */

import { createTool } from "@mastra/core/tools";
import type { z } from "zod";
import { AgentsError } from "./errors.js";

// ---------------------------------------------------------------------------
// Failure envelope

/** The uniform tool-failure shape: agents branch on success, hosts log code. */
export type ToolEnvelopeFailure = {
  success: false;
  error: { code: string; message: string };
};

/**
 * Converts anything thrown by a tool into the failure envelope. Never throws.
 * Error-like values with a non-empty string "code" property (HttpError,
 * AgentsError, ComplianceError) keep their code; everything else gets
 * fallbackCode.
 */
export function envelopeFailure(err: unknown, fallbackCode = "TOOL_ERROR"): ToolEnvelopeFailure {
  let code = fallbackCode;
  let message = "Unknown error";
  try {
    const candidate = (err as { code?: unknown } | null | undefined)?.code;
    if (typeof candidate === "string" && candidate.length > 0) code = candidate;
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "string" && err.length > 0) {
      message = err;
    } else {
      const msg = (err as { message?: unknown } | null | undefined)?.message;
      if (typeof msg === "string" && msg.length > 0) message = msg;
    }
  } catch {
    // A hostile getter must not break the envelope; keep the fallbacks.
  }
  return { success: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Tenant seam

/**
 * The structural slice of Mastra's ToolExecutionContext that the tenant seam
 * needs. Typed structurally (not as the concrete Mastra type) so tests can
 * pass a minimal object and hosts on any 1.49+ patch level are assignable.
 */
export interface TenantToolContext {
  requestContext?: { get(key: string): unknown };
}

/**
 * Reads the tenant id from the server-set request context. Throws a typed
 * AgentsError("NO_TENANT_CONTEXT") when absent, non-string, or empty; inside
 * a defineActuarialTool execute the wrapper converts that throw into the
 * failure envelope, so the model sees a recoverable error, never a crash.
 */
export function tenantOf(context: TenantToolContext | undefined, key = "projectId"): string {
  const value = context?.requestContext?.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentsError(
      "NO_TENANT_CONTEXT",
      `Tool invoked without a "${key}" in the request context; the host must set it server-side from the authenticated request, never from the model`,
    );
  }
  return value;
}

/**
 * Tenant-id keys a tool input schema may never declare. Case-insensitive and
 * separator-tolerant (projectId, project_id, tenantId, TenantID, ...): the
 * lint exists to make the security seam unexpressable, so it errs wide.
 */
const TENANT_KEY_PATTERN = /^(project|tenant)[_-]?id$/i;

/** Top-level shape keys of a zod object schema, or null when not an object schema. */
export function zodObjectShape(schema: unknown): Record<string, unknown> | null {
  if (typeof schema !== "object" || schema === null) return null;
  const def = (schema as { _def?: { typeName?: unknown } })._def;
  if (def?.typeName !== "ZodObject") return null;
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return null;
  return shape as Record<string, unknown>;
}

type ZodDefLike = {
  typeName?: unknown;
  unknownKeys?: unknown;
  catchall?: { _def?: { typeName?: unknown } };
  type?: unknown;
  innerType?: unknown;
  schema?: unknown;
  options?: unknown[];
};

/**
 * The recursive tenant-key lint behind defineActuarialTool. Walks every
 * container the model could reach — nested objects, arrays, optional /
 * nullable / default / effects wrappers, unions — and rejects:
 * - any object key matching TENANT_KEY_PATTERN at any depth;
 * - .passthrough() objects and non-never .catchall(...) (they let the model
 *   smuggle arbitrary keys past the lint);
 * - z.record(...) (dynamic string keys — same smuggling surface).
 * Leaves (strings, numbers, enums, literals) end recursion. Anything with
 * an unrecognized CONTAINER shape simply is not traversed further; the
 * fail-closed top-level check in defineActuarialTool guarantees the root is
 * an inspectable plain object.
 */
function assertNoTenantKeys(schema: unknown, toolId: string, path: string): void {
  if (typeof schema !== "object" || schema === null) return;
  const def = (schema as { _def?: ZodDefLike })._def;
  if (!def) return;
  const typeName = def.typeName;

  if (typeName === "ZodObject") {
    if (def.unknownKeys === "passthrough") {
      throw new AgentsError(
        "TENANT_IN_SCHEMA",
        `Tool "${toolId}": the object at "${path}" uses .passthrough(), which lets the model smuggle arbitrary keys (including tenant ids) past the seam; declare every key explicitly`,
      );
    }
    const catchallType = def.catchall?._def?.typeName;
    if (catchallType !== undefined && catchallType !== "ZodNever") {
      throw new AgentsError(
        "TENANT_IN_SCHEMA",
        `Tool "${toolId}": the object at "${path}" uses .catchall(...), which admits undeclared keys; declare every key explicitly`,
      );
    }
    const shape = zodObjectShape(schema) ?? {};
    for (const [key, value] of Object.entries(shape)) {
      if (TENANT_KEY_PATTERN.test(key)) {
        throw new AgentsError(
          "TENANT_IN_SCHEMA",
          `Tool "${toolId}" declares input key "${path}.${key}": tenant ids travel only via the server-set RequestContext (read them with tenantOf), never through the model-facing input schema`,
        );
      }
      assertNoTenantKeys(value, toolId, `${path}.${key}`);
    }
    return;
  }
  if (typeName === "ZodRecord") {
    throw new AgentsError(
      "TENANT_IN_SCHEMA",
      `Tool "${toolId}": the record at "${path}" admits arbitrary string keys (including tenant ids); use an explicit z.object shape`,
    );
  }
  if (typeName === "ZodArray") {
    assertNoTenantKeys(def.type, toolId, `${path}[]`);
    return;
  }
  if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
    assertNoTenantKeys(def.innerType, toolId, path);
    return;
  }
  if (typeName === "ZodEffects") {
    assertNoTenantKeys(def.schema, toolId, path);
    return;
  }
  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
    for (const opt of def.options ?? []) assertNoTenantKeys(opt, toolId, path);
    return;
  }
}

// ---------------------------------------------------------------------------
// Tool factory

/** read = inspect/analyze only; action = mutates host state (drives client refresh). */
export type ActuarialToolKind = "read" | "action";

/**
 * The execution context handed to an actuarial tool's execute. Structural on
 * purpose: it is the slice of Mastra's ToolExecutionContext this package
 * relies on, and tests exercise tools without booting an agent.
 */
export type ActuarialToolContext = TenantToolContext;

export interface DefineActuarialToolOptions<TShape extends z.ZodRawShape, TResult> {
  id: string;
  description: string;
  kind: ActuarialToolKind;
  /**
   * The model-facing input schema. MUST NOT contain a tenant-id key
   * (projectId/tenantId in any casing) - defineActuarialTool throws
   * AgentsError("TENANT_IN_SCHEMA") at definition time if it does.
   */
  inputSchema: z.ZodObject<TShape>;
  /**
   * The tool body. May throw freely (HttpError-style coded errors keep their
   * code); the wrapper guarantees the model receives either the return value
   * or a { success: false, error } envelope, never an exception.
   */
  execute: (
    input: z.infer<z.ZodObject<TShape>>,
    context: ActuarialToolContext,
  ) => Promise<TResult>;
}

/**
 * Wraps Mastra's createTool with the envelope + tenant-seam guarantees and
 * tags the result with its kind for toolRegistry classification.
 */
export function defineActuarialTool<TShape extends z.ZodRawShape, TResult>(
  options: DefineActuarialToolOptions<TShape, TResult>,
) {
  // FAIL CLOSED: a schema the seam cannot inspect is not definable, and the
  // tenant-key lint recurses through every container the model could reach.
  const shape = zodObjectShape(options.inputSchema);
  if (!shape) {
    throw new AgentsError(
      "BAD_INPUT_SCHEMA",
      `Tool "${options.id}": inputSchema must be a plain z.object(...) the tenant seam can inspect; got a schema whose shape is unreadable`,
    );
  }
  assertNoTenantKeys(options.inputSchema, options.id, "input");
  const tool = createTool({
    id: options.id,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: async (input: z.infer<z.ZodObject<TShape>>, context: unknown) => {
      try {
        return await options.execute(input, context as ActuarialToolContext);
      } catch (err) {
        return envelopeFailure(err);
      }
    },
  });
  return Object.assign(tool, { kind: options.kind });
}

// ---------------------------------------------------------------------------
// Registry

/** The minimal slice toolRegistry needs; every defineActuarialTool result satisfies it. */
export interface RegistrableActuarialTool {
  id: string;
  kind: ActuarialToolKind;
}

export interface ActuarialToolRegistry<T extends RegistrableActuarialTool> {
  /** Tools keyed by id, ready for new Agent({ tools }). */
  tools: Record<string, T>;
  /** Ids of state-mutating tools (the host client refreshes after these). */
  actionToolIds: Set<string>;
}

/**
 * Classifies a tool list into the shape hosts wire into their agent: a
 * tools record keyed by id plus the action-tool id set that drives client
 * refresh semantics (the generalization of the server's ACTION_TOOL_IDS).
 */
export function toolRegistry<T extends RegistrableActuarialTool>(
  tools: readonly T[],
): ActuarialToolRegistry<T> {
  const record: Record<string, T> = {};
  const actionToolIds = new Set<string>();
  for (const tool of tools) {
    if (record[tool.id]) {
      throw new AgentsError(
        "DUPLICATE_TOOL_ID",
        `Two tools share the id "${tool.id}"; tool ids must be unique within a registry`,
      );
    }
    record[tool.id] = tool;
    if (tool.kind === "action") actionToolIds.add(tool.id);
  }
  return { tools: record, actionToolIds };
}
