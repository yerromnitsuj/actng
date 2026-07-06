import { create } from "zustand";
import { api, ApiError, streamChat } from "../api/client.js";
import type {
  AnalysisListItem,
  AnalysisRecord,
  ChatMessage,
  ChatStreamEvent,
  Note,
  Project,
  Thread,
  ToolEvent,
  WorkspaceView,
} from "../api/types.js";

/** A message being streamed right now (not yet persisted server-side). */
export interface LiveTurn {
  content: string;
  toolEvents: ToolEvent[];
  pendingTool: string | null;
}

interface AppState {
  projects: Project[];
  projectsLoaded: boolean;
  error: string | null;

  workspace: WorkspaceView | null;
  workspaceProjectId: string | null;
  workspaceLoading: boolean;
  /** Bumped when the advisor changes the workspace (drives the gold pulse). */
  advisorChangeTick: number;

  analyses: AnalysisListItem[];
  currentAnalysis: AnalysisRecord | null;
  runningAnalysis: boolean;

  notes: Note[];

  threads: Thread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  liveTurn: LiveTurn | null;
  chatBusy: boolean;

  loadProjects: () => Promise<void>;
  createProject: (name: string, description: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  loadWorkspace: (projectId: string) => Promise<void>;
  patchWorkspace: (patch: unknown) => Promise<void>;
  runAnalysis: (label?: string) => Promise<void>;
  loadAnalyses: (projectId: string) => Promise<void>;
  openAnalysis: (analysisId: string) => Promise<void>;

  loadNotes: (projectId: string) => Promise<void>;
  addNote: (text: string) => Promise<void>;

  loadThreads: (projectId: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  newThread: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;

  clearError: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  projectsLoaded: false,
  error: null,
  workspace: null,
  workspaceProjectId: null,
  workspaceLoading: false,
  advisorChangeTick: 0,
  analyses: [],
  currentAnalysis: null,
  runningAnalysis: false,
  notes: [],
  threads: [],
  activeThreadId: null,
  messages: [],
  liveTurn: null,
  chatBusy: false,

  clearError: () => set({ error: null }),

  loadProjects: async () => {
    try {
      const { projects } = await api.listProjects();
      set({ projects, projectsLoaded: true });
    } catch (err) {
      set({ error: errorText(err), projectsLoaded: true });
    }
  },

  createProject: async (name, description) => {
    const { project } = await api.createProject(name, description);
    await get().loadProjects();
    return project;
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    await get().loadProjects();
  },

  loadWorkspace: async (projectId) => {
    set({ workspaceLoading: true, workspaceProjectId: projectId });
    try {
      const view = await api.getWorkspace(projectId);
      set({ workspace: view, workspaceLoading: false });
    } catch (err) {
      // A project without claims is a normal state the page renders as the
      // import prompt; only unexpected failures surface as a global error.
      const expected = err instanceof ApiError && err.code === "NO_CLAIMS";
      set({
        workspace: null,
        workspaceLoading: false,
        error: expected ? get().error : errorText(err),
      });
    }
  },

  patchWorkspace: async (patch) => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    try {
      const view = await api.patchWorkspace(projectId, patch);
      set({ workspace: view });
    } catch (err) {
      set({ error: errorText(err) });
      throw err;
    }
  },

  runAnalysis: async (label) => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    set({ runningAnalysis: true });
    try {
      const { analysis } = await api.runAnalysis(projectId, label);
      set({ currentAnalysis: analysis, runningAnalysis: false });
      await get().loadAnalyses(projectId);
    } catch (err) {
      set({ runningAnalysis: false, error: errorText(err) });
    }
  },

  loadAnalyses: async (projectId) => {
    try {
      const { analyses } = await api.listAnalyses(projectId);
      set({ analyses });
      if (!get().currentAnalysis && analyses.length > 0) {
        const { analysis } = await api.getAnalysis(projectId, analyses[0]!.id);
        set({ currentAnalysis: analysis });
      }
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  openAnalysis: async (analysisId) => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    try {
      const { analysis } = await api.getAnalysis(projectId, analysisId);
      set({ currentAnalysis: analysis });
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  loadNotes: async (projectId) => {
    try {
      const { notes } = await api.listNotes(projectId);
      set({ notes });
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  addNote: async (text) => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    await api.addNote(projectId, text);
    await get().loadNotes(projectId);
  },

  loadThreads: async (projectId) => {
    try {
      const { threads } = await api.listThreads(projectId);
      set({ threads });
      if (threads.length > 0 && !get().activeThreadId) {
        await get().selectThread(threads[0]!.id);
      }
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  selectThread: async (threadId) => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    set({ activeThreadId: threadId });
    const { messages } = await api.listMessages(projectId, threadId);
    set({ messages });
  },

  newThread: async () => {
    const projectId = get().workspaceProjectId;
    if (!projectId) return;
    const { thread } = await api.createThread(projectId);
    set({ activeThreadId: thread.id, messages: [] });
    await get().loadThreads(projectId);
  },

  sendMessage: async (text) => {
    const projectId = get().workspaceProjectId;
    let threadId = get().activeThreadId;
    if (!projectId || get().chatBusy) return;
    if (!threadId) {
      const { thread } = await api.createThread(projectId);
      threadId = thread.id;
      set({ activeThreadId: threadId });
    }

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      threadId,
      role: "user",
      content: text,
      toolEvents: [],
      createdAt: new Date().toISOString(),
    };
    set({
      messages: [...get().messages, userMessage],
      liveTurn: { content: "", toolEvents: [], pendingTool: null },
      chatBusy: true,
    });

    let workspaceDirty = false;
    const flushWorkspace = async () => {
      if (!workspaceDirty) return;
      workspaceDirty = false;
      await get().loadWorkspace(projectId);
      await get().loadAnalyses(projectId);
      await get().loadNotes(projectId);
      set({ advisorChangeTick: get().advisorChangeTick + 1 });
    };

    const onEvent = (event: ChatStreamEvent) => {
      const live = get().liveTurn ?? { content: "", toolEvents: [], pendingTool: null };
      switch (event.type) {
        case "text-delta":
          set({ liveTurn: { ...live, content: live.content + event.text } });
          break;
        case "tool-call":
          set({ liveTurn: { ...live, pendingTool: event.toolName } });
          break;
        case "tool-result":
          set({
            liveTurn: {
              ...live,
              pendingTool: null,
              toolEvents: [
                ...live.toolEvents,
                {
                  toolName: event.toolName,
                  args: null,
                  result: event.result,
                  isAction: event.isAction,
                },
              ],
            },
          });
          if (event.isAction) workspaceDirty = true;
          break;
        case "error":
          set({ error: event.message });
          break;
        case "done":
          break;
      }
    };

    try {
      await streamChat(projectId, threadId, text, onEvent);
    } catch (err) {
      set({ error: errorText(err) });
    } finally {
      // Re-fetch the persisted transcript so ids and ordering are canonical.
      try {
        const { messages } = await api.listMessages(projectId, threadId);
        set({ messages, liveTurn: null, chatBusy: false });
      } catch {
        set({ liveTurn: null, chatBusy: false });
      }
      await flushWorkspace();
      await get().loadThreads(projectId);
    }
  },
}));

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
