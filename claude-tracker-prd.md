# Claude Code Time Tracker - Product Requirements Document

## Overview

A CLI tool that automatically tracks time spent in Claude Code sessions, logs sessions to Airtable, and sends email reports via Gmail. The tool intelligently suggests what feature/task was worked on by analyzing Claude Code conversation history and git activity.

---

## Problem Statement

Developers using Claude Code lack visibility into:
- How much time they spend on different projects
- How long specific features take to complete
- A historical log of their AI-assisted development work

This tool provides automatic time tracking with minimal friction, plus reporting and analytics.

---

## User Stories

1. **As a developer**, I want my Claude Code sessions automatically tracked so I don't have to remember to start/stop timers
2. **As a developer**, I want the tool to suggest what I worked on based on my conversation and git activity so I spend minimal time on categorization
3. **As a developer**, I want to receive an email summary after each session so I have a record without checking a dashboard
4. **As a developer**, I want to handle project switches mid-session so my tracking stays accurate
5. **As a developer**, I want all my sessions logged to Airtable so I can analyze trends over time

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         claude-tracker CLI                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐                                                    │
│  │  claude-tracker  │                                                    │
│  │      start       │                                                    │
│  └────────┬─────────┘                                                    │
│           │                                                              │
│           ▼                                                              │
│  ┌──────────────────┐      ┌──────────────────┐      ┌───────────────┐  │
│  │  Session Manager │─────▶│  Idle Detector   │─────▶│ Project Watch │  │
│  │                  │      │  (10 min timeout)│      │ (cwd changes) │  │
│  └────────┬─────────┘      └──────────────────┘      └───────────────┘  │
│           │                                                              │
│           │ On session end (exit/idle/manual/project-switch)            │
│           ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Session End Handler                            │   │
│  │                                                                   │   │
│  │  1. Read Claude Code conversation from ~/.claude/projects/        │   │
│  │  2. Get git context (branch, recent commits, PRs via gh cli)     │   │
│  │  3. Generate feature suggestions using Claude API                 │   │
│  │  4. Prompt user: "What did you work on?" with suggestions        │   │
│  │  5. Save session                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                     │
│         ▼                    ▼                    ▼                     │
│  ┌─────────────┐      ┌─────────────┐      ┌──────────┐                │
│  │   SQLite    │      │  Airtable   │      │  Gmail   │                │
│  │  (local db) │─────▶│   Sync      │      │  Report  │                │
│  └─────────────┘      └─────────────┘      └──────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. CLI Entry Point (`src/cli.ts`)

Commands:
- `claude-tracker start` - Start tracking and launch Claude Code
- `claude-tracker stop` - Manually end current session
- `claude-tracker status` - Show current session info
- `claude-tracker report [--day|--week|--month]` - Generate local reports
- `claude-tracker init` - One-time setup (Gmail OAuth, Airtable API key)
- `claude-tracker config` - View/edit configuration

#### 2. Session Manager (`src/session-manager.ts`)

Responsibilities:
- Start/stop session tracking
- Record start time, project path, git branch
- Monitor for session end conditions
- Handle project directory changes mid-session

State tracked:
```typescript
interface Session {
  id: string;                    // UUID
  projectPath: string;           // e.g., /Users/andy/code/my-app
  projectName: string;           // e.g., my-app (folder name)
  gitBranch: string | null;      // e.g., feature/oauth
  startTime: Date;
  endTime: Date | null;
  endReason: 'exit' | 'idle' | 'manual' | 'project-switch';
  feature: string | null;        // User-provided or selected
  prLink: string | null;         // Associated PR if any
  conversationSummary: string;   // Brief summary for email
  durationMinutes: number;
}
```

#### 3. Idle Detector (`src/idle-detector.ts`)

Monitors for user inactivity:
- Checks for Claude Code process activity
- Uses file system watchers on project directory
- Configurable timeout (default: 10 minutes)
- Detects terminal focus loss (if possible)

