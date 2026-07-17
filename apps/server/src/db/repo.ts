import { randomUUID } from "node:crypto";
import type { ClaimSnapshot, ExposureRecord, IlfTableRow, OriginCadence } from "@actuarial-ts/core";
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

/** Method keys for the selection-of-ultimates exhibit. */
export type SelectionMethodKey =
  | "clPaid"
  | "clIncurred"
  | "bfPaid"
  | "bfIncurred"
  | "gbPaid"
  | "gbIncurred"
  | "bsCase"
  | "bsSettlement"
  | "ccPaid"
  | "ccIncurred"
  | "expectedClaims"
  | "freqSev";

export interface UltimateSelectionState {
  /**
   * Method weights applied to every origin period that has no per-period
   * entry. Setting one of these "all periods" weights also overwrites the
   * per-period entries for that method.
   */
  defaultWeights: Record<SelectionMethodKey, number>;
  /** Per-origin-period method weights; a full row of weights when present. */
  weightsByOrigin: Record<string, Record<SelectionMethodKey, number>>;
  /** Per-origin manual override of the selected ultimate (takes precedence). */
  overrides: Record<string, number>;
}

export function defaultUltimateSelection(): UltimateSelectionState {
  return {
    defaultWeights: {
      clPaid: 1,
      clIncurred: 1,
      bfPaid: 0,
      bfIncurred: 0,
      gbPaid: 0,
      gbIncurred: 0,
      bsCase: 0,
      bsSettlement: 0,
      ccPaid: 0,
      ccIncurred: 0,
      expectedClaims: 0,
      freqSev: 0,
    },
    weightsByOrigin: {},
    overrides: {},
  };
}

/** The development layer: raw losses, or losses capped at a per-occurrence limit. */
export type LayerKey = "unlimited" | "capped";

export interface TailChoice {
  source: "manual" | "exponentialDecay" | "inversePower";
  value: number;
}

export interface TrendChoice {
  /** Which fitted window the selection came from, or a manual judgment. */
  source: "all" | "last5" | "last3" | "exhilo" | "manual";
  /** The selected annual rate (frozen at selection time); null = unselected. */
  value: number | null;
}

export interface TrendState {
  frequency: TrendChoice;
  /** Severity trend is a per-layer judgment: the cap compresses trend. */
  severity: Record<LayerKey, TrendChoice>;
  /** Cost level the exhibit trends TO; null = latest origin year. */
  targetYear: number | null;
}

export interface RatesState {
  /** Rate-change history for parallelogram on-leveling. */
  history: { effectiveDate: string; change: number }[];
  /** Annual premium trend rate; null = none. */
  premiumTrend: number | null;
}

export type ElrMethod = "loss-ratio" | "pure-premium";

export interface ElrState {
  /**
   * A-priori method. "loss-ratio" divides trended developed losses by ON-LEVEL
   * earned PREMIUM and yields a loss ratio; "pure-premium" divides by EXPOSURE
   * UNITS (no premium on-leveling - units are not rate-sensitive) and yields a
   * pure premium (loss cost per unit). Both feed BF and Expected Claims.
   */
  method: ElrMethod;
  /**
   * Selected a-priori AT THE TARGET COST LEVEL; null = unselected. Its unit
   * follows `method`: a loss ratio (e.g. 0.65) for loss-ratio, a pure premium
   * (dollars per exposure unit) for pure-premium.
   */
  selected: number | null;
  /**
   * The dollar level of the exhibit the a-priori was selected FROM (stamped at
   * selection time). A run at a different level must not consume it - a
   * total-limits a-priori applied to capped triangles (or vice versa) is wrong
   * by the whole uncap factor.
   */
  selectedAtLevel: "unlimited" | "limited" | "restored" | null;
}

export function defaultTrendState(): TrendState {
  return {
    frequency: { source: "manual", value: null },
    severity: {
      unlimited: { source: "manual", value: null },
      capped: { source: "manual", value: null },
    },
    targetYear: null,
  };
}

export interface LayerState {
  /** Which layer's triangles the whole pipeline runs on. */
  active: LayerKey;
  /** Per-occurrence cap stated at the baseYear cost level; null = no cap defined. */
  cap: number | null;
  /** Annual rate indexing the cap across accident years (0 = flat cap). */
  indexRate: number;
  /** Accident year at whose cost level the cap is stated; null = latest year in data. */
  baseYear: number | null;
}

