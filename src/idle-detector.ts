import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isClaudeRunning } from './process-manager.js';
import { logger } from './utils/logger.js';

export interface IdleDetectorOptions {
  timeoutMs: number;
  pollIntervalMs: number;
  projectPath: string;
  onIdle: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastActivityTime = Date.now();

export function startIdleDetection(options: IdleDetectorOptions): void {
  lastActivityTime = Date.now();

  pollTimer = setInterval(() => {
    if (!isClaudeRunning()) {
      stopIdleDetection();
      return;
    }

    if (hasProjectActivity(options.projectPath)) {
      recordActivity();
    }

    const idleMs = Date.now() - lastActivityTime;
    if (idleMs >= options.timeoutMs) {
      logger.debug(`Idle timeout reached (${Math.round(idleMs / 1000)}s)`);
      options.onIdle();
    }
  }, options.pollIntervalMs);

  logger.debug(
    `Idle detection started (timeout: ${options.timeoutMs / 1000}s, poll: ${options.pollIntervalMs / 1000}s)`,
  );
}

export function stopIdleDetection(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.debug('Idle detection stopped');
  }
}

export function recordActivity(): void {
  lastActivityTime = Date.now();
}

function hasProjectActivity(projectPath: string): boolean {
  try {
    const now = Date.now();
    const recentThreshold = 60_000; // 1 minute
    const entries = readdirSync(projectPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      try {
        const stat = statSync(join(projectPath, entry.name));
        if (now - stat.mtimeMs < recentThreshold) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}
