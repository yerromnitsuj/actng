import type {
  AnalysisListItem,
  AnalysisRecord,
  ApiErrorBody,
  ChatMessage,
  ChatStreamEvent,
  Note,
  Project,
  Thread,
  WorkspaceView,
} from "./types.js";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body instanceof FormData ? undefined : { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    request<{ ok: boolean; advisorConfigured: boolean; advisorModel: string }>("/api/health"),

  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (name: string, description: string) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  importClaims: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ imported: number; claimCount: number }>(
      `/api/projects/${projectId}/import/claims`,
      { method: "POST", body: form },
    );
  },
  importIlfTable: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ imported: number }>(`/api/projects/${projectId}/import/ilf-table`, {
      method: "POST",
      body: form,
    });
  },
  importExposures: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ imported: number }>(`/api/projects/${projectId}/import/exposures`, {
      method: "POST",
      body: form,
    });
  },

  getWorkspace: (projectId: string) =>
    request<WorkspaceView>(`/api/projects/${projectId}/workspace`),
  patchWorkspace: (projectId: string, patch: unknown) =>
    request<WorkspaceView>(`/api/projects/${projectId}/workspace`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listAnalyses: (projectId: string) =>
    request<{ analyses: AnalysisListItem[] }>(`/api/projects/${projectId}/analyses`),
  runAnalysis: (projectId: string, label?: string) =>
    request<{ analysis: AnalysisRecord }>(`/api/projects/${projectId}/analyses`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  getAnalysis: (projectId: string, analysisId: string) =>
    request<{ analysis: AnalysisRecord }>(`/api/projects/${projectId}/analyses/${analysisId}`),

  listNotes: (projectId: string) => request<{ notes: Note[] }>(`/api/projects/${projectId}/notes`),
  addNote: (projectId: string, text: string) =>
    request<{ note: Note }>(`/api/projects/${projectId}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  listThreads: (projectId: string) =>
    request<{ threads: Thread[] }>(`/api/projects/${projectId}/threads`),
  createThread: (projectId: string) =>
    request<{ thread: Thread }>(`/api/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listMessages: (projectId: string, threadId: string) =>
    request<{ messages: ChatMessage[] }>(
      `/api/projects/${projectId}/threads/${threadId}/messages`,
    ),
};

/**
 * Streams one advisor turn. Parses the SSE frames from a fetch body and
 * invokes onEvent for each; resolves when the stream closes.
 */
export async function streamChat(
  projectId: string,
  threadId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/threads/${threadId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error) msg = body.error.message;
    } catch {
      // keep status text
    }
    throw new ApiError(res.status, "CHAT_FAILED", msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        onEvent({ type: eventName, ...parsed } as ChatStreamEvent);
      } catch {
        // malformed frame; skip rather than kill the stream
      }
    }
  }
}