export interface WorkspaceState {
  cadence: OriginCadence;
  asOfDate: string;
  basis: "paid" | "incurred";
  layer: LayerState;
  /**
   * Per-layer, per-basis LDF selections keyed to the development columns.
   * Capped and unlimited triangles develop differently, so their selections
   * are independent - sharing them would silently invalidate one layer.
   */
  selections: Record<LayerKey, { paid: (number | null)[]; incurred: (number | null)[] }>;
  tail: Record<LayerKey, { paid: TailChoice; incurred: TailChoice }>;
  /**
   * Per-layer method assumptions: an a-priori loss ratio or severity trend
   * judged at the unlimited level does NOT describe the capped layer (the cap
   * compresses both), so sharing them would silently contaminate one layer.
   */
  /** Increased-limits configuration: how capped ultimates restore to total limits. */
  ilf: IlfState;
  bf: Record<LayerKey, { aprioriLossRatio: number | null }>;
  berquist: Record<
    LayerKey,
    { severityTrend: number | null; interpolation: "exponential" | "linear" }
  >;
  ultimateSelection: UltimateSelectionState;
  trend: TrendState;
  rates: RatesState;
  elr: ElrState;
}

export interface IlfState {
  /** Where the uncap factor comes from; "none" leaves capped runs limited. */
  source: "none" | "fitted" | "table" | "illustrative";
  /** Which fitted curve applies when source = "fitted". */
  fittedKind: "lognormal" | "pareto";
  /** Illustrative curve id when source = "illustrative". */
  curveId: string | null;
  /** Imported ILF table rows (limit at base-year level, factor). */
  table: IlfTableRow[] | null;
  /** Restoration target limit at base-year level; null = unlimited (curves only). */
  targetLimit: number | null;
}

export function defaultIlfState(): IlfState {
  return { source: "none", fittedKind: "lognormal", curveId: null, table: null, targetLimit: null };
}

export function defaultLayerBf(): WorkspaceState["bf"] {
  return {
    unlimited: { aprioriLossRatio: null },
    capped: { aprioriLossRatio: null },
  };
}

export function defaultLayerBerquist(): WorkspaceState["berquist"] {
  return {
    unlimited: { severityTrend: null, interpolation: "exponential" },
    capped: { severityTrend: null, interpolation: "exponential" },
  };
}

export function emptyLayerSelections(): WorkspaceState["selections"] {
  return {
    unlimited: { paid: [], incurred: [] },
    capped: { paid: [], incurred: [] },
  };
}

export function defaultLayerTails(): WorkspaceState["tail"] {
  return {
    unlimited: {
      paid: { source: "manual", value: 1 },
      incurred: { source: "manual", value: 1 },
    },
    capped: {
      paid: { source: "manual", value: 1 },
      incurred: { source: "manual", value: 1 },
    },
  };
}

