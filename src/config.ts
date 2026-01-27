import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from './utils/logger.js';

export interface TrackerConfig {
  idleTimeoutMinutes: number;
  pollIntervalSeconds: number;
  features: {
    airtableSync: boolean;
    emailReports: boolean;
    conversationAnalysis: boolean;
  };
  airtable?: {
    apiKey: string;
    baseId: string;
    tableId: string;
    tableName: string;
  };
  email?: {
    resendApiKey: string;
    recipientEmail: string;
    fromEmail?: string;
  };
  anthropicApiKey?: string;
}

const CONFIG_DIR = join(homedir(), '.claude-tracker');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: TrackerConfig = {
  idleTimeoutMinutes: 10,
  pollIntervalSeconds: 30,
  features: {
    airtableSync: false,
    emailReports: false,
    conversationAnalysis: false,
  },
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    logger.debug(`Created config directory: ${CONFIG_DIR}`);
  }
}

export function loadConfig(): TrackerConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TrackerConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    logger.warn('Failed to read config, using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: TrackerConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  logger.debug('Config saved');
}

export function updateConfig(updates: Partial<TrackerConfig>): TrackerConfig {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  saveConfig(updated);
  return updated;
}
