import Database from 'better-sqlite3';
import { join } from 'node:path';
import { getConfigDir, ensureConfigDir } from '../config.js';
import { logger } from '../utils/logger.js';
import type { Session } from '../types.js';

const DB_PATH = join(getConfigDir(), 'sessions.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    ensureConfigDir();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      feature TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      end_reason TEXT NOT NULL DEFAULT 'exit',
      commits TEXT NOT NULL DEFAULT '[]',
      changed_files TEXT NOT NULL DEFAULT '[]',
      pr_url TEXT,
      conversation_summary TEXT,
      airtable_synced INTEGER NOT NULL DEFAULT 0,
      airtable_record_id TEXT,
      email_sent INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_sessions_synced ON sessions(airtable_synced);
  `);
}

function sessionFromRow(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    projectPath: row.project_path as string,
    projectName: row.project_name as string,
    branch: row.branch as string,
    feature: row.feature as string,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    durationMs: row.duration_ms as number,
    endReason: row.end_reason as Session['endReason'],
    commits: JSON.parse(row.commits as string),
    changedFiles: JSON.parse(row.changed_files as string),
    prUrl: row.pr_url as string | undefined,
    conversationSummary: row.conversation_summary as string | undefined,
    airtableSynced: (row.airtable_synced as number) === 1,
    airtableRecordId: row.airtable_record_id as string | undefined,
    emailSent: (row.email_sent as number) === 1,
  };
}

export function saveSession(session: Session): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, project_path, project_name, branch, feature,
      start_time, end_time, duration_ms, end_reason,
      commits, changed_files, pr_url, conversation_summary,
      airtable_synced, airtable_record_id, email_sent
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    session.id,
    session.projectPath,
    session.projectName,
    session.branch,
    session.feature,
    session.startTime,
    session.endTime,
    session.durationMs,
    session.endReason,
    JSON.stringify(session.commits),
    JSON.stringify(session.changedFiles),
    session.prUrl || null,
    session.conversationSummary || null,
    session.airtableSynced ? 1 : 0,
    session.airtableRecordId || null,
    session.emailSent ? 1 : 0,
  );

  logger.debug(`Session ${session.id} saved to SQLite`);
}

export function getSession(id: string): Session | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? sessionFromRow(row) : null;
}

export function getSessionsByProject(projectPath: string): Session[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM sessions WHERE project_path = ? ORDER BY start_time DESC')
    .all(projectPath) as Record<string, unknown>[];
  return rows.map(sessionFromRow);
}

export function getSessionsByDateRange(startDate: string, endDate: string): Session[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM sessions WHERE start_time >= ? AND start_time <= ? ORDER BY start_time DESC')
    .all(startDate, endDate) as Record<string, unknown>[];
  return rows.map(sessionFromRow);
}

export function getUnsyncedSessions(): Session[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM sessions WHERE airtable_synced = 0 ORDER BY start_time ASC')
    .all() as Record<string, unknown>[];
  return rows.map(sessionFromRow);
}

export function markSynced(id: string, airtableRecordId: string): void {
  const database = getDb();
  database
    .prepare('UPDATE sessions SET airtable_synced = 1, airtable_record_id = ? WHERE id = ?')
    .run(airtableRecordId, id);
  logger.debug(`Session ${id} marked as synced`);
}

export function markEmailSent(id: string): void {
  const database = getDb();
  database
    .prepare('UPDATE sessions SET email_sent = 1 WHERE id = ?')
    .run(id);
  logger.debug(`Session ${id} marked as email sent`);
}

export function getAllSessions(): Session[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM sessions ORDER BY start_time DESC')
    .all() as Record<string, unknown>[];
  return rows.map(sessionFromRow);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
