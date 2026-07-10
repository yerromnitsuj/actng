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
  /** A failed "Run analysis" (e.g. 422 no-selections): held in the work area
   * until the next run, not just flashed as an 8s top toast that scrolls away. */
  runError: string | null;

  notes: Note[];

  threads: Thread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  liveTurn: LiveTurn | null;
  chatBusy: boolean;

  loadProjects: () => Promise<void>;
  createProject: (name: string, description: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  /** Entry point for the workspace page: resets project-scoped state on switch. */
  openProject: (projectId: string) => Promise<void>;
  loadWorkspace: (projectId: string) => Promise<void>;
  patchWorkspace: (patch: unknown) => Promise<void>;
  runAnalysis: (label?: string) => Promise<void>;
  loadAnalyses: (projectId: string, options?: { selectLatest?: boolean }) => Promise<void>;
  openAnalysis: (analysisId: string) => Promise<void>;

  clearRunError: () => void;

  loadNotes: (projectId: string) => Promise<void>;
  addNote: (text: string) => Promise<void>;

  loadThreads: (projectId: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  newThread: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;

  clearError: () => void;
}

export const useStore = create<AppState>((set, get) => {
  /** True when the store has navigated away from this project mid-request. */
  const stale = (projectId: string) => get().workspaceProjectId !== projectId;

  return {
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
    runError: null,
    notes: [],
    threads: [],
    activeThreadId: null,
    messages: [],
    liveTurn: null,
    chatBusy: false,

    clearError: () => set({ error: null }),
    clearRunError: () => set({ runError: null }),

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

    openProject: async (projectId) => {
      if (get().workspaceProjectId !== projectId) {
        // Project switch: nothing from the previous project may linger.
        set({
          workspaceProjectId: projectId,
          workspace: null,
          analyses: [],
          currentAnalysis: null,
          notes: [],
          threads: [],
          activeThreadId: null,
          messages: [],
          liveTurn: null,
          chatBusy: false,
        });
      }
      await Promise.all([
        get().loadWorkspace(projectId),
        get().loadAnalyses(projectId),
        get().loadNotes(projectId),
        get().loadThreads(projectId),
      ]);
    },

    loadWorkspace: async (projectId) => {
      set({ workspaceLoading: true, workspaceProjectId: projectId });
      try {
        const view = await api.getWorkspace(projectId);
        if (stale(projectId)) return;
        set({ workspace: view, workspaceLoading: false });
      } catch (err) {
        if (stale(projectId)) return;
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
        if (stale(projectId)) return;
        set({ workspace: view });
      } catch (err) {
        set({ error: errorText(err) });
        throw err;
      }
    },

    runAnalysis: async (label) => {
      const projectId = get().workspaceProjectId;
      if (!projectId) return;
      set({ runningAnalysis: true, runError: null });
      try {
        const { analysis } = await api.runAnalysis(projectId, label);
        if (stale(projectId)) return;
        set({ currentAnalysis: analysis, runningAnalysis: false, runError: null });
        await get().loadAnalyses(projectId);
      } catch (err) {
        // A run failure is surfaced in the work area (runError), not the
        // transient top toast, so it can't be missed or auto-dismissed while
        // the user is mid-page looking at an exhibit that didn't change.
        set({ runningAnalysis: false, runError: errorText(err) });
      }
    },

    loadAnalyses: async (projectId, options = {}) => {
      try {
        const { analyses } = await api.listAnalyses(projectId);
        if (stale(projectId)) return;
        set({ analyses });
        const current = get().currentAnalysis;
        const latest = analyses[0];
        const needsLoad =
          latest !== undefined &&
          (!current ||
            current.projectId !== projectId ||
            (options.selectLatest === true && current.id !== latest.id));
        if (needsLoad) {
          const { analysis } = await api.getAnalysis(projectId, latest.id);
          if (stale(projectId)) return;
          set({ currentAnalysis: analysis });
        }
      } catch (err) {
        if (!stale(projectId)) set({ error: errorText(err) });
      }
    },

    openAnalysis: async (analysisId) => {
      const projectId = get().workspaceProjectId;
      if (!projectId) return;
      try {
        const { analysis } = await api.getAnalysis(projectId, analysisId);
        if (stale(projectId)) return;
        set({ currentAnalysis: analysis });
      } catch (err) {
        set({ error: errorText(err) });
      }
    },

    loadNotes: async (projectId) => {
      try {
        const { notes } = await api.listNotes(projectId);
        if (stale(projectId)) return;
        set({ notes });
      } catch (err) {
        if (!stale(projectId)) set({ error: errorText(err) });
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
        if (stale(projectId)) return;
        set({ threads });
        if (threads.length > 0 && !get().activeThreadId) {
          await get().selectThread(threads[0]!.id);
        }
      } catch (err) {
        if (!stale(projectId)) set({ error: errorText(err) });
      }
    },

    selectThread: async (threadId) => {
      const projectId = get().workspaceProjectId;
      if (!projectId || get().chatBusy) return;
      set({ activeThreadId: threadId });
      const { messages } = await api.listMessages(projectId, threadId);
      if (get().activeThreadId !== threadId) return;
      set({ messages });
    },

    newThread: async () => {
      const projectId = get().workspaceProjectId;
      if (!projectId || get().chatBusy) return;
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
      let transportFailed = false;
      const flushWorkspace = async () => {
        if (!workspaceDirty || stale(projectId)) return;
        workspaceDirty = false;
        await get().loadWorkspace(projectId);
        // selectLatest so an advisor-run analysis replaces the on-screen one;
        // two contradictory headline numbers on one screen is a trust killer.
        await get().loadAnalyses(projectId, { selectLatest: true });
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
        // Transport/validation failure before the server persisted anything:
        // keep the optimistic message on screen instead of refetching it away.
        transportFailed = true;
        set({ error: errorText(err) });
      } finally {
        if (transportFailed) {
          set({ liveTurn: null, chatBusy: false });
        } else {
          // Re-fetch the persisted transcript so ids and ordering are
          // canonical -- but only if the user has not switched threads or
          // projects while the stream ran.
          try {
            const { messages } = await api.listMessages(projectId, threadId);
            if (get().activeThreadId === threadId && !stale(projectId)) {
              set({ messages, liveTurn: null, chatBusy: false });
            } else {
              set({ liveTurn: null, chatBusy: false });
            }
          } catch {
            set({ liveTurn: null, chatBusy: false });
          }
        }
        await flushWorkspace();
        if (!stale(projectId)) await get().loadThreads(projectId);
      }
    },
  };
});

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
