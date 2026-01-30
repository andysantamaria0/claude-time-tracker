import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, ensureConfigDir } from './config.js';

interface ActiveSessionEntry {
  sessionId: string;
  pid: number;
  note: string | null;
}

type ActiveSessionRegistry = Record<string, ActiveSessionEntry>;

const STORE_FILE = join(getConfigDir(), 'active-sessions.json');

function readStore(): ActiveSessionRegistry {
  if (!existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STORE_FILE, 'utf-8')) as ActiveSessionRegistry;
  } catch {
    return {};
  }
}

function writeStore(store: ActiveSessionRegistry): void {
  ensureConfigDir();
  const tmp = STORE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, STORE_FILE);
}

export function registerSession(projectPath: string, sessionId: string, pid: number): void {
  const store = readStore();
  store[projectPath] = { sessionId, pid, note: null };
  writeStore(store);
}

export function unregisterSession(projectPath: string): void {
  const store = readStore();
  delete store[projectPath];
  writeStore(store);
}

export function setNote(projectPath: string, note: string): void {
  const store = readStore();
  const entry = store[projectPath];
  if (!entry) {
    throw new Error(`No active session for ${projectPath}`);
  }
  entry.note = note;
  writeStore(store);
}

export function getNote(projectPath: string): string | null {
  const store = readStore();
  return store[projectPath]?.note ?? null;
}

export function getActiveSession(projectPath: string): ActiveSessionEntry | null {
  const store = readStore();
  return store[projectPath] ?? null;
}
