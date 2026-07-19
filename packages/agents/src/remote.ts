/**
 * Remote-method tools (interchange spec rev 2.1, section 7 client side):
 * defineRemoteMethod wraps one sidecar method (POST /v1/run/{method}) in
 * defineActuarialTool, so a chainladder-python run becomes ordinary advisor
 * evidence — enveloped, tenant-sealed, abortable.
 *
 * Contract decisions (each is load-bearing):
 *
 * - THE WIRE IS THE INTERCHANGE SPEC. The model-facing input schema is the
 *   sidecar request body MINUS engagementRef and minus any tenant field:
 *   { triangles: { primary, secondary? }, selection?, exposure?,
 *   parameters?, seed? }. Embedded documents are validated CLIENT-side via
 *   interchange parseDocument (integrity verified) before anything leaves
 *   the process, and the response document is parsed the same way — a 2xx
 *   body that fails parseDocument is refused with
 *   AgentsError("REMOTE_RESULT_INVALID"), never handed to the model.
 *
 * - THE TENANT SEAM IS UNTOUCHED. The input schema declares no tenant key
 *   (defineActuarialTool lints it at definition time), the wire body is
 *   built ONLY from the declared slots, and no engagementRef surface exists
 *   on the tool at all — the remote call carries zero correlation identity.
 *   The sidecar's own data-level lint (TENANT_KEY_REJECTED) backstops any
 *   tenant key hiding inside a supplied document's extensions.
 *
 * - PARAMETERS ARE AN EXPLICIT VOCABULARY, NOT A RECORD. The tenant lint
 *   rejects z.record / .passthrough (arbitrary-key smuggling surfaces), so
 *   the schema declares the sidecar's documented knobs explicitly; the
 *   sidecar 422s anything a given method does not accept, which keeps the
 *   two vocabularies honest against each other.
 *
 * - ERRORS MAP TO ENVELOPES WITH THE SIDECAR'S OWN CODES. A non-2xx with a
 *   schema'd { error: { code, message } } body keeps that code verbatim
 *   (UNAUTHORIZED, MISSING_SEED, REPLAY_REFUSED, ...); transport failures
 *   get SIDECAR_UNREACHABLE, the client-side deadline SIDECAR_TIMEOUT, and
 *   a caller abort ABORTED. The model always receives an envelope it can
 *   recover from, never a thrown exception.
 */