Implementation approach:
```typescript
class IdleDetector {
  private lastActivityTime: Date;
  private timeoutMs: number = 10 * 60 * 1000; // 10 minutes
  
  // Poll every 30 seconds
  // Check: 
  //   1. Claude process still running?
  //   2. Any file changes in project dir?
  //   3. Any new lines in Claude conversation JSONL?
  
  onIdle(callback: () => void): void;
  recordActivity(): void;
}
```

#### 4. Project Watcher (`src/project-watcher.ts`)

Monitors for directory changes:
- Watches for `cd` commands that change project context
- Detects when Claude Code restarts in different directory
- Triggers session boundary when project changes

Implementation:
- Poll `process.cwd()` periodically
- Watch for changes to the Claude Code conversation file path
- On project change: end current session, prompt for feature, start new session

#### 5. Conversation Analyzer (`src/conversation-analyzer.ts`)

Reads and analyzes Claude Code conversation history:

```typescript
interface ConversationAnalysis {
  summary: string;              // 2-3 sentence summary
  suggestedFeatures: string[];  // Based on conversation content
  filesModified: string[];      // Files discussed/edited
  estimatedComplexity: 'small' | 'medium' | 'large';
}

class ConversationAnalyzer {
  // Find the conversation file for current session
  getConversationPath(projectPath: string): string {
    // Convert /Users/andy/myproject to -Users-andy-myproject
    const encoded = projectPath.replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', encoded);
  }
  
  // Parse JSONL and extract messages
  parseConversation(jsonlPath: string): Message[];
  
  // Use Claude API to summarize and suggest features
  async analyzeConversation(messages: Message[]): Promise<ConversationAnalysis>;
}
```

#### 6. Git Context Provider (`src/git-context.ts`)

Gathers git information for feature suggestions:

```typescript
interface GitContext {
  branch: string | null;
  recentCommits: Commit[];      // Last 5 commits in session timeframe
  openPRs: PullRequest[];       // From gh cli
  stagedChanges: string[];      // Files staged
  modifiedFiles: string[];      // Uncommitted changes
}

class GitContextProvider {
  async getBranch(): Promise<string | null>;
  async getRecentCommits(since: Date): Promise<Commit[]>;
  async getOpenPRs(): Promise<PullRequest[]>;  // Requires gh cli
  async getChangedFiles(): Promise<string[]>;
}
```

#### 7. Feature Suggester (`src/feature-suggester.ts`)

Combines conversation + git context to suggest features:

```typescript
class FeatureSuggester {
  async generateSuggestions(
    conversation: ConversationAnalysis,
    git: GitContext
  ): Promise<FeatureSuggestion[]>;
}

interface FeatureSuggestion {
  title: string;           // e.g., "Add user authentication"
  confidence: number;      // 0-1 score
  source: 'pr' | 'branch' | 'commit' | 'conversation';
  prLink?: string;
}
```

Suggestion priority:
1. Open PR title + link (highest confidence)
2. Recent commit messages
3. Git branch name (parsed from feature/xxx, fix/xxx, etc.)
4. Claude conversation analysis

#### 8. Session End Prompter (`src/prompter.ts`)

Interactive CLI prompt when session ends:

```typescript
async function promptForFeature(
  session: Partial<Session>,
  suggestions: FeatureSuggestion[],
  conversationSummary: string
): Promise<{feature: string; prLink: string | null}> {
  // Display:
  // ┌─────────────────────────────────────────────────┐
  // │ Session ended after 47 minutes                  │
  // │ Project: ~/code/my-app                          │
  // │ Branch: feature/oauth-integration               │
  // │                                                 │
  // │ Conversation summary:                           │
  // │ "Implemented OAuth flow, fixed token refresh,   │
  // │  added error handling for expired sessions"     │
  // │                                                 │
  // │ What did you work on?                           │
  // │                                                 │
  // │   [1] Add OAuth integration (PR #42) ←(from PR) │
  // │   [2] Fix token refresh bug         ←(from git) │
  // │   [3] feature/oauth-integration     ←(branch)   │
  // │   [4] Custom description...                     │
  // │                                                 │
  // │ > _                                             │
  // └─────────────────────────────────────────────────┘
}
```

