import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import type { ConversationAnalysis, ConversationMessage } from './types.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const MAX_MESSAGES = 50;

export async function analyzeConversation(
  projectPath: string,
  startTime: string,
  endTime: string,
): Promise<ConversationAnalysis | undefined> {
  const config = loadConfig();
  if (!config.anthropicApiKey) {
    logger.debug('No Anthropic API key configured');
    return undefined;
  }

  const messages = findConversationMessages(projectPath, startTime, endTime);
  if (messages.length === 0) {
    logger.debug('No conversation messages found for this session');
    return undefined;
  }

  logger.debug(`Found ${messages.length} conversation messages, analyzing...`);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Analyze this Claude Code conversation and provide a structured summary. The conversation is between a developer (user) and Claude (assistant).

<conversation>
${conversationText}
</conversation>

Respond with JSON only (no markdown code fences):
{
  "summary": "1-2 sentence summary of what was worked on",
  "suggestedFeatures": ["2-4 short feature/task descriptions based on the work done"],
  "filesDiscussed": ["list of file paths mentioned"],
  "complexity": "low|medium|high"
}`,
      },
    ],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const analysis = JSON.parse(text) as ConversationAnalysis;
    return analysis;
  } catch (err) {
    logger.debug(`Failed to parse conversation analysis: ${err}`);
    return undefined;
  }
}

function findConversationMessages(
  projectPath: string,
  startTime: string,
  endTime: string,
): ConversationMessage[] {
  // Claude stores conversations in ~/.claude/projects/{encoded-path}/
  const encodedPath = projectPath.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = join(CLAUDE_PROJECTS_DIR, encodedPath);

  if (!existsSync(projectDir)) {
    // Try alternate encoding
    const altEncoded = encodeProjectPath(projectPath);
    const altDir = join(CLAUDE_PROJECTS_DIR, altEncoded);
    if (!existsSync(altDir)) {
      logger.debug(`No conversation directory found at ${projectDir} or ${altDir}`);
      return [];
    }
    return readConversationsFromDir(altDir, startTime, endTime);
  }

  return readConversationsFromDir(projectDir, startTime, endTime);
}

function encodeProjectPath(path: string): string {
  // Claude Code encodes project paths by replacing / with -
  return path.replace(/^\//, '').replace(/\//g, '-');
}

function readConversationsFromDir(
  dir: string,
  startTime: string,
  endTime: string,
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);

            // Check timestamp if available
            if (entry.timestamp) {
              const entryMs = new Date(entry.timestamp).getTime();
              if (entryMs < startMs || entryMs > endMs) continue;
            }

            if (entry.type === 'human' || entry.role === 'user') {
              const text = extractText(entry);
              if (text) {
                messages.push({
                  role: 'user',
                  content: text,
                  timestamp: entry.timestamp,
                });
              }
            } else if (entry.type === 'assistant' || entry.role === 'assistant') {
              const text = extractText(entry);
              if (text) {
                messages.push({
                  role: 'assistant',
                  content: text,
                  timestamp: entry.timestamp,
                });
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    logger.debug(`Failed to read conversations from ${dir}`);
  }

  // Take last N messages
  return messages.slice(-MAX_MESSAGES);
}

function extractText(entry: Record<string, unknown>): string {
  // Handle different message formats
  if (typeof entry.content === 'string') {
    return entry.content.slice(0, 2000);
  }

  if (Array.isArray(entry.content)) {
    const textParts = entry.content
      .filter((part: Record<string, unknown>) => part.type === 'text')
      .map((part: Record<string, unknown>) => part.text as string);
    return textParts.join('\n').slice(0, 2000);
  }

  if (typeof entry.message === 'string') {
    return entry.message.slice(0, 2000);
  }

  return '';
}
