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
    // Never leak storage-driver internals (SQLite codes, schema shape) to a
    // tool consumer — that is low-grade information disclosure and an
    // unhelpful surface. Normalize any driver error to a generic envelope.
    if (code.startsWith("SQLITE_")) {
      code = "STORAGE_ERROR";
      message = "a storage operation failed";
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
  return resolveTenant(context, { source: "request-context", key });
}

/** The auth-info bag a bearer-token middleware sets (req.auth in the host). */
export type McpAuthInfoLike = Record<string, unknown>;

/** The MCP slice of a tool context this package reads auth info from. */
export interface McpContextLike {
  requestContext?: { get(key: string): unknown };
  mcp?: { extra?: { authInfo?: McpAuthInfoLike } };
}

/**
 * Resolves the MCP auth-info bag from a tool context, trying every shape the
 * installed and documented transports expose (see mcp.ts's file header for
 * the transport-by-transport story). Returns undefined when no auth info is
 * present — the caller decides that is fatal.
 */
export function resolveMcpAuthInfo(context: McpContextLike | undefined): McpAuthInfoLike | undefined {
  if (!context) return undefined;

  // Primary: the streamable-HTTP call path passes the transport extra at
  // context.mcp.extra (mcpOptions.mcp.extra in @mastra/mcp).
  const directAuthInfo = context.mcp?.extra?.authInfo;
  if (directAuthInfo) return directAuthInfo;

  const requestContext = context.requestContext;
  if (requestContext && typeof requestContext.get === "function") {
    // Documented universal fallback: the whole extra bag under "mcp.extra".
    const proxiedExtra = requestContext.get("mcp.extra") as
      | { authInfo?: McpAuthInfoLike }
      | undefined;
    if (proxiedExtra?.authInfo) return proxiedExtra.authInfo;

    // Installed @mastra/mcp 1.14.0: createProxiedRequestContext copies each
    // extra key onto the RequestContext verbatim, so authInfo is top-level.
    const topLevelAuthInfo = requestContext.get("authInfo") as McpAuthInfoLike | undefined;
    if (topLevelAuthInfo) return topLevelAuthInfo;
  }
  return undefined;
}

/** Where a tool's tenant id is trusted to come from. */
export type TenantSource = "request-context" | "mcp-auth";

export interface ResolveTenantOptions {
  /** The trusted path. Default "request-context" (the host sets it server-side). */
  source?: TenantSource;
  /** The key holding the tenant id. Default "projectId". */
  key?: string;
}

/**
 * THE tenant read. Every path a tenant id may enter this package goes through
 * here — the agent-facing request context and the MCP auth info are the same
 * seam with two transports, and having two independent readers is how they
 * drift (they did: tools.ts read requestContext while mcp.ts read authInfo,
 * with nothing forcing the two to stay in step).
 *
 * Throws AgentsError("NO_TENANT_CONTEXT") when the source has no non-empty
 * string under the key. Inside a defineActuarialTool execute the wrapper
 * converts that throw into a { success: false } envelope, so tools fail
 * CLOSED for any unauthenticated caller.
 */
