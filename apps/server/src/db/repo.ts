import { randomUUID } from "node:crypto";
import type { ClaimSnapshot, ExposureRecord, OriginCadence } from "@actng/core";
import { db } from "./client.js";

/** Typed repository layer. All JSON columns are parsed/serialized here. */

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  claimRowCount: number;
  claimCount: number;
  exposureCount: number;
}

export interface WorkspaceState {
  cadence: OriginCadence;
  asOfDate: string;
  basis: "paid" | "incurred";
  /** Per-basis LDF selections, keyed to the development columns of that basis. */
  selections: {
    paid: (number | null)[];
    incurred: (number | null)[];
  };
  tail: {
    paid: { source: "manual" | "exponentialDecay" | "inversePower"; value: number };
    incurred: { source: "manual" | "exponentialDecay" | "inversePower"; value: number };
  };
  bf: { aprioriLossRatio: number | null };
  berquist: {
    severityTrend: number | null;
    interpolation: "exponential" | "linear";
  };
}

export function defaultWorkspaceState(asOfDate: string): WorkspaceState {
  return {
    cadence: "annual",
    asOfDate,
    basis: "paid",
    selections: { paid: [], incurred: [] },
    tail: {
      paid: { source: "manual", value: 1 },
      incurred: { source: "manual", value: 1 },
    },
    bf: { aprioriLossRatio: null },
    berquist: { severityTrend: null, interpolation: "exponential" },
  };
}

export interface AnalysisRecord {
  id: string;
  projectId: string;
  label: string;
  inputs: unknown;
  results: unknown;
  createdAt: string;
}

