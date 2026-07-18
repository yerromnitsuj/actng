import Database from "better-sqlite3";
import { env } from "../env.js";

/**
 * SQLite persistence. The schema is bootstrapped idempotently at startup;
 * for a single-file embedded database this is deliberate (see README's
 * design-decisions section) -- there is no external migration runner to
 * drift from, and every statement below is additive-safe.
 */
export const db: Database.Database = new Database(env.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL,
  accident_date TEXT NOT NULL,
  report_date TEXT NOT NULL,
  evaluation_date TEXT NOT NULL,
  paid_to_date REAL NOT NULL,
  case_reserve REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_id);

CREATE TABLE IF NOT EXISTS exposures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  earned_premium REAL NOT NULL,
  UNIQUE(project_id, origin)
);

CREATE TABLE IF NOT EXISTS workspaces (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  inputs TEXT NOT NULL,
  results TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_project ON analyses(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('user','advisor')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id, updated_at DESC);

-- Study promotion runs (interchange spec rev 2.1, section 6). One row per
-- promoteStudy workflow run: the STUDY DOCUMENT itself plus the options the
-- chain was constructed with, so a restarted server reconstructs the
-- IDENTICAL chain deterministically (eager intake makes reconstruction a
-- pure function of study + ceiling) and resumes the paused run from the
-- Mastra snapshot store. state_json is the last described gate view.
CREATE TABLE IF NOT EXISTS studies (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_json TEXT NOT NULL,
  tolerance_ceiling REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting-decision','advancing','complete','failed')),
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_studies_project ON studies(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  tool_events TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);
`);

/**
 * Additive migration: the exposures table gains an `exposure_units` column and
 * `earned_premium` becomes nullable, so a project can carry earned premium (the
 * loss-ratio method), exposure units (the pure-premium method), or both. SQLite
 * cannot relax a NOT NULL in place, so the table is rebuilt once (guarded on the
 * absence of the new column). Idempotent and additive: existing premium is
 * copied verbatim.
 */
{
  const cols = db.prepare("PRAGMA table_info(exposures)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "exposure_units")) {
    db.exec(`
      ALTER TABLE exposures RENAME TO exposures_legacy;
      CREATE TABLE exposures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        earned_premium REAL,
        exposure_units REAL,
        UNIQUE(project_id, origin)
      );
      INSERT INTO exposures (id, project_id, origin, earned_premium)
        SELECT id, project_id, origin, earned_premium FROM exposures_legacy;
      DROP TABLE exposures_legacy;
    `);
  }
}

/**
 * Additive migration: studies.status gains the transient 'advancing' value
 * (the CAS claim one in-flight advancePromotion holds; see db/repo.ts).
 * SQLite cannot widen a CHECK constraint in place, so tables created before
 * the value existed are rebuilt once, guarded on the old CHECK text. Data is
 * copied verbatim; the rebuild is idempotent.
 */
{
  const master = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'studies'")
    .get() as { sql: string } | undefined;
  if (master && !master.sql.includes("'advancing'")) {
    db.exec(`
      ALTER TABLE studies RENAME TO studies_legacy;
      CREATE TABLE studies (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        study_json TEXT NOT NULL,
        tolerance_ceiling REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('awaiting-decision','advancing','complete','failed')),
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO studies (run_id, project_id, study_json, tolerance_ceiling, status, state_json, created_at, updated_at)
        SELECT run_id, project_id, study_json, tolerance_ceiling, status, state_json, created_at, updated_at
        FROM studies_legacy;
      DROP TABLE studies_legacy;
      CREATE INDEX IF NOT EXISTS idx_studies_project ON studies(project_id, created_at DESC);
    `);
  }
}

// An 'advancing' claim is process-local (it marks one in-flight HTTP request
// inside one server process), so any row still claimed at boot was stranded
// by a crash mid-advance. Settle it back to paused; the Mastra snapshot
// still holds the suspended run.
db.prepare("UPDATE studies SET status = 'awaiting-decision' WHERE status = 'advancing'").run();