import { z } from "zod";
import {
  parseDocument,
  type MethodResultDoc,
  type StochasticResultDoc,
} from "@actuarial-ts/interchange";
import { AgentsError } from "./errors.js";
import {
  defineActuarialTool,
  envelopeFailure,
  type ActuarialToolContext,
  type ToolEnvelopeFailure,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Wire schema (model-facing): the spec-7 request body minus engagementRef
// and minus any tenant surface.

/** BF/Benktander/CapeCod apriori base: one value per origin label. */
const exposureSchema = z.object({
  origins: z.array(z.string().min(1)).min(1).describe("Origin labels, matching the primary triangle's origins exactly"),
  values: z.array(z.number().finite()).min(1).describe("One exposure value per origin, same order as origins"),
  kind: z.string().min(1).describe('Exposure kind, e.g. "earnedPremium"'),
});

/**
 * The sidecar's documented parameter vocabulary, declared explicitly (the
 * tenant lint forbids open-key records by design). Every key is nullable:
 * null means "not sent", and each METHOD accepts only its own subset — the
 * sidecar refuses unknown keys per method with a 422 the envelope relays.
 */
const parametersSchema = z.object({
  average: z
    .enum(["volume", "simple", "regression"])
    .nullable()
    .describe("Development average when NO selection document is supplied (conflicts with selection)"),
  n_periods: z
    .number()
    .int()
    .nullable()
    .describe("Development periods when NO selection is supplied: -1 = all periods (conflicts with selection)"),
  strictness: z
    .enum(["warn", "strict"])
    .nullable()
    .describe("Selection-replay strictness: warn (default) runs compromises with warnings; strict refuses them with 422"),
  sigma_interpolation: z
    .enum(["log-linear", "mack"])
    .nullable()
    .describe('MackChainladder sigma extrapolation; the mack1993-vw profile requires "mack" (engine default is log-linear)'),
  apriori: z.number().nullable().describe("BornhuetterFerguson/Benktander a-priori multiplier on the exposure base"),
  n_iters: z.number().int().nullable().describe("Benktander iterations (1 = BF)"),
  trend: z.number().nullable().describe("CapeCod trend rate"),
  decay: z.number().nullable().describe("CapeCod decay factor"),
  growth: z
    .enum(["loglogistic", "weibull"])
    .nullable()
    .describe("ClarkLDF growth curve family"),
  n_sims: z.number().int().nullable().describe("BootstrapODPSample simulation count (default 1000, max 100000)"),
});

const remoteRunInputSchema = z.object({
  triangles: z.object({
    primary: z
      .unknown()
      .describe("The primary TriangleDoc: a full actuarial-interchange triangle document, integrity tag intact"),
    secondary: z
      .unknown()
      .nullable()
      .describe("Second TriangleDoc (MunichAdjustment's incurred slot; primary = paid). Null for every other method"),
  }),
  selection: z
    .unknown()
    .nullable()
    .describe(
      "SelectionDoc replayed as the development intent (spec 3.2). Null = engine-native factors from parameters. Supplying BOTH a selection and average/n_periods parameters is refused",
    ),
  exposure: exposureSchema
    .nullable()
    .describe("Apriori exposure base — required by BornhuetterFerguson, Benktander, and CapeCod; null otherwise"),
  parameters: parametersSchema.nullable().describe("Method-specific knobs; null sends none"),
  seed: z
    .number()
    .int()
    .nullable()
    .describe("BootstrapODPSample only (REQUIRED there); deterministic methods refuse a supplied seed"),
});

export type RemoteRunInput = z.infer<typeof remoteRunInputSchema>;

// ---------------------------------------------------------------------------
// The HTTP call (shared by defineRemoteMethod and host-authored tools)

/** Result-document kinds a sidecar run may return. */
const RESULT_KINDS = new Set(["method-result", "stochastic-result"]);

export interface RemoteMethodCallOptions {
  /** Sidecar base URL, e.g. http://127.0.0.1:8091 (no trailing /v1). */
  sidecarUrl: string;
  /** The spec-7 method name, e.g. "Chainladder" or "MackChainladder". */
  method: string;
  /** Client-side deadline for one run. Default 60000 ms. */
  timeoutMs?: number;
  /** Extra request headers — the bearer token travels here, e.g.
   * { authorization: "Bearer <SIDECAR_TOKEN>" }. */
  headers?: Record<string, string>;
}

export interface RemoteMethodSuccess {
  success: true;
  /** "method-result" | "stochastic-result" (what the run returned). */
  kind: "method-result" | "stochastic-result";
  /** The parsed, integrity-verified result document. */
  doc: MethodResultDoc | StochasticResultDoc;
  /** Reader-side warnings from parseDocument (normally empty). */
  parseWarnings: string[];
}

export type RemoteMethodResult = RemoteMethodSuccess | ToolEnvelopeFailure;

function isAbortLike(err: unknown, name: string): boolean {
  return (err as { name?: unknown } | null)?.name === name;
}

/**
 * POSTs one spec-7 wire body to the sidecar and parses the response through
 * interchange parseDocument. Never throws for transport/protocol failures —
 * it returns the failure envelope directly, carrying the sidecar's own error
 * code when the response body is schema'd. The ONE registered throw-shaped
 * failure, REMOTE_RESULT_INVALID (a 2xx body that is not a verifiable
 * result document), is also returned enveloped.
 */
export async function callRemoteMethod(
  options: RemoteMethodCallOptions,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<RemoteMethodResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const url = `${options.sidecarUrl.replace(/\/+$/, "")}/v1/run/${encodeURIComponent(options.method)}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    // fetch rejects with the abort REASON: AbortSignal.timeout's reason is a
    // TimeoutError, a caller abort is an AbortError; anything else is the
    // transport itself failing. Node may also wrap the reason in a TypeError
    // whose cause carries the story — the signal states disambiguate.
    if (signal?.aborted === true && !timeout.aborted) {
      return { success: false, error: { code: "ABORTED", message: "the caller aborted the sidecar call" } };
    }
    if (timeout.aborted || isAbortLike(err, "TimeoutError")) {
      return {
        success: false,
        error: {
          code: "SIDECAR_TIMEOUT",
          message: `the sidecar did not answer ${options.method} within ${timeoutMs} ms`,
        },
      };
    }
    if (isAbortLike(err, "AbortError")) {
      return { success: false, error: { code: "ABORTED", message: "the caller aborted the sidecar call" } };
    }
    const detail = err instanceof Error ? err.message : String(err);
    const cause = (err as { cause?: { message?: unknown } } | null)?.cause?.message;
    return {
      success: false,
      error: {
        code: "SIDECAR_UNREACHABLE",
        message: `could not reach the sidecar at ${url}: ${typeof cause === "string" ? cause : detail}`,
      },
    };
  }

  let payload: unknown;
  let bodyText = "";
  try {
    bodyText = await response.text();
    payload = JSON.parse(bodyText);
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const schemad = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    const code = typeof schemad?.code === "string" && schemad.code.length > 0
      ? schemad.code
      : `SIDECAR_HTTP_${response.status}`;
    const message = typeof schemad?.message === "string" && schemad.message.length > 0
      ? schemad.message
      : `sidecar answered HTTP ${response.status} for ${options.method}`;
    return { success: false, error: { code, message } };
  }

  try {
    if (payload === undefined) {
      throw new Error(`response body is not JSON: ${bodyText.slice(0, 200)}`);
    }
    const { doc, warnings } = parseDocument(payload); // strictness "refuse": a broken tag throws
    if (!RESULT_KINDS.has(doc.kind)) {
      throw new Error(`expected a method-result or stochastic-result document, got kind "${doc.kind}"`);
    }
    return {
      success: true,
      kind: doc.kind as "method-result" | "stochastic-result",
      doc: doc as MethodResultDoc | StochasticResultDoc,
      parseWarnings: warnings,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return envelopeFailure(
      new AgentsError(
        "REMOTE_RESULT_INVALID",
        `the sidecar's 2xx response for ${options.method} is not a verifiable interchange result document: ${detail}`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The tool factory

export interface DefineRemoteMethodOptions extends RemoteMethodCallOptions {
  id: string;
  description: string;
}

/** The context slice the remote tool consumes beyond the tenant seam:
 * Mastra's per-call abort signal (verified against @mastra/core 1.49's
 * ToolExecutionContext), forwarded into fetch so a cancelled agent run
 * cancels the sidecar call. */
interface AbortableToolContext extends ActuarialToolContext {
  abortSignal?: AbortSignal;
}

/** Client-side guard: an embedded document slot must parse (integrity
 * verified) AND be of the expected kind before it goes on the wire. Returns
 * the failure envelope for a wrong kind (mirroring the sidecar's own
 * WRONG_DOCUMENT_KIND vocabulary); parse failures throw ReservingError
 * BAD_INTERCHANGE, which the tool wrapper envelopes with that code. */
function checkDocumentSlot(
  raw: unknown,
  slot: string,
  expectedKind: string,
): ToolEnvelopeFailure | null {
  const { doc } = parseDocument(raw);
  if (doc.kind !== expectedKind) {
    return {
      success: false,
      error: {
        code: "WRONG_DOCUMENT_KIND",
        message: `'${slot}' must be a ${expectedKind} document, got kind "${doc.kind}"`,
      },
    };
  }
  return null;
}

function compactParameters(
  parameters: z.infer<typeof parametersSchema> | null | undefined,
): Record<string, unknown> | null {
  if (parameters === null || parameters === undefined) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Defines a read-kind actuarial tool that runs ONE sidecar method. The
 * input schema is the spec-7 wire shape (minus engagementRef/tenant
 * anything); execute validates the embedded documents, POSTs the wire body,
 * forwards the Mastra abort signal, and returns either the parsed
 * integrity-verified result document or a failure envelope carrying the
 * sidecar's own error code.
 */
export function defineRemoteMethod(options: DefineRemoteMethodOptions) {
  const { id, description, ...call } = options;
  return defineActuarialTool({
    id,
    description,
    kind: "read",
    inputSchema: remoteRunInputSchema,
    // The document slots are z.unknown() ON PURPOSE: each is a whole
    // interchange document, validated at execute time by checkDocumentSlot ->
    // parseDocument (schema + integrity tag), and interchange documents carry
    // no tenant identifiers by spec section 12. Declaring the paths here keeps
    // the tenant lint fail-closed for everything else.
    allowUninspected: ["input.triangles.primary", "input.triangles.secondary", "input.selection"],
    // Tenant-free BY DESIGN: the sidecar is stateless and the wire body is
    // spec-7 minus engagementRef minus any tenant surface (see the file
    // header). There is no tenant-scoped read or write on this path.
    tenant: "none",
    execute: async (input, _tenant, context): Promise<RemoteMethodResult> => {
      const badPrimary = checkDocumentSlot(input.triangles.primary, "triangles.primary", "triangle");
      if (badPrimary !== null) return badPrimary;
      if (input.triangles.secondary !== null && input.triangles.secondary !== undefined) {
        const badSecondary = checkDocumentSlot(input.triangles.secondary, "triangles.secondary", "triangle");
        if (badSecondary !== null) return badSecondary;
      }
      if (input.selection !== null && input.selection !== undefined) {
        const badSelection = checkDocumentSlot(input.selection, "selection", "selection");
        if (badSelection !== null) return badSelection;
      }

      const parameters = compactParameters(input.parameters);
      const body: Record<string, unknown> = {
        triangles: {
          primary: input.triangles.primary,
          ...(input.triangles.secondary !== null && input.triangles.secondary !== undefined
            ? { secondary: input.triangles.secondary }
            : {}),
        },
        ...(input.selection !== null && input.selection !== undefined
          ? { selection: input.selection }
          : {}),
        ...(input.exposure !== null && input.exposure !== undefined
          ? { exposure: input.exposure }
          : {}),
        ...(parameters !== null ? { parameters } : {}),
        ...(input.seed !== null && input.seed !== undefined ? { seed: input.seed } : {}),
      };
      return callRemoteMethod(call, body, (context as AbortableToolContext).abortSignal);
    },
  });
}
