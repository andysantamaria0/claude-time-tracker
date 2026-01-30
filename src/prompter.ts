import inquirer from 'inquirer';
import chalk from 'chalk';
import { formatDuration, box } from './utils/formatting.js';
import { logger } from './utils/logger.js';
import type { GitContext, FeatureSuggestion, ConversationAnalysis } from './types.js';

export interface PromptResult {
  feature: string;
}

export interface PromptContext {
  projectName: string;
  branch: string;
  durationMs: number;
  startTime: string;
  gitContext: GitContext;
  conversationAnalysis?: ConversationAnalysis;
  suggestions?: FeatureSuggestion[];
  defaultNote?: string;
}

export async function promptForFeature(ctx: PromptContext): Promise<PromptResult> {
  console.log('');

  // Show session summary
  const summaryContent = [
    `${chalk.dim('Project:')}  ${chalk.white(ctx.projectName)}`,
    `${chalk.dim('Branch:')}   ${chalk.white(ctx.branch)}`,
    `${chalk.dim('Duration:')} ${chalk.white(formatDuration(ctx.durationMs))}`,
    `${chalk.dim('Started:')}  ${chalk.white(new Date(ctx.startTime).toLocaleTimeString())}`,
  ].join('\n');

  console.log(box(summaryContent, 'Session Complete'));
  console.log('');

  // Show conversation summary if available
  if (ctx.conversationAnalysis?.summary) {
    console.log(chalk.cyan.bold('Conversation Summary:'));
    console.log(chalk.dim('  ' + ctx.conversationAnalysis.summary));
    console.log('');
  }

  // Build feature choices from all sources
  const choices = buildFeatureChoices(ctx);

  if (choices.length === 0) {
    // No suggestions, just ask for input (pre-fill with defaultNote if available)
    const { feature } = await inquirer.prompt<{ feature: string }>([
      {
        type: 'input',
        name: 'feature',
        message: 'What did you work on?',
        default: ctx.defaultNote || undefined,
        validate: (input: string) => input.trim().length > 0 || 'Please describe what you worked on',
      },
    ]);
    return { feature: feature.trim() };
  }

  // Insert defaultNote as the top choice if present
  if (ctx.defaultNote) {
    const noteValue = ctx.defaultNote;
    const lower = noteValue.toLowerCase();
    // Remove duplicate if it already appears in suggestions
    const filtered = choices.filter(c => c.value.toLowerCase() !== lower);
    choices.length = 0;
    choices.push(
      { name: `  ${chalk.cyan('[note]')} ${noteValue}`, value: noteValue },
      ...filtered,
    );
  }

  // Add custom input option
  choices.push({
    name: chalk.dim('  ✏  Type a custom description'),
    value: '__custom__',
  });

  const { selectedFeature } = await inquirer.prompt<{ selectedFeature: string }>([
    {
      type: 'list',
      name: 'selectedFeature',
      message: 'What did you work on?',
      choices,
    },
  ]);

  if (selectedFeature === '__custom__') {
    const { feature } = await inquirer.prompt<{ feature: string }>([
      {
        type: 'input',
        name: 'feature',
        message: 'Describe what you worked on:',
        validate: (input: string) => input.trim().length > 0 || 'Please describe what you worked on',
      },
    ]);
    return { feature: feature.trim() };
  }

  return { feature: selectedFeature };
}

function buildFeatureChoices(ctx: PromptContext): Array<{ name: string; value: string }> {
  const choices: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  // Use pre-ranked suggestions if available
  if (ctx.suggestions && ctx.suggestions.length > 0) {
    for (const suggestion of ctx.suggestions) {
      const lower = suggestion.text.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      const sourceTag = getSourceTag(suggestion.source);
      choices.push({
        name: `  ${sourceTag} ${suggestion.text}`,
        value: suggestion.text,
      });
    }
    return choices;
  }

  // Fall back to building from git context directly
  const { gitContext } = ctx;

  // PR titles (highest priority)
  const currentPR = gitContext.openPRs.find(pr => pr.branch === gitContext.branch);
  if (currentPR) {
    const text = currentPR.title;
    if (!seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      choices.push({
        name: `  ${chalk.magenta('[PR]')} ${text}`,
        value: text,
      });
    }
  }

  // Recent commit messages
  for (const commit of gitContext.recentCommits.slice(0, 3)) {
    const text = commit.message;
    if (!seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      choices.push({
        name: `  ${chalk.yellow('[commit]')} ${text}`,
        value: text,
      });
    }
  }

  // Branch name as suggestion
  if (gitContext.branch && gitContext.branch !== 'main' && gitContext.branch !== 'master') {
    const text = branchToFeature(gitContext.branch);
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      choices.push({
        name: `  ${chalk.blue('[branch]')} ${text}`,
        value: text,
      });
    }
  }

  // Conversation analysis suggestions
  if (ctx.conversationAnalysis?.suggestedFeatures) {
    for (const feat of ctx.conversationAnalysis.suggestedFeatures) {
      if (!seen.has(feat.toLowerCase())) {
        seen.add(feat.toLowerCase());
        choices.push({
          name: `  ${chalk.green('[AI]')} ${feat}`,
          value: feat,
        });
      }
    }
  }

  return choices;
}

function getSourceTag(source: string): string {
  switch (source) {
    case 'pr':
      return chalk.magenta('[PR]');
    case 'commit':
      return chalk.yellow('[commit]');
    case 'branch':
      return chalk.blue('[branch]');
    case 'conversation':
      return chalk.green('[AI]');
    default:
      return chalk.dim(`[${source}]`);
  }
}

function branchToFeature(branch: string): string {
  // Convert branch-name-like-this to "Branch name like this"
  const cleaned = branch
    .replace(/^(feature|feat|fix|bugfix|hotfix|chore|refactor)\//i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 3) return '';

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