Uses `inquirer` or `prompts` library for interactive selection.

#### 9. Storage Layer (`src/storage/`)

##### Local SQLite (`src/storage/sqlite.ts`)

```typescript
// Schema
interface SessionRecord {
  id: TEXT PRIMARY KEY,
  project_path: TEXT,
  project_name: TEXT,
  git_branch: TEXT,
  start_time: DATETIME,
  end_time: DATETIME,
  end_reason: TEXT,
  feature: TEXT,
  pr_link: TEXT,
  conversation_summary: TEXT,
  duration_minutes: INTEGER,
  synced_to_airtable: BOOLEAN DEFAULT FALSE,
  created_at: DATETIME DEFAULT CURRENT_TIMESTAMP
}

class SQLiteStorage {
  async saveSession(session: Session): Promise<void>;
  async getSession(id: string): Promise<Session | null>;
  async getSessionsByProject(projectName: string): Promise<Session[]>;
  async getSessionsByDateRange(start: Date, end: Date): Promise<Session[]>;
  async markSynced(id: string): Promise<void>;
  async getUnsyncedSessions(): Promise<Session[]>;
}
```

##### Airtable Sync (`src/storage/airtable.ts`)

```typescript
class AirtableSync {
  private baseId: string;
  private tableId: string;
  private apiKey: string;
  
  async syncSession(session: Session): Promise<void>;
  async retryFailedSyncs(): Promise<void>;
}
```

Airtable schema:

| Field Name | Field Type | Description |
|------------|------------|-------------|
| Session ID | Single line text | UUID |
| Date | Date | Session date |
| Project | Single line text | Project/folder name |
| Feature | Single line text | What was worked on |
| Duration (min) | Number | Session length |
| Start Time | Date (with time) | Session start |
| End Time | Date (with time) | Session end |
| End Reason | Single select | exit/idle/manual/project-switch |
| Git Branch | Single line text | Branch name |
| PR Link | URL | Associated pull request |
| Conversation Summary | Long text | Brief summary |

Views to create:
- **All Sessions** - Default grid view
- **By Project** - Grouped by Project field
- **This Week** - Filtered to current week
- **By Feature** - Grouped by Feature field

#### 10. Gmail Reporter (`src/email/gmail.ts`)

OAuth2 integration for sending emails:

```typescript
class GmailReporter {
  private oauth2Client: OAuth2Client;
  
  async authenticate(): Promise<void>;  // One-time setup
  async sendReport(session: Session): Promise<void>;
}
```

Email template:

```
Subject: Claude Session: {project_name} - {duration} min

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Project: {project_name}
🎯 Feature: {feature}
⏱️  Duration: {duration_minutes} minutes
🕐 {start_time} → {end_time}

🔀 Branch: {git_branch}
🔗 PR: {pr_link}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Session Summary:
{conversation_summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 View all sessions: {airtable_link}
```

---

## Configuration

### Config File Location

`~/.claude-tracker/config.json`

```json
{
  "idleTimeoutMinutes": 10,
  "airtable": {
    "apiKey": "pat...",
    "baseId": "app...",
    "tableId": "tbl..."
  },
  "gmail": {
    "credentials": {},
    "recipientEmail": "andy@example.com"
  },
  "features": {
    "sendEmailOnSessionEnd": true,
    "syncToAirtable": true,
    "useClaudeForSuggestions": true
  },
  "anthropicApiKey": "sk-ant-..."
}
```

### Init Wizard

`claude-tracker init` runs an interactive setup:

1. **Airtable Setup**
   - Prompt for API key (link to Airtable API docs)
   - Auto-create base and table with schema, or prompt for existing base ID
   