export function resolveTenant(
  context: TenantToolContext | McpContextLike | undefined,
  options: ResolveTenantOptions = {},
): string {
  const source = options.source ?? "request-context";
  const key = options.key ?? "projectId";
  const value =
    source === "mcp-auth"
      ? resolveMcpAuthInfo(context as McpContextLike | undefined)?.[key]
      : (context as TenantToolContext | undefined)?.requestContext?.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentsError(
      "NO_TENANT_CONTEXT",
      source === "mcp-auth"
        ? `MCP tool invoked without a non-empty "${key}" in the request's authInfo; the host's bearer-token middleware must set req.auth = { ${key} } so it reaches the tool context — the tenant never comes from the model`
        : `Tool invoked without a "${key}" in the request context; the host must set it server-side from the authenticated request, never from the model`,
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
  type?: unknown; // ZodArray, ZodPromise, ZodBranded
  innerType?: unknown; // ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodReadonly
  schema?: unknown; // ZodEffects
  options?: unknown[]; // ZodUnion, ZodDiscriminatedUnion
  items?: unknown[]; // ZodTuple
  rest?: unknown; // ZodTuple
  left?: unknown; // ZodIntersection
  right?: unknown; // ZodIntersection
  getter?: () => unknown; // ZodLazy
  in?: unknown; // ZodPipeline
  out?: unknown; // ZodPipeline
  valueType?: unknown; // ZodSet, ZodMap
};

/** Leaves that end recursion: nothing the model sends through them can carry a key. */
const LEAF_TYPE_NAMES = new Set([
  "ZodString",
  "ZodNumber",
  "ZodBigInt",
  "ZodBoolean",
  "ZodDate",
  "ZodEnum",
  "ZodNativeEnum",
  "ZodLiteral",
  "ZodNull",
  "ZodUndefined",
  "ZodVoid",
  "ZodNever",
  "ZodNaN",
]);

/** Wholly uninspectable values: the lint cannot see into what they admit. */
const OPAQUE_TYPE_NAMES = new Set(["ZodAny", "ZodUnknown", "ZodMap"]);

/**
 * The recursive tenant-key lint behind defineActuarialTool. Walks every
 * container the model could reach — nested objects, arrays, optional /
 * nullable / default / effects wrappers, unions — and rejects:
 * - any object key matching TENANT_KEY_PATTERN at any depth;
 * - .passthrough() objects and non-never .catchall(...) (they let the model
 *   smuggle arbitrary keys past the lint);
 * - z.record(...) (dynamic string keys — same smuggling surface).
 * Leaves (strings, numbers, enums, literals) end recursion. Everything else
 * is decided by an EXPLICIT list: known containers are traversed, known
 * uninspectable shapes (any/unknown/map) are refused, and an unrecognized
 * typeName throws rather than passing. The lint used to silently return for
 * shapes it did not recognize, which made it fail-open: z.tuple, z.lazy,
 * .readonly(), .brand(), z.intersection and five other ordinary containers
 * each smuggled a nested tenant id straight past it. On a security seam,
 * "I don't know what this is" has to mean "refused", not "fine".
 */
/**
 * Frame budget for the tenant lint. Cycles are caught exactly by the on-stack
 * set below; this cap only terminates GENERATIVE schemas (a z.lazy() whose
 * getter builds a fresh node every resolution, so no node ever repeats) and
 * absurd finite nesting. 256 frames is far beyond any real tool input —
 * wrappers (.optional(), .default(), z.lazy resolution) each cost one frame.
 */
const MAX_LINT_FRAMES = 256;

function assertNoTenantKeys(
  schema: unknown,
  toolId: string,
  path: string,
  allowUninspected?: ReadonlySet<string>,
  usedAllowances?: Set<string>,
  stack: Set<unknown> = new Set(),
  depth = 0,
): void {
  // Cycle guard by node identity, NOT by counting dots in `path`: only the
  // object branch appends ".", so a cycle routed purely through lazy/union/
  // array/set/tuple/intersection/pipeline used to recurse with a frozen dot
  // count straight into a RangeError. `stack` holds the nodes on the CURRENT
  // recursion path (added on entry, removed on exit), so meeting one again is
  // a true cycle; shared non-cyclic subschemas are deliberately re-visited so
  // per-path allowUninspected accounting keeps working.
  if (depth > MAX_LINT_FRAMES) {
    throw new AgentsError(
      "BAD_INPUT_SCHEMA",
      `Tool "${toolId}": the input schema nests deeper than the tenant lint's ${MAX_LINT_FRAMES}-frame budget at "${path.slice(0, 120)}..." ` +
        "(likely a z.lazy() that constructs a fresh schema on every resolution); the tenant lint cannot verify unbounded schemas",
    );
  }
  if (typeof schema !== "object" || schema === null) return;
  if (stack.has(schema)) {
    throw new AgentsError(
      "BAD_INPUT_SCHEMA",
      `Tool "${toolId}": the input schema is self-referential at "${path.slice(0, 120)}" ` +
        "(a cyclic z.lazy()); the tenant lint cannot verify unbounded schemas",
    );
  }
  stack.add(schema);
  try {
    lintSchemaNode(schema, toolId, path, allowUninspected, usedAllowances, stack, depth);
  } finally {
    stack.delete(schema);
  }
}

function lintSchemaNode(
  schema: object,
  toolId: string,
  path: string,
  allowUninspected: ReadonlySet<string> | undefined,
  usedAllowances: Set<string> | undefined,
  stack: Set<unknown>,
  depth: number,
): void {
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
      assertNoTenantKeys(value, toolId, `${path}.${key}`, allowUninspected, usedAllowances, stack, depth + 1);
    }
    return;
  }
  if (typeName === "ZodRecord") {
    throw new AgentsError(
      "TENANT_IN_SCHEMA",
      `Tool "${toolId}": the record at "${path}" admits arbitrary string keys (including tenant ids); use an explicit z.object shape`,
    );
  }
  if (typeof typeName === "string" && LEAF_TYPE_NAMES.has(typeName)) {
    return;
  }
  if (typeof typeName === "string" && OPAQUE_TYPE_NAMES.has(typeName)) {
    if (allowUninspected?.has(path)) {
      // A DECLARED opt-out: the tool's definition names this exact path as
      // intentionally opaque because validation happens downstream of zod
      // (e.g. whole interchange documents checked by parseDocument, which
      // carry no tenant identifiers by spec section 12). The declaration is
      // greppable at the definition site; silence is still refused.
      usedAllowances?.add(path);
      return;
    }
    throw new AgentsError(
      "BAD_INPUT_SCHEMA",
      `Tool "${toolId}": the ${typeName} at "${path}" admits values the tenant lint cannot ` +
        'inspect. Either declare the shape with typed keys, or — if this input is validated ' +
        'downstream (parseDocument etc.) — name the exact path in `allowUninspected` so the ' +
        "exception is deliberate and greppable",
    );
  }
  if (typeName === "ZodArray") {
    assertNoTenantKeys(def.type, toolId, `${path}[]`, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (
    typeName === "ZodOptional" ||
    typeName === "ZodNullable" ||
    typeName === "ZodDefault" ||
    typeName === "ZodCatch" ||
    typeName === "ZodReadonly"
  ) {
    assertNoTenantKeys(def.innerType, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodPromise" || typeName === "ZodBranded") {
    assertNoTenantKeys(def.type, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodEffects") {
    assertNoTenantKeys(def.schema, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
    for (const opt of def.options ?? []) assertNoTenantKeys(opt, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodTuple") {
    for (const [index, item] of (def.items ?? []).entries()) {
      assertNoTenantKeys(item, toolId, `${path}[${index}]`, allowUninspected, usedAllowances, stack, depth + 1);
    }
    if (def.rest !== undefined && def.rest !== null) {
      assertNoTenantKeys(def.rest, toolId, `${path}[rest]`, allowUninspected, usedAllowances, stack, depth + 1);
    }
    return;
  }
  if (typeName === "ZodIntersection") {
    assertNoTenantKeys(def.left, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    assertNoTenantKeys(def.right, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodPipeline") {
    assertNoTenantKeys(def.in, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    assertNoTenantKeys(def.out, toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodSet") {
    assertNoTenantKeys(def.valueType, toolId, `${path}[]`, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }
  if (typeName === "ZodLazy") {
    // Resolve once. A self-referential lazy resolves to a node already on the
    // recursion stack and is caught by the cycle guard in assertNoTenantKeys;
    // a generative lazy (fresh node per resolution) hits the frame budget.
    assertNoTenantKeys(def.getter?.(), toolId, path, allowUninspected, usedAllowances, stack, depth + 1);
    return;
  }

  // Fail closed: a typeName this lint has never heard of gets refused, not
  // waved through. New zod container types must be added here DELIBERATELY,
  // with a decision about how the tenant lint traverses them.
  throw new AgentsError(
    "BAD_INPUT_SCHEMA",
    `Tool "${toolId}": the schema at "${path}" has unrecognized type "${String(typeName)}"; ` +
      "the tenant lint refuses shapes it cannot traverse (fail closed)",
  );
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

interface DefineActuarialToolCommon<TShape extends z.ZodRawShape> {
  /**
   * Exact schema paths (the lint's dot notation, rooted at "input") where an
   * uninspectable type — z.unknown(), z.any(), z.map() — is INTENTIONAL
   * because the value is validated downstream of zod. Example:
   * `["input.triangles.primary"]` for a whole interchange document checked by
   * parseDocument at execute time.
   *
   * Every declared path must actually match an opaque node; a leftover
   * declaration is an error, so the list cannot rot as the schema evolves.
   * Undeclared opaque nodes remain refused — this is a per-path opt-out, not
   * a switch.
   */
  allowUninspected?: string[];
  id: string;
  description: string;
  kind: ActuarialToolKind;
  /**
   * The model-facing input schema. MUST NOT contain a tenant-id key
   * (projectId/tenantId in any casing) - defineActuarialTool throws
   * AgentsError("TENANT_IN_SCHEMA") at definition time if it does.
   */
  inputSchema: z.ZodObject<TShape>;
}

/**
 * Every tool STATES its relationship to the tenant seam; there is no default.
 *
 * `tenant: "required"` — the wrapper resolves the tenant from the trusted
 * source BEFORE invoking execute and passes it as the second argument. The
 * body cannot forget the read, because the read is not the body's job any
 * more: an unauthenticated call fails closed with NO_TENANT_CONTEXT and
 * execute never runs.
 *
 * `tenant: "none"` — for the handful of genuinely tenant-free tools (e.g.
 * get_divergence_evidence, which restates evidence already injected by the
 * host). The second argument is null, and the opt-out is greppable: searching
 * `tenant: "none"` lists every tool that skips the seam, with its reason
 * reviewable at the definition site.
 */
export type DefineActuarialToolOptions<TShape extends z.ZodRawShape, TResult> =
  | (DefineActuarialToolCommon<TShape> & {
      tenant: "required";
      /** Trusted source for the tenant id. Default "request-context". */
      tenantSource?: TenantSource;
      /** Key holding the tenant id at the source. Default "projectId". */
      tenantKey?: string;
      /**
       * The tool body. `tenant` is the resolved id — already authenticated,
       * never model-supplied. May throw freely; the wrapper guarantees the
       * model receives either the return value or a { success: false, error }
       * envelope, never an exception.
       */
      execute: (
        input: z.infer<z.ZodObject<TShape>>,
        tenant: string,
        context: ActuarialToolContext,
      ) => Promise<TResult>;
    })
  | (DefineActuarialToolCommon<TShape> & {
      tenant: "none";
      execute: (
        input: z.infer<z.ZodObject<TShape>>,
        tenant: null,
        context: ActuarialToolContext,
      ) => Promise<TResult>;
    });

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
  const allowUninspected = new Set(options.allowUninspected ?? []);
  const usedAllowances = new Set<string>();
  assertNoTenantKeys(options.inputSchema, options.id, "input", allowUninspected, usedAllowances);
  for (const declared of allowUninspected) {
    if (!usedAllowances.has(declared)) {
      throw new AgentsError(
        "BAD_INPUT_SCHEMA",
        `Tool "${options.id}": allowUninspected names "${declared}", but no uninspectable ` +
          "schema node exists at that path; remove the stale declaration",
      );
    }
  }
  if (options.tenant !== "required" && options.tenant !== "none") {
    // Runtime backstop for JS callers the union type cannot reach: the seam
    // relationship is stated, never assumed.
    throw new AgentsError(
      "BAD_INPUT_SCHEMA",
      `Tool "${(options as { id: string }).id}": \`tenant\` must be "required" or "none" — every tool states its ` +
        "relationship to the tenant seam explicitly",
    );
  }
  const tool = createTool({
    id: options.id,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: async (input: z.infer<z.ZodObject<TShape>>, context: unknown) => {
      try {
        if (options.tenant === "required") {
          // Resolve BEFORE the body runs: an unauthenticated call fails closed
          // here, and execute never sees it.
          const tenant = resolveTenant(context as ActuarialToolContext, {
            source: options.tenantSource,
            key: options.tenantKey,
          });
          return await options.execute(input, tenant, context as ActuarialToolContext);
        }
        return await options.execute(input, null, context as ActuarialToolContext);
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
