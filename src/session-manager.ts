import { v4 as uuidv4 } from 'uuid';
import { basename } from 'node:path';
import { logger } from './utils/logger.js';
import { formatDuration } from './utils/formatting.js';
import { getGitContext, isGitRepo } from './git-context.js';
import { launchClaude, isClaudeRunning, stopClaude } from './process-manager.js';
import { startIdleDetection, stopIdleDetection } from './idle-detector.js';
import { promptForFeature, type PromptContext } from './prompter.js';
import { saveSession } from './storage/sqlite.js';
import { loadConfig } from './config.js';
import { analyzeConversation } from './conversation-analyzer.js';
import { buildSuggestions } from './feature-suggester.js';
import { syncSessionToAirtable, retryFailedSyncs } from './storage/airtable.js';
import { sendSessionReport } from './email/resend.js';
import { registerSession, unregisterSession, getNote } from './active-session-store.js';
import type { Session, GitContext, ConversationAnalysis } from './types.js';

let currentSession: {
  id: string;
  projectPath: string;
  projectName: string;
  startTime: Date;
  branch: string;
} | null = null;

let isEnding = false;

export function getCurrentSession() {
  return currentSession;
}

export async function startSession(projectPath: string, claudeArgs: string[]): Promise<void> {
  const config = loadConfig();
  const projectName = basename(projectPath);
  const branch = isGitRepo(projectPath) ? (await import('./git-context.js')).getBranch(projectPath) : 'N/A';

  currentSession = {
    id: uuidv4(),
    projectPath,
    projectName,
    startTime: new Date(),
    branch,
  };

  registerSession(projectPath, currentSession.id, process.pid);

  logger.success(`Session started: ${projectName} (${branch})`);
  logger.dim(`Session ID: ${currentSession.id}`);

  // Retry any failed Airtable syncs
  if (config.features.airtableSync) {
    retryFailedSyncs().catch(err => {
      logger.debug(`Failed to retry Airtable syncs: ${err}`);
    });
  }

  // Start idle detection
  startIdleDetection({
    timeoutMs: config.idleTimeoutMinutes * 60 * 1000,
    pollIntervalMs: config.pollIntervalSeconds * 1000,
    projectPath,
    onIdle: () => handleIdleTimeout(),
  });

  // Launch Claude Code
  launchClaude(claudeArgs, {
    onExit: (code) => {
      endSession('exit').catch(err => {
        logger.error(`Failed to end session: ${err}`);
      });
    },
  });
}

async function handleIdleTimeout(): Promise<void> {
  logger.warn('Session appears idle');
  await endSession('idle');
}

export async function endSession(reason: Session['endReason']): Promise<void> {
  if (!currentSession || isEnding) {
    if (!isEnding) logger.warn('No active session to end');
    return;
  }

  isEnding = true;
  stopIdleDetection();

  // Kill Claude if still running so it releases stdin before we prompt
  if (isClaudeRunning()) {
    logger.debug('Stopping Claude Code before prompting...');
    await stopClaude();
  }

  const endTime = new Date();
  const durationMs = endTime.getTime() - currentSession.startTime.getTime();

  logger.info(`Session ending (${reason}): ${formatDuration(durationMs)}`);

  // Gather git context
  let gitContext: GitContext = {
    branch: currentSession.branch,
    recentCommits: [],
    openPRs: [],
    changedFiles: [],
  };

  if (isGitRepo(currentSession.projectPath)) {
    gitContext = getGitContext(
      currentSession.projectPath,
      currentSession.startTime.toISOString(),
    );
  }

  // Analyze conversation if enabled
  const config = loadConfig();
  let conversationAnalysis: ConversationAnalysis | undefined;

  if (config.features.conversationAnalysis && config.anthropicApiKey) {
    try {
      conversationAnalysis = await analyzeConversation(
        currentSession.projectPath,
        currentSession.startTime.toISOString(),
        endTime.toISOString(),
      );
    } catch (err) {
      logger.debug(`Conversation analysis failed: ${err}`);
    }
  }

  // Build feature suggestions
  const suggestions = buildSuggestions(gitContext, conversationAnalysis);

  // Check for a mid-session note
  const note = getNote(currentSession.projectPath);

  let feature: string;

  if (reason === 'idle' && note) {
    // Idle with a note: use it directly, skip the prompt
    logger.info(`Using note as feature: "${note}"`);
    feature = note;
  } else {
    // Prompt user (pass note as default if it exists)
    const promptCtx: PromptContext = {
      projectName: currentSession.projectName,
      branch: gitContext.branch,
      durationMs,
      startTime: currentSession.startTime.toISOString(),
      gitContext,
      conversationAnalysis,
      suggestions,
      defaultNote: note ?? undefined,
    };

    ({ feature } = await promptForFeature(promptCtx));
  }

  // Find current PR URL
  const currentPR = gitContext.openPRs.find(pr => pr.branch === gitContext.branch);

  // Build session object
  const session: Session = {
    id: currentSession.id,
    projectPath: currentSession.projectPath,
    projectName: currentSession.projectName,
    branch: gitContext.branch,
    feature,
    startTime: currentSession.startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs,
    endReason: reason,
    commits: gitContext.recentCommits.map(c => c.message),
    changedFiles: gitContext.changedFiles,
    prUrl: currentPR?.url,
    conversationSummary: conversationAnalysis?.summary,
    airtableSynced: false,
    emailSent: false,
  };

  // Save to SQLite
  saveSession(session);
  logger.success('Session saved to local database');

  // Sync to Airtable if enabled
  if (config.features.airtableSync && config.airtable) {
    try {
      await syncSessionToAirtable(session);
      logger.success('Session synced to Airtable');
    } catch (err) {
      logger.warn(`Airtable sync failed (will retry later): ${err}`);
    }
  }

  // Send email if per-session emails enabled
  if (config.features.emailReports && config.features.perSessionEmails && config.email) {
    try {
      await sendSessionReport(session);
      logger.success('Session report emailed');
    } catch (err) {
      logger.warn(`Email send failed: ${err}`);
    }
  }

  unregisterSession(currentSession.projectPath);
  currentSession = null;
  isEnding = false;
}

export async function stopSession(): Promise<void> {
  if (!currentSession) {
    logger.warn('No active session');
    return;
  }
  await endSession('manual');
}