2. **Gmail OAuth Setup**
   - Open browser for Google OAuth consent
   - Store refresh token locally
   - Prompt for recipient email (default: authenticated email)

3. **Anthropic API Key (optional)**
   - Used for conversation summarization
   - Can skip if user doesn't want AI-powered suggestions

4. **Test Everything**
   - Send test email
   - Create test row in Airtable
   - Confirm all working

---

## User Flows

### Flow 1: Starting a Tracked Session

```
User runs: claude-tracker start

┌─────────────────────────────────────────────────────────┐
│ 🕐 Claude Tracker started                               │
│ 📁 Project: my-app                                      │
│ 🔀 Branch: feature/oauth                                │
│                                                         │
│ Launching Claude Code...                                │
└─────────────────────────────────────────────────────────┘

[Claude Code launches and user works normally]
```

### Flow 2: Session Ends (Exit)

```
User types: exit (or Ctrl+C in Claude Code)

┌─────────────────────────────────────────────────────────┐
│ ⏱️  Session ended after 47 minutes                      │
│ 📁 Project: my-app                                      │
│ 🔀 Branch: feature/oauth-integration                    │
│                                                         │
│ 📝 Conversation summary:                                │
│ "Set up OAuth2 flow with Google, implemented token      │
│  refresh logic, added logout functionality"             │
│                                                         │
│ What did you work on?                                   │
│                                                         │
│ ❯ 1. Add Google OAuth integration (PR #42)              │
│   2. Implement token refresh                            │
│   3. feature/oauth-integration                          │
│   4. Enter custom description...                        │
└─────────────────────────────────────────────────────────┘

User selects: 1

┌─────────────────────────────────────────────────────────┐
│ ✅ Session saved                                        │
│ 📧 Email sent to andy@example.com                       │
│ 📊 Synced to Airtable                                   │
└─────────────────────────────────────────────────────────┘
```

### Flow 3: Session Ends (Idle Timeout)

```
[No activity for 10 minutes]

┌─────────────────────────────────────────────────────────┐
│ ⏸️  No activity detected for 10 minutes                 │
│ 📁 Project: my-app                                      │
│                                                         │
│ End this session?                                       │
│ ❯ Yes, end session                                      │
│   No, I'm still working (reset timer)                   │
│   Extend timeout by 10 minutes                          │
└─────────────────────────────────────────────────────────┘
```

### Flow 4: Project Switch Mid-Session

```
[User cd's to different project while Claude Code is running]

┌─────────────────────────────────────────────────────────┐
│ 📂 Project change detected                              │
│                                                         │
│ Previous: ~/code/my-app (23 min)                        │
│ Current:  ~/code/other-project                          │
│                                                         │
│ ❯ End my-app session and start tracking other-project  │
│   Continue tracking my-app (ignore directory change)    │
│   Pause tracking                                        │
└─────────────────────────────────────────────────────────┘
```

### Flow 5: Manual Stop

```
User runs: claude-tracker stop

[Same feature selection prompt as Flow 2]
```

---

## Technical Implementation Details

### Process Management

The tracker needs to:
1. Launch Claude Code as a child process
2. Stay alive while Claude Code runs
3. Detect when Claude Code exits

```typescript
// src/process-manager.ts
import { spawn } from 'child_process';

class ProcessManager {
  private claudeProcess: ChildProcess | null = null;
  
  async launchClaude(args: string[]): Promise<void> {
    this.claudeProcess = spawn('claude', args, {
      stdio: 'inherit',  // Pass through stdin/stdout/stderr
      detached: false,
    });
    
    this.claudeProcess.on('exit', (code) => {
      this.emit('claude-exit', code);
    });
  }
  
  isClaudeRunning(): boolean {
    return this.claudeProcess !== null && !this.claudeProcess.killed;
  }
}
```

### Claude Conversation Parsing

