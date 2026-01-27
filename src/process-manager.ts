import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from './utils/logger.js';

let claudeProcess: ChildProcess | null = null;

export interface ProcessEvents {
  onExit: (code: number | null) => void;
}

export function launchClaude(args: string[], events: ProcessEvents): ChildProcess {
  logger.info('Launching Claude Code...');

  const child = spawn('claude', args, {
    stdio: 'inherit',
    shell: true,
  });

  claudeProcess = child;

  child.on('exit', (code) => {
    logger.debug(`Claude Code exited with code ${code}`);
    claudeProcess = null;
    events.onExit(code);
  });

  child.on('error', (err) => {
    logger.error(`Failed to launch Claude Code: ${err.message}`);
    claudeProcess = null;
    events.onExit(1);
  });

  return child;
}

export function isClaudeRunning(): boolean {
  return claudeProcess !== null && claudeProcess.exitCode === null;
}

export function stopClaude(): Promise<void> {
  return new Promise((resolve) => {
    if (!claudeProcess || claudeProcess.exitCode !== null) {
      resolve();
      return;
    }

    const child = claudeProcess;
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

export function getClaudeProcess(): ChildProcess | null {
  return claudeProcess;
}
