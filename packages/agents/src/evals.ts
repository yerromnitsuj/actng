/**
 * Golden-prompt tool-selection eval harness: does a realistic instruction
 * make the agent call the right tool(s)? Generalizes the ActNG server's
 * eval-advisor script.
 *
 * Asserts tool SELECTION, not prose: each case lists tools that must appear
 * among the turn's calls. Running against a real agent costs live API tokens
 * and is opt-in by design - the harness itself is pure bookkeeping, which is
 * why package tests exercise it with a stubbed agent and canned streams.
 *
 * Chunk shapes (verified against @mastra/core 1.49 fullStream): tool calls
 * arrive as { type: "tool-call", payload: { toolName } }, with a legacy
 * { type: "tool-call", toolName } fallback.
 */

// ---------------------------------------------------------------------------
// Types

export interface ToolSelectionEvalCase {
  id: string;
  prompt: string;
  /** Tool names that must ALL appear among the turn's calls. */
  expectTools: readonly string[];
}

export interface ToolSelectionCaseResult {
  id: string;
  pass: boolean;
  /** Tool names actually called, in first-call order. */
  called: string[];
  /** Expected tools that never got called. */
  missing: string[];
  /** Stream error or timeout, when the case failed exceptionally. */
  error?: string;
}

export interface ToolSelectionEvalReport {
  results: ToolSelectionCaseResult[];
  summary: { total: number; passed: number; failed: number };
}

/**
 * The structural slice of an agent the harness needs: stream(messages,
 * options) resolving to something with an async-iterable fullStream.
 *
 * WHY structural instead of the concrete @mastra/core Agent class: the Agent
 * type carries heavy generics and live-model plumbing the harness never
 * touches; it only consumes the fullStream chunk feed. Typing the seam
 * structurally lets package tests substitute a canned-stream stub (no LLM, no
 * network) and lets hosts pass any Agent from any compatible Mastra patch
 * level without generic gymnastics.
 */
export interface ToolStreamingAgent {
  stream(
    messages: Array<{ role: "user"; content: string }>,
    options?: Record<string, unknown>,
  ): Promise<{ fullStream: AsyncIterable<unknown> }>;
}

export interface RunToolSelectionEvalsOptions {
  agent: ToolStreamingAgent;
  cases: readonly ToolSelectionEvalCase[];
  /** Forwarded verbatim to agent.stream options (the tenant seam for tools). */
  requestContext?: unknown;
  /** Max agent steps per case. Default 8. */
  maxSteps?: number;
  /** Per-case wall clock: a stalled stream fails the case, not the suite. Default 180000. */
  timeoutMs?: number;
  /**
   * Optional per-case memory option factory (thread/resource), for agents
   * whose Memory configuration requires one on every stream call.
   */
  memoryFor?: (evalCase: ToolSelectionEvalCase) => { thread: string; resource: string };
}

// ---------------------------------------------------------------------------
// Harness

/** Extracts the tool name from a fullStream chunk, or null for non-tool-call chunks. */
function toolCallName(chunk: unknown): string | null {
  const c = chunk as {
    type?: unknown;
    toolName?: unknown;
    payload?: { toolName?: unknown };
  };
  if (c?.type !== "tool-call") return null;
  const name = c.payload?.toolName ?? c.toolName;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/**
 * Runs every case sequentially against the agent, collecting the tool calls
 * from the fullStream and asserting each case's expectTools is a subset of
 * the tools actually called. A per-case Promise.race timeout keeps one
 * stalled stream from hanging the whole suite.
 */
export async function runToolSelectionEvals(
  options: RunToolSelectionEvalsOptions,
): Promise<ToolSelectionEvalReport> {
  const { agent, cases, requestContext } = options;
  const maxSteps = options.maxSteps ?? 8;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const results: ToolSelectionCaseResult[] = [];
  for (const evalCase of cases) {
    const called = new Set<string>();
    let error: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const stream = await agent.stream([{ role: "user", content: evalCase.prompt }], {
            ...(requestContext !== undefined ? { requestContext } : {}),
            maxSteps,
            ...(options.memoryFor ? { memory: options.memoryFor(evalCase) } : {}),
          });
          for await (const chunk of stream.fullStream) {
            const name = toolCallName(chunk);
            if (name) called.add(name);
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`case timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const missing = evalCase.expectTools.filter((tool) => !called.has(tool));
    const result: ToolSelectionCaseResult = {
      id: evalCase.id,
      pass: error === undefined && missing.length === 0,
      called: [...called],
      missing,
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    results,
    summary: { total: results.length, passed, failed: results.length - passed },
  };
}