```typescript
// src/conversation-analyzer.ts
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';

interface ConversationMessage {
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

class ConversationAnalyzer {
  
  getConversationDir(projectPath: string): string {
    // /Users/andy/myproject -> -Users-andy-myproject
    const encoded = projectPath.replace(/^\//,'').replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', encoded);
  }
  
  async getLatestConversation(projectPath: string): Promise<string | null> {
    const dir = this.getConversationDir(projectPath);
    
    if (!fs.existsSync(dir)) return null;
    
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(dir, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return files.length > 0 ? path.join(dir, files[0].name) : null;
  }
  
  async parseConversation(
    jsonlPath: string, 
    since?: Date
  ): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];
    
    const fileStream = fs.createReadStream(jsonlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    for await (const line of rl) {
      try {
        const event = JSON.parse(line);
        const timestamp = new Date(event.timestamp);
        
        // Filter by time if provided
        if (since && timestamp < since) continue;
        
        if (event.type === 'user') {
          messages.push({
            type: 'user',
            content: event.message.content,
            timestamp
          });
        } else if (event.type === 'assistant') {
          // Assistant content can be array of blocks
          const content = event.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
          
          messages.push({
            type: 'assistant',
            content,
            timestamp
          });
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
    
    return messages;
  }
  
  async summarizeWithClaude(
    messages: ConversationMessage[]
  ): Promise<ConversationAnalysis> {
    // Truncate to last N messages to stay within context
    const recentMessages = messages.slice(-50);
    
    const prompt = `Analyze this Claude Code conversation and provide:
1. A 2-3 sentence summary of what was worked on
2. 3-5 suggested feature/task names (short, descriptive)
3. List of key files that were modified or discussed

Conversation:
${recentMessages.map(m => `${m.type}: ${m.content.slice(0, 500)}`).join('\n\n')}

Respond in JSON format:
{
  "summary": "...",
  "suggestedFeatures": ["...", "..."],
  "filesModified": ["...", "..."]
}`;

    // Call Claude API
    const response = await this.callClaudeAPI(prompt);
    return JSON.parse(response);
  }
}
```

### Alias Setup for Auto-Start

During `init`, offer to add alias:

```bash
# Added by claude-tracker
alias claude='claude-tracker start --'
```

This makes `claude` automatically start tracking. The `--` passes remaining args to Claude Code.

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "airtable": "^0.12.0",
    "better-sqlite3": "^11.0.0",
    "chalk": "^5.0.0",
    "commander": "^12.0.0",
    "googleapis": "^140.0.0",
    "inquirer": "^10.0.0",
    "ora": "^8.0.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/inquirer": "^9.0.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## File Structure

```
claude-tracker/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # Entry point
│   ├── cli.ts                      # Commander CLI setup
│   ├── session-manager.ts          # Core session tracking
│   ├── idle-detector.ts            # Inactivity monitoring
│   ├── project-watcher.ts          # Directory change detection
│   ├── process-manager.ts          # Claude Code process handling
│   ├── conversation-analyzer.ts    # Parse ~/.claude/projects/
│   ├── git-context.ts              # Git info gathering
│   ├── feature-suggester.ts        # Combine sources for suggestions
│   ├── prompter.ts                 # Interactive session end prompt
│   ├── config.ts                   # Configuration management
│   ├── storage/
│   │   ├── sqlite.ts               # Local SQLite storage
│   │   └── airtable.ts             # Airtable sync
│   ├── email/
│   │   └── gmail.ts                # Gmail OAuth + sending
│   └── utils/
│       ├── logger.ts               # Logging utilities
│       └── formatting.ts           # CLI formatting helpers
└── templates/
    └── email.html                  # Email template
```

---

## Error Handling

### Graceful Degradation

The tool should work even when some services fail:

| Failure | Behavior |
|---------|----------|
| No internet | Save locally, sync Airtable later |
| Airtable API error | Queue for retry, continue working |
| Gmail auth expired | Prompt to re-auth, save session anyway |
| No Anthropic API key | Skip AI suggestions, use git-only |
| No git repo | Skip git context, use project path only |
| No gh CLI | Skip PR lookup, use other sources |
| Claude conversation not found | Skip conversation analysis |

