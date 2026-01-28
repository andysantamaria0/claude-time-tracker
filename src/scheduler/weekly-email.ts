import { getSessionsByDateRange } from '../storage/sqlite.js';
import { sendReportEmail } from '../email/resend.js';
import { buildReportHtml } from '../email/template.js';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Get the date range for the previous week (Sunday to Saturday)
 */
export function getLastWeekDateRange(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday

  // End of last week (last Saturday at 23:59:59)
  const end = new Date(now);
  end.setDate(now.getDate() - dayOfWeek - 1); // Go to last Saturday
  end.setHours(23, 59, 59, 999);

  // Start of last week (Sunday at 00:00:00)
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const label = `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return { start, end, label };
}

/**
 * Send the weekly summary email
 */
export async function sendWeeklySummary(): Promise<void> {
  const config = loadConfig();

  if (!config.features.emailReports || !config.email) {
    throw new Error('Email not configured. Run `claude-tracker init` first.');
  }

  const { start, end, label } = getLastWeekDateRange();

  const sessions = getSessionsByDateRange(
    start.toISOString(),
    end.toISOString(),
  );

  if (sessions.length === 0) {
    logger.info('No sessions found for last week, skipping email');
    return;
  }

  const title = `Weekly Summary: ${label}`;
  const html = buildReportHtml(title, sessions, label);

  await sendReportEmail(title, html);
  logger.success(`Weekly summary sent: ${sessions.length} sessions`);
}
