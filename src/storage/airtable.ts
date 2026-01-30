import Airtable from 'airtable';
import { loadConfig, updateConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { getUnsyncedSessions, markSynced } from './sqlite.js';
import type { Session } from '../types.js';

function getBase(): Airtable.Base | null {
  const config = loadConfig();
  if (!config.airtable?.apiKey || !config.airtable?.baseId) {
    return null;
  }
  const airtable = new Airtable({ apiKey: config.airtable.apiKey });
  return airtable.base(config.airtable.baseId);
}

function getTableName(): string {
  const config = loadConfig();
  return config.airtable?.tableName || 'Sessions';
}

export async function syncSessionToAirtable(session: Session): Promise<void> {
  const base = getBase();
  if (!base) {
    throw new Error('Airtable not configured');
  }

  const table = base(getTableName());

  const record = await table.create({
    'Session ID': session.id,
    'Project': session.projectName,
    'Project Path': session.projectPath,
    'Branch': session.branch,
    'Feature': session.feature,
    'Start Time': session.startTime,
    'End Time': session.endTime,
    'Duration (min)': Math.round(session.durationMs / 60000),
    'End Reason': session.endReason,
    'Commits': session.commits.join('\n'),
    'Changed Files': session.changedFiles.join('\n'),
    'PR URL': session.prUrl || undefined,
    'Summary': session.conversationSummary || '',
  });

  markSynced(session.id, record.getId());
  logger.debug(`Session synced to Airtable: ${record.getId()}`);
}

export async function retryFailedSyncs(): Promise<{ synced: number; failed: number }> {
  const config = loadConfig();
  if (!config.features.airtableSync || !config.airtable) {
    return { synced: 0, failed: 0 };
  }

  const unsynced = getUnsyncedSessions();
  if (unsynced.length === 0) return { synced: 0, failed: 0 };

  logger.info(`Retrying ${unsynced.length} unsynced session(s)...`);

  let synced = 0;
  let failed = 0;

  for (const session of unsynced) {
    try {
      await syncSessionToAirtable(session);
      synced++;
      logger.success(`Synced session: ${session.feature || session.id}`);
    } catch (err) {
      failed++;
      logger.warn(`Failed to sync session ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { synced, failed };
}

export async function testAirtableConnection(
  apiKey: string,
  baseId: string,
  tableName: string,
): Promise<boolean> {
  try {
    const airtable = new Airtable({ apiKey });
    const base = airtable.base(baseId);
    const table = base(tableName);

    // Try to select (limit 1) to verify the connection
    await table.select({ maxRecords: 1 }).firstPage();
    return true;
  } catch (err) {
    logger.debug(`Airtable connection test failed: ${err}`);
    return false;
  }
}

export async function createAirtableTable(
  apiKey: string,
  baseId: string,
  tableName: string,
): Promise<boolean> {
  // Airtable API for table creation via REST
  try {
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: tableName,
        fields: [
          { name: 'Session ID', type: 'singleLineText' },
          { name: 'Project', type: 'singleLineText' },
          { name: 'Project Path', type: 'singleLineText' },
          { name: 'Branch', type: 'singleLineText' },
          { name: 'Feature', type: 'singleLineText' },
          { name: 'Start Time', type: 'dateTime', options: { timeZone: 'client', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
          { name: 'End Time', type: 'dateTime', options: { timeZone: 'client', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
          { name: 'Duration (min)', type: 'number', options: { precision: 0 } },
          { name: 'End Reason', type: 'singleLineText' },
          { name: 'Commits', type: 'multilineText' },
          { name: 'Changed Files', type: 'multilineText' },
          { name: 'PR URL', type: 'url' },
          { name: 'Summary', type: 'multilineText' },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.debug(`Failed to create Airtable table: ${response.status} ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    logger.debug(`Failed to create Airtable table: ${err}`);
    return false;
  }
}
