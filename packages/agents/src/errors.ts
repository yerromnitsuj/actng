/**
 * Error idiom for the agents package, mirroring core's ReservingError and
 * compliance's ComplianceError: a typed Error subclass carrying a registered
 * machine code. The registry below is the closed contract - add the code here
 * when introducing a new throw.
 *
 * These errors are DEFINITION-TIME and SEAM errors (bad tool schemas, bad
 * gate specs, missing tenant context, undocumented judgment). They are never
 * allowed to reach the model: defineActuarialTool's wrapper converts anything
 * thrown during tool execution into a { success: false, error } envelope.
 */

/** Every machine-readable code an AgentsError can carry. */
export const AGENTS_ERROR_CODES = [
  /** A tool read the request context and found no (or a non-string/empty) tenant id. */
  "NO_TENANT_CONTEXT",
  /** A tool's input schema declares a tenant-id key (projectId/tenantId); tenant ids travel only via RequestContext. */
  "TENANT_IN_SCHEMA",
  "BAD_INPUT_SCHEMA",
  /** A judgment chain was defined with an invalid gate list or gate spec. */
  "BAD_GATE",
  /** A judgment gate was resumed without a non-blank rationale. */
  "MISSING_RATIONALE",
  /** Two tools with the same id were passed to toolRegistry. */
  "DUPLICATE_TOOL_ID",
] as const;

export type AgentsErrorCode = (typeof AGENTS_ERROR_CODES)[number];

/**
 * Thrown for invalid agent-toolkit input: tenant-seam violations, malformed
 * gate specs, undocumented judgment. Carries a registered machine code so
 * envelopes and tests can match on it without parsing messages.
 */
export class AgentsError extends Error {
  readonly code: AgentsErrorCode;
  constructor(code: AgentsErrorCode, message: string) {
    super(message);
    this.name = "AgentsError";
    this.code = code;
  }
}