### Retry Queue

For Airtable sync failures:
```typescript
// On startup, check for unsynced sessions
const unsynced = await sqlite.getUnsyncedSessions();
for (const session of unsynced) {
  try {
    await airtable.syncSession(session);
    await sqlite.markSynced(session.id);
  } catch (e) {
    logger.warn(`Failed to sync session ${session.id}, will retry later`);
  }
}
```

---

## Security Considerations

1. **Credentials Storage**
   - Store Airtable API key and Gmail tokens in `~/.claude-tracker/` with `chmod 600`
   - Never log credentials

2. **Conversation Privacy**
   - Conversation summaries are processed locally or via user's own Anthropic API key
   - Only summaries (not full conversations) are sent to Airtable/email
   - User can disable AI summarization

3. **Gmail OAuth**
   - Use offline access for refresh tokens
   - Request minimal scopes (`gmail.send` only)

---

## Testing Plan

### Unit Tests

- Session timing calculations
- JSONL parsing
- Git context extraction
- Feature suggestion ranking
- Idle detection logic

### Integration Tests

- Full session lifecycle (start → work → end → save)
- Airtable sync
- Gmail sending
- Claude API summarization

### Manual Testing Scenarios

1. Normal session: start, work 30 min, exit
2. Idle timeout: start, wait 10 min
3. Project switch: start in project A, cd to project B
4. Network failure: disconnect WiFi mid-session
5. Multiple instances: try to start tracker while already running

---

## Future Enhancements (Out of Scope for V1)

1. **Web Dashboard** - Visualize time data beyond Airtable
2. **Team Features** - Aggregate tracking across team members
3. **Calendar Integration** - Block time on calendar based on sessions
4. **Token/Cost Tracking** - Track Claude API costs per session
5. **VS Code Extension** - GUI for viewing/managing sessions
6. **Pomodoro Mode** - Built-in work/break intervals
7. **Tagging System** - Tag sessions with custom labels
8. **Weekly Digest Email** - Summary of all sessions

---

## Success Metrics

1. **Adoption** - User runs tracker for >80% of Claude Code sessions
2. **Friction** - Session end prompt takes <30 seconds
3. **Data Quality** - >90% of sessions have meaningful feature descriptions
4. **Reliability** - <1% of sessions lost due to errors

---

## Open Questions for Implementation

1. **Claude API usage** - Should summarization be optional? Cost concerns?
2. **Airtable limits** - Free tier has 1,200 records/base. Need to handle?
3. **Multi-machine sync** - Should SQLite sync across machines? (Probably not V1)
4. **Notification style** - macOS notifications when idle timeout triggers?

---

## Appendix A: Claude Code Conversation Format

Location: `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl`

Path encoding: `/Users/andy/code/myapp` → `-Users-andy-code-myapp`

Each line is a JSON object:

```json
// User message
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "Help me add authentication"
  },
  "timestamp": "2025-06-02T18:46:59.937Z"
}

// Assistant message
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll help you add authentication..."
      }
    ]
  },
  "timestamp": "2025-06-02T18:47:06.267Z"
}

// Tool use
{
  "type": "assistant",
  "message": {
    "role": "assistant", 
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_xxx",
        "name": "write_file",
        "input": { "path": "auth.ts", "content": "..." }
      }
    ]
  },
  "timestamp": "2025-06-02T18:47:10.123Z"
}
```

---

## Appendix B: Gmail OAuth Setup

1. Create project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth 2.0 credentials (Desktop app)
4. Download credentials JSON
5. First run: open browser for consent, save refresh token

Scopes needed:
- `https://www.googleapis.com/auth/gmail.send`

---

## Appendix C: Airtable API Setup

1. Create Airtable account
2. Create Personal Access Token at airtable.com/create/tokens
3. Scopes needed: `data.records:read`, `data.records:write`, `schema.bases:read`
4. Create base manually or have init wizard create it

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial PRD |