export interface Note {
  id: string;
  projectId: string;
  author: "user" | "advisor";
  text: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolEvent {
  toolName: string;
  args: unknown;
  result: unknown;
  isAction: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  toolEvents: ToolEvent[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Projects

export function createProject(name: string, description: string): Project {
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)").run(
    id,
    name,
    description,
  );
  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const row = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.created_at AS createdAt,
        (SELECT COUNT(*) FROM claims c WHERE c.project_id = p.id) AS claimRowCount,
        (SELECT COUNT(DISTINCT c.claim_id) FROM claims c WHERE c.project_id = p.id) AS claimCount,
        (SELECT COUNT(*) FROM exposures e WHERE e.project_id = p.id) AS exposureCount
       FROM projects p WHERE p.id = ?`,
    )
    .get(id) as Project | undefined;
  return row ?? null;
}

export function listProjects(): Project[] {
  const ids = db.prepare("SELECT id FROM projects ORDER BY created_at DESC").all() as {
    id: string;
  }[];
  return ids.map(({ id }) => getProject(id)!)
}

export function deleteProject(id: string): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Claims and exposures

export function insertClaims(projectId: string, rows: ClaimSnapshot[]): number {
  const stmt = db.prepare(
    `INSERT INTO claims (project_id, claim_id, accident_date, report_date, evaluation_date, paid_to_date, case_reserve, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAll = db.transaction((batch: ClaimSnapshot[]) => {
    for (const r of batch) {
      stmt.run(
        projectId,
        r.claimId,
        r.accidentDate,
        r.reportDate,
        r.evaluationDate,
        r.paidToDate,
        r.caseReserve,
        r.status,
      );
    }
  });
  insertAll(rows);
  return rows.length;
}

export function deleteClaims(projectId: string): number {
  return db.prepare("DELETE FROM claims WHERE project_id = ?").run(projectId).changes;
}

export function getClaims(projectId: string): ClaimSnapshot[] {
  return db
    .prepare(
      `SELECT claim_id AS claimId, accident_date AS accidentDate, report_date AS reportDate,
              evaluation_date AS evaluationDate, paid_to_date AS paidToDate,
              case_reserve AS caseReserve, status
       FROM claims WHERE project_id = ? ORDER BY claim_id, evaluation_date`,
    )
    .all(projectId) as ClaimSnapshot[];
}

export function replaceExposures(projectId: string, rows: ExposureRecord[]): number {
  const del = db.prepare("DELETE FROM exposures WHERE project_id = ?");
  const ins = db.prepare(
    "INSERT INTO exposures (project_id, origin, earned_premium) VALUES (?, ?, ?)",
  );
  const tx = db.transaction((batch: ExposureRecord[]) => {
    del.run(projectId);
    for (const r of batch) ins.run(projectId, r.origin, r.earnedPremium);
  });
  tx(rows);
  return rows.length;
}

export function getExposures(projectId: string): ExposureRecord[] {
  return db
    .prepare(
      "SELECT origin, earned_premium AS earnedPremium FROM exposures WHERE project_id = ? ORDER BY origin",
    )
    .all(projectId) as ExposureRecord[];
}

// ---------------------------------------------------------------------------
// Workspace state

export function getWorkspaceState(projectId: string): WorkspaceState | null {
  const row = db.prepare("SELECT state FROM workspaces WHERE project_id = ?").get(projectId) as
    | { state: string }
    | undefined;
  return row ? (JSON.parse(row.state) as WorkspaceState) : null;
}

export function saveWorkspaceState(projectId: string, state: WorkspaceState): void {
  db.prepare(
    `INSERT INTO workspaces (project_id, state, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(project_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(projectId, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Analyses

export function insertAnalysis(
  projectId: string,
  label: string,
  inputs: unknown,
  results: unknown,
): AnalysisRecord {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO analyses (id, project_id, label, inputs, results) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, label, JSON.stringify(inputs), JSON.stringify(results));
  return getAnalysis(id)!;
}

export function getAnalysis(id: string): AnalysisRecord | null {
  const row = db
    .prepare(
      `SELECT id, project_id AS projectId, label, inputs, results, created_at AS createdAt
       FROM analyses WHERE id = ?`,
    )
    .get(id) as (Omit<AnalysisRecord, "inputs" | "results"> & { inputs: string; results: string }) | undefined;
  if (!row) return null;
  return { ...row, inputs: JSON.parse(row.inputs), results: JSON.parse(row.results) };
}

export function listAnalyses(projectId: string): Omit<AnalysisRecord, "inputs" | "results">[] {
  return db
    .prepare(
      `SELECT id, project_id AS projectId, label, created_at AS createdAt
       FROM analyses WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .all(projectId) as Omit<AnalysisRecord, "inputs" | "results">[];
}

export function latestAnalysis(projectId: string): AnalysisRecord | null {
  const row = db
    .prepare(
      "SELECT id FROM analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId) as { id: string } | undefined;
  return row ? getAnalysis(row.id) : null;
}

// ---------------------------------------------------------------------------
// Notes

export function insertNote(projectId: string, author: Note["author"], text: string): Note {
  const id = randomUUID();
  db.prepare("INSERT INTO notes (id, project_id, author, text) VALUES (?, ?, ?, ?)").run(
    id,
    projectId,
    author,
    text,
  );
  return db
    .prepare(
      "SELECT id, project_id AS projectId, author, text, created_at AS createdAt FROM notes WHERE id = ?",
    )
    .get(id) as Note;
}

export function listNotes(projectId: string): Note[] {
  return db
    .prepare(
      "SELECT id, project_id AS projectId, author, text, created_at AS createdAt FROM notes WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as Note[];
}

// ---------------------------------------------------------------------------
// Chat threads and messages (UI-facing store; the advisor's model context is
// managed separately by Mastra memory, keyed by the same thread id)

export function createThread(projectId: string, title: string): Thread {
  const id = randomUUID();
  db.prepare("INSERT INTO threads (id, project_id, title) VALUES (?, ?, ?)").run(
    id,
    projectId,
    title,
  );
  return getThread(id)!;
}

export function getThread(id: string): Thread | null {
  const row = db
    .prepare(
      "SELECT id, project_id AS projectId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE id = ?",
    )
    .get(id) as Thread | undefined;
  return row ?? null;
}

export function listThreads(projectId: string): Thread[] {
  return db
    .prepare(
      "SELECT id, project_id AS projectId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE project_id = ? ORDER BY updated_at DESC",
    )
    .all(projectId) as Thread[];
}

export function touchThread(id: string, title?: string): void {
  if (title !== undefined) {
    db.prepare(
      "UPDATE threads SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(title, id);
  } else {
    db.prepare(
      "UPDATE threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(id);
  }
}

export function insertChatMessage(
  threadId: string,
  role: ChatMessage["role"],
  content: string,
  toolEvents: ToolEvent[] = [],
): ChatMessage {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO chat_messages (id, thread_id, role, content, tool_events) VALUES (?, ?, ?, ?, ?)",
  ).run(id, threadId, role, content, JSON.stringify(toolEvents));
  touchThread(threadId);
  return {
    id,
    threadId,
    role,
    content,
    toolEvents,
    createdAt: new Date().toISOString(),
  };
}

export function listChatMessages(threadId: string): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, thread_id AS threadId, role, content, tool_events AS toolEvents, created_at AS createdAt
       FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC`,
    )
    .all(threadId) as (Omit<ChatMessage, "toolEvents"> & { toolEvents: string })[];
  return rows.map((r) => ({ ...r, toolEvents: JSON.parse(r.toolEvents) as ToolEvent[] }));
}
