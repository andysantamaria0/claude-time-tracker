import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from './utils/logger.js';
import { formatDuration, formatDurationShort, formatDateTime, table } from './utils/formatting.js';
import { startSession, stopSession, getCurrentSession } from './session-manager.js';
import { getSessionsByDateRange, getAllSessions } from './storage/sqlite.js';
import { retryFailedSyncs } from './storage/airtable.js';
import { sendReportEmail } from './email/resend.js';
import { buildReportHtml } from './email/template.js';
import { runInit } from './init.js';
import { loadConfig } from './config.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('claude-tracker')
    .description('Track your Claude Code sessions')
    .version('1.0.0');

  // start command
  program
    .command('start')
    .description('Start tracking a Claude Code session')
    .argument('[claude-args...]', 'Arguments to pass to Claude Code')
    .action(async (claudeArgs: string[]) => {
      const cwd = process.cwd();
      try {
        await startSession(cwd, claudeArgs);
      } catch (err) {
        logger.error(`Failed to start session: ${err}`);
        process.exit(1);
      }
    });

  // stop command
  program
    .command('stop')
    .description('Manually end the current session')
    .action(async () => {
      await stopSession();
    });

  // status command
  program
    .command('status')
    .description('Show current session info')
    .action(() => {
      const session = getCurrentSession();
      if (!session) {
        logger.info('No active session');
        return;
      }

      const elapsed = Date.now() - session.startTime.getTime();
      logger.heading('Active Session');
      logger.keyValue('Project', session.projectName);
      logger.keyValue('Branch', session.branch);
      logger.keyValue('Started', session.startTime.toLocaleTimeString());
      logger.keyValue('Elapsed', formatDuration(elapsed));
      logger.keyValue('Session ID', session.id);
    });

  // init command
  program
    .command('init')
    .description('Configure integrations (Airtable, email, Claude API)')
    .action(async () => {
      await runInit();
    });

  // sync command
  program
    .command('sync')
    .description('Retry failed Airtable syncs')
    .action(async () => {
      const config = loadConfig();
      if (!config.features.airtableSync) {
        logger.warn('Airtable sync is not enabled. Run `claude-tracker init` first.');
        return;
      }
      await retryFailedSyncs();
      logger.success('Sync complete');
    });

  // report command
  program
    .command('report')
    .description('Generate a session report')
    .option('-d, --day', 'Report for today')
    .option('-w, --week', 'Report for this week')
    .option('-m, --month', 'Report for this month')
    .option('--email', 'Email the report')
    .action(async (options: { day?: boolean; week?: boolean; month?: boolean; email?: boolean }) => {
      const now = new Date();
      let startDate: Date;
      let periodLabel: string;

      if (options.month) {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        periodLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      } else if (options.week) {
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        periodLabel = `Week of ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      } else {
        // Default to today
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        periodLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }

      const sessions = getSessionsByDateRange(
        startDate.toISOString(),
        now.toISOString(),
      );

      if (sessions.length === 0) {
        logger.info('No sessions found for this period');
        return;
      }

      // Terminal output
      const totalMs = sessions.reduce((sum, s) => sum + s.durationMs, 0);

      logger.heading(`Report: ${periodLabel}`);
      console.log(chalk.dim(`  ${sessions.length} sessions | ${formatDuration(totalMs)} total\n`));

      const rows = sessions.map(s => [
        s.projectName,
        s.feature || chalk.dim('—'),
        formatDurationShort(s.durationMs),
        s.branch,
        formatDateTime(s.startTime),
      ]);

      console.log(table(
        ['Project', 'Feature', 'Duration', 'Branch', 'Started'],
        rows,
      ));
      console.log('');

      // Email if requested
      if (options.email) {
        const config = loadConfig();
        if (!config.features.emailReports || !config.email) {
          logger.warn('Email not configured. Run `claude-tracker init` first.');
          return;
        }

        try {
          const title = `Claude Tracker Report: ${periodLabel}`;
          const html = buildReportHtml(title, sessions, periodLabel);
          await sendReportEmail(title, html);
          logger.success('Report emailed');
        } catch (err) {
          logger.error(`Failed to email report: ${err}`);
        }
      }
    });

  // history command
  program
    .command('history')
    .description('Show recent sessions')
    .option('-n, --limit <number>', 'Number of sessions to show', '10')
    .action((options: { limit: string }) => {
      const limit = parseInt(options.limit, 10);
      const sessions = getAllSessions().slice(0, limit);

      if (sessions.length === 0) {
        logger.info('No sessions recorded yet');
        return;
      }

      logger.heading('Recent Sessions');
      console.log('');

      const rows = sessions.map(s => [
        s.projectName,
        s.feature || chalk.dim('—'),
        formatDurationShort(s.durationMs),
        s.branch,
        formatDateTime(s.startTime),
        s.airtableSynced ? chalk.green('synced') : chalk.dim('local'),
      ]);

      console.log(table(
        ['Project', 'Feature', 'Duration', 'Branch', 'Started', 'Airtable'],
        rows,
      ));
      console.log('');
    });

  return program;
}
