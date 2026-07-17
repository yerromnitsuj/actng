import { describe, expect, it } from "vitest";
import {
  runToolSelectionEvals,
  type ToolSelectionEvalCase,
  type ToolStreamingAgent,
} from "../src/evals.js";

/**
 * The harness types its agent structurally (only .stream matters), so a stub
 * with canned fullStream chunks exercises the full bookkeeping with no LLM
 * and no network.
 */

type Chunk = Record<string, unknown>;

function cannedStream(chunks: Chunk[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function stubAgent(
  streamsByPrompt: Record<string, Chunk[]>,
  captured?: Array<{ messages: unknown; options: unknown }>,
): ToolStreamingAgent {
  return {
    async stream(messages, options) {
      captured?.push({ messages, options });
      const prompt = messages[0]!.content;
      const chunks = streamsByPrompt[prompt];
      if (!chunks) throw new Error(`no canned stream for prompt: ${prompt}`);
      return { fullStream: cannedStream(chunks) };
    },
  };
}

const CASES: ToolSelectionEvalCase[] = [
  { id: "trend-analyze", prompt: "check the trends", expectTools: ["analyze_trends"] },
  { id: "elr-select", prompt: "select the ELR", expectTools: ["analyze_elr", "set_elr"] },
];

describe("runToolSelectionEvals", () => {
  it("passes when every expected tool appears, reading both payload and legacy chunk shapes", async () => {
    const agent = stubAgent({
      "check the trends": [
        { type: "text-delta", delta: "Looking..." },
        { type: "tool-call", payload: { toolName: "analyze_trends" } }, // 1.49 shape
        { type: "tool-result", payload: { toolName: "analyze_trends" } },
      ],
      "select the ELR": [
        { type: "tool-call", toolName: "analyze_elr" }, // legacy shape
        { type: "tool-call", payload: { toolName: "set_elr" } },
      ],
    });
    const report = await runToolSelectionEvals({ agent, cases: CASES });
    expect(report.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(report.results[0]).toEqual({
      id: "trend-analyze",
      pass: true,
      called: ["analyze_trends"],
      missing: [],
    });
    expect(report.results[1]!.called).toEqual(["analyze_elr", "set_elr"]);
  });

  it("fails a case listing the missing tools when the agent picked the wrong one", async () => {
    const agent = stubAgent({
      "check the trends": [{ type: "tool-call", payload: { toolName: "set_trend_selections" } }],
    });
    const report = await runToolSelectionEvals({ agent, cases: [CASES[0]!] });
    expect(report.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]).toEqual({
      id: "trend-analyze",
      pass: false,
      called: ["set_trend_selections"],
      missing: ["analyze_trends"],
    });
  });

  it("records a stream error on the case and keeps running the rest", async () => {
    const agent: ToolStreamingAgent = {
      async stream(messages) {
        if (messages[0]!.content === "check the trends") throw new Error("model unavailable");
        return {
          fullStream: cannedStream([
            { type: "tool-call", payload: { toolName: "analyze_elr" } },
            { type: "tool-call", payload: { toolName: "set_elr" } },
          ]),
        };
      },
    };
    const report = await runToolSelectionEvals({ agent, cases: CASES });
    expect(report.results[0]!.pass).toBe(false);
    expect(report.results[0]!.error).toBe("model unavailable");
    expect(report.results[1]!.pass).toBe(true);
    expect(report.summary).toEqual({ total: 2, passed: 1, failed: 1 });
  });

  it("times out a stalled stream instead of hanging the suite", async () => {
    const agent: ToolStreamingAgent = {
      async stream() {
        return {
          fullStream: (async function* () {
            await new Promise(() => {}); // never settles, holds no handle
            yield { type: "tool-call", payload: { toolName: "never" } };
          })(),
        };
      },
    };
    const report = await runToolSelectionEvals({
      agent,
      cases: [CASES[0]!],
      timeoutMs: 50,
    });
    expect(report.results[0]!.pass).toBe(false);
    expect(report.results[0]!.error).toContain("timed out after 50ms");
    expect(report.results[0]!.missing).toEqual(["analyze_trends"]);
  });

  it("forwards requestContext, defaulted maxSteps, and per-case memory to agent.stream", async () => {
    const captured: Array<{ messages: unknown; options: unknown }> = [];
    const requestContext = { get: () => "p-1" };
    const agent = stubAgent(
      { "check the trends": [{ type: "tool-call", payload: { toolName: "analyze_trends" } }] },
      captured,
    );
    await runToolSelectionEvals({
      agent,
      cases: [CASES[0]!],
      requestContext,
      memoryFor: (c) => ({ thread: `eval-${c.id}`, resource: "p-1" }),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.messages).toEqual([{ role: "user", content: "check the trends" }]);
    expect(captured[0]!.options).toEqual({
      requestContext,
      maxSteps: 8,
      memory: { thread: "eval-trend-analyze", resource: "p-1" },
    });
  });
});