export function defaultWorkspaceState(asOfDate: string): WorkspaceState {
  return {
    cadence: "annual",
    asOfDate,
    basis: "paid",
    layer: { active: "unlimited", cap: null, indexRate: 0, baseYear: null },
    selections: emptyLayerSelections(),
    tail: defaultLayerTails(),
    ilf: defaultIlfState(),
    bf: defaultLayerBf(),
    berquist: defaultLayerBerquist(),
    ultimateSelection: defaultUltimateSelection(),
    trend: defaultTrendState(),
    rates: { history: [], premiumTrend: null },
    elr: { method: "loss-ratio", selected: null, selectedAtLevel: null },
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

/** Atomically replaces the project's loss run: delete + insert in ONE transaction. */
export function replaceClaims(projectId: string, rows: ClaimSnapshot[]): number {
  const del = db.prepare("DELETE FROM claims WHERE project_id = ?");
  const stmt = db.prepare(
    `INSERT INTO claims (project_id, claim_id, accident_date, report_date, evaluation_date, paid_to_date, case_reserve, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((batch: ClaimSnapshot[]) => {
    del.run(projectId);
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
  tx(rows);
  return rows.length;
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
    "INSERT INTO exposures (project_id, origin, earned_premium, exposure_units) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction((batch: ExposureRecord[]) => {
    del.run(projectId);
    for (const r of batch) ins.run(projectId, r.origin, r.earnedPremium ?? null, r.exposureUnits ?? null);
  });
  tx(rows);
  return rows.length;
}

export function getExposures(projectId: string): ExposureRecord[] {
  return db
    .prepare(
      "SELECT origin, earned_premium AS earnedPremium, exposure_units AS exposureUnits FROM exposures WHERE project_id = ? ORDER BY origin",
    )
    .all(projectId) as ExposureRecord[];
}

// ---------------------------------------------------------------------------
// Workspace state

export function getWorkspaceState(projectId: string): WorkspaceState | null {
  const row = db.prepare("SELECT state FROM workspaces WHERE project_id = ?").get(projectId) as
    | { state: string }
    | undefined;
  if (!row) return null;
  const state = JSON.parse(row.state) as WorkspaceState;
  // Migrate pre-layer workspaces in place: the flat selections/tail shapes
  // become the "unlimited" layer, and the capped layer starts pristine.
  if (!state.layer) {
    state.layer = { active: "unlimited", cap: null, indexRate: 0, baseYear: null };
  }
  const flatSelections = state.selections as unknown as {
    paid?: unknown;
    unlimited?: unknown;
  };
  if (state.selections && Array.isArray(flatSelections.paid)) {
    const legacy = state.selections as unknown as {
      paid: (number | null)[];
      incurred: (number | null)[];
    };
    state.selections = {
      unlimited: { paid: legacy.paid, incurred: legacy.incurred },
      capped: { paid: [], incurred: [] },
    };
  } else if (!state.selections || !flatSelections.unlimited) {
    state.selections = emptyLayerSelections();
  }
  const flatTail = state.tail as unknown as {
    paid?: { source?: unknown };
    unlimited?: unknown;
  };
  if (state.tail && flatTail.paid && flatTail.paid.source !== undefined) {
    const legacy = state.tail as unknown as { paid: TailChoice; incurred: TailChoice };
    state.tail = {
      unlimited: { paid: legacy.paid, incurred: legacy.incurred },
      capped: {
        paid: { source: "manual", value: 1 },
        incurred: { source: "manual", value: 1 },
      },
    };
  } else if (!state.tail || !flatTail.unlimited) {
    state.tail = defaultLayerTails();
  }
  if (!state.ilf) state.ilf = defaultIlfState();
  const flatBf = state.bf as unknown as { aprioriLossRatio?: unknown; unlimited?: unknown };
  if (state.bf && flatBf.unlimited === undefined) {
    const legacy = state.bf as unknown as { aprioriLossRatio: number | null };
    state.bf = {
      unlimited: { aprioriLossRatio: legacy.aprioriLossRatio ?? null },
      capped: { aprioriLossRatio: null },
    };
  } else if (!state.bf) {
    state.bf = defaultLayerBf();
  }
  const flatBq = state.berquist as unknown as { severityTrend?: unknown; unlimited?: unknown };
  if (state.berquist && flatBq.unlimited === undefined) {
    const legacy = state.berquist as unknown as {
      severityTrend: number | null;
      interpolation: "exponential" | "linear";
    };
    state.berquist = {
      unlimited: {
        severityTrend: legacy.severityTrend ?? null,
        interpolation: legacy.interpolation ?? "exponential",
      },
      capped: { severityTrend: null, interpolation: "exponential" },
    };
  } else if (!state.berquist) {
    state.berquist = defaultLayerBerquist();
  }
  if (!state.trend) {
    state.trend = defaultTrendState();
  }
  if (!state.rates) {
    state.rates = { history: [], premiumTrend: null };
  }
  if (!state.elr) {
    state.elr = { method: "loss-ratio", selected: null, selectedAtLevel: null };
  } else {
    if (state.elr.selectedAtLevel === undefined) {
      // Pre-stamp selections came from unlimited-level exhibits by construction.
      state.elr.selectedAtLevel = state.elr.selected !== null ? "unlimited" : null;
    }
    // Workspaces persisted before the pure-premium method existed are loss-ratio.
    if (state.elr.method === undefined) state.elr.method = "loss-ratio";
  }
  // Backfill for workspaces persisted before the selection exhibit existed,
  // and migrate the pre-matrix shape (a single global `weights` record).
  if (!state.ultimateSelection) {
    state.ultimateSelection = defaultUltimateSelection();
  } else {
    const legacy = state.ultimateSelection as unknown as {
      weights?: Record<SelectionMethodKey, number>;
    };
    if (!state.ultimateSelection.defaultWeights) {
      state.ultimateSelection.defaultWeights =
        legacy.weights ?? defaultUltimateSelection().defaultWeights;
      delete legacy.weights;
    }
    if (!state.ultimateSelection.weightsByOrigin) state.ultimateSelection.weightsByOrigin = {};
    if (!state.ultimateSelection.overrides) state.ultimateSelection.overrides = {};
  }
  // New method keys join the weights records with zero weight - AFTER the
  // pre-matrix migration above, so legacy flat-weights states get them too.
  if (state.ultimateSelection?.defaultWeights) {
    for (const key of [
      "ccPaid",
      "ccIncurred",
      "expectedClaims",
      "gbPaid",
      "gbIncurred",
      "freqSev",
    ] as const) {
      if (state.ultimateSelection.defaultWeights[key] === undefined) {
        state.ultimateSelection.defaultWeights[key] = 0;
      }
    }
  }
  return state;
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
