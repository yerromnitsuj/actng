import { Router, type Response } from "express";
import { z } from "zod";
import { RequestContext } from "@mastra/core/request-context";
import { assertAdvisorConfigured } from "../env.js";
import {
  createThread,
  getProject,
  getThread,
  insertChatMessage,
  listChatMessages,
  listThreads,
  touchThread,
  type ToolEvent,
} from "../db/repo.js";
import { HttpError } from "../services/workspaceService.js";
import { advisorAgent } from "../mastra/index.js";
import { ACTION_TOOL_IDS } from "../mastra/tools.js";

export const chatRouter = Router({ mergeParams: true });

function requireProject(id: string) {
  const project = getProject(id);
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return project;
}

function requireThread(projectId: string, threadId: string) {
  const thread = getThread(threadId);
  if (!thread || thread.projectId !== projectId) {
    throw new HttpError(404, "NOT_FOUND", "Thread not found");
  }
  return thread;
}

chatRouter.get("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  res.json({ threads: listThreads(project.id) });
});

chatRouter.post("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  const body = z
    .object({ title: z.string().trim().min(1).max(120).optional() })
    .parse(req.body ?? {});
  const thread = createThread(project.id, body.title ?? "New conversation");
  res.status(201).json({ thread });
});

chatRouter.get("/:threadId/messages", (req, res) => {
  const params = req.params as { id: string; threadId: string };
  requireProject(params.id);
  requireThread(params.id, params.threadId);
  res.json({ messages: listChatMessages(params.threadId) });
});

function sseWrite(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const chatBodySchema = z.object({ message: z.string().trim().min(1).max(8000) });

/**
 * Streams one advisor turn as SSE:
 *   text-delta {text} | tool-call {toolName,args} |
 *   tool-result {toolName,result,isAction} | done {messageId} | error {message}
 */
chatRouter.post("/:threadId/chat", async (req, res) => {
  const params = req.params as { id: string; threadId: string };
  const project = requireProject(params.id);
  const thread = requireThread(project.id, params.threadId);
  const { message } = chatBodySchema.parse(req.body);
  assertAdvisorConfigured();

  // Title brand-new conversations from the first user message.
  if (thread.title === "New conversation") {
    const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
    touchThread(thread.id, title);
  }
  insertChatMessage(thread.id, "user", message);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
  });

  const requestContext = new RequestContext();
  requestContext.set("projectId", project.id);

  const textParts: string[] = [];
  const toolEvents: ToolEvent[] = [];
  const argsByCallId = new Map<string, { toolName: string; args: unknown }>();

  try {
    const stream = await advisorAgent.stream([{ role: "user", content: message }], {
      memory: { thread: thread.id, resource: `project-${project.id}` },
      requestContext,
      maxSteps: 16,
    });

    for await (const chunk of stream.fullStream as AsyncIterable<Record<string, any>>) {
      if (clientGone) break;
      switch (chunk.type) {
        case "text-delta": {
          const text: string =
            chunk.delta ?? chunk.payload?.text ?? chunk.payload?.delta ?? chunk.text ?? "";
          if (text) {
            textParts.push(text);
            sseWrite(res, "text-delta", { text });
          }
          break;
        }
        case "tool-call": {
          const payload = chunk.payload ?? chunk;
          const toolName: string = payload.toolName ?? payload.name ?? "unknown";
          const toolCallId: string = payload.toolCallId ?? payload.id ?? "";
          const args = payload.args ?? payload.input ?? {};
          argsByCallId.set(toolCallId, { toolName, args });
          sseWrite(res, "tool-call", { toolName, args });
          break;
        }
        case "tool-result": {
          const payload = chunk.payload ?? chunk;
          const toolCallId: string = payload.toolCallId ?? payload.id ?? "";
          const call = argsByCallId.get(toolCallId);
          const toolName: string = payload.toolName ?? payload.name ?? call?.toolName ?? "unknown";
          const result = payload.result ?? payload.output ?? null;
          const isAction = ACTION_TOOL_IDS.has(toolName);
          toolEvents.push({ toolName, args: call?.args ?? null, result, isAction });
          sseWrite(res, "tool-result", { toolName, result, isAction });
          break;
        }
        case "error": {
          const payload = chunk.payload ?? chunk;
          const errMessage: string =
            payload?.error?.message ?? payload?.message ?? "The advisor hit a streaming error";
          throw new Error(errMessage);
        }
        default:
          break;
      }
    }

    const content = textParts.join("");
    const saved = insertChatMessage(thread.id, "assistant", content, toolEvents);
    sseWrite(res, "done", {
      messageId: saved.id,
      workspaceChanged: toolEvents.some((e) => e.isAction),
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Advisor turn failed";
    console.error("[chat] advisor turn failed:", err);
    // Persist whatever partial content exists so the transcript stays honest.
    if (textParts.length > 0 || toolEvents.length > 0) {
      insertChatMessage(
        thread.id,
        "assistant",
        `${textParts.join("")}\n\n[The advisor was interrupted by an error: ${messageText}]`,
        toolEvents,
      );
    }
    sseWrite(res, "error", { message: messageText });
  } finally {
    if (!res.writableEnded) res.end();
  }
});
