import { execSync } from 'node:child_process';
import { logger } from './utils/logger.js';
import type { GitContext, CommitInfo, PRInfo } from './types.js';

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

export function getBranch(cwd: string): string {
  return exec('git rev-parse --abbrev-ref HEAD', cwd) || 'unknown';
}

export function getRecentCommits(cwd: string, since?: string): CommitInfo[] {
  const sinceArg = since ? `--since="${since}"` : '--max-count=10';
  const raw = exec(
    `git log ${sinceArg} --format="%H|%s|%aI" --no-merges`,
    cwd,
  );
  if (!raw) return [];

  return raw.split('\n').filter(Boolean).map(line => {
    const [hash, message, timestamp] = line.split('|');
    return { hash, message, timestamp };
  });
}

export function getOpenPRs(cwd: string): PRInfo[] {
  try {
    const raw = exec(
      'gh pr list --json number,title,url,headRefName --limit 5',
      cwd,
    );
    if (!raw) return [];
    const prs = JSON.parse(raw) as Array<{
      number: number;
      title: string;
      url: string;
      headRefName: string;
    }>;
    return prs.map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      branch: pr.headRefName,
    }));
  } catch {
    logger.debug('gh CLI not available or not in a repo with PRs');
    return [];
  }
}

export function getChangedFiles(cwd: string): string[] {
  const staged = exec('git diff --cached --name-only', cwd);
  const modified = exec('git diff --name-only', cwd);
  const untracked = exec('git ls-files --others --exclude-standard', cwd);

  const files = new Set<string>();
  for (const output of [staged, modified, untracked]) {
    if (output) {
      output.split('\n').filter(Boolean).forEach(f => files.add(f));
    }
  }
  return [...files];
}

export function getGitContext(cwd: string, since?: string): GitContext {
  return {
    branch: getBranch(cwd),
    recentCommits: getRecentCommits(cwd, since),
    openPRs: getOpenPRs(cwd),
    changedFiles: getChangedFiles(cwd),
  };
}

export function isGitRepo(cwd: string): boolean {
  return exec('git rev-parse --is-inside-work-tree', cwd) === 'true';
}
