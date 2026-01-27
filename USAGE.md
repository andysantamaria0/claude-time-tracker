# Claude Time Tracker — Usage

## Quick Start

From any project folder, just run:

```bash
claude-tracker start
```

This launches Claude Code with session tracking. When you exit Claude, you'll be prompted to describe what you worked on. The session is saved locally to SQLite.

The tracker records whichever directory you run it from as the project.

## Commands

### Start a session

```bash
claude-tracker start
```

Pass arguments to Claude Code after the command:

```bash
claude-tracker start --model sonnet
```

### Stop a session manually

```bash
claude-tracker stop
```

### Check active session

```bash
claude-tracker status
```

### View past sessions

```bash
claude-tracker history
claude-tracker history -n 20
```

### Generate reports

```bash
claude-tracker report --day
claude-tracker report --week
claude-tracker report --month
claude-tracker report --week --email   # requires Resend setup
```

### Configure integrations

```bash
claude-tracker init
```

This walks you through setting up:
- **Conversation analysis** — AI-powered session summaries (needs Anthropic API key)
- **Airtable sync** — auto-push sessions to an Airtable base
- **Email reports** — send session reports via Resend

### Retry failed Airtable syncs

```bash
claude-tracker sync
```

## How It Works

1. `start` records your project path, git branch, and timestamp
2. Claude Code launches interactively
3. Idle detection polls for file changes (default 10min timeout)
4. When Claude exits (or you run `stop`), the tracker:
   - Gathers git context (commits, changed files, open PRs)
   - Optionally analyzes your conversation via Claude API
   - Prompts you to pick or type a feature description
   - Saves the session to `~/.claude-tracker/sessions.db`
   - Syncs to Airtable and/or sends email if configured

## Data Location

- Config: `~/.claude-tracker/config.json`
- Database: `~/.claude-tracker/sessions.db`

## Rebuilding After Code Changes

If you modify the tracker source code, rebuild and re-link:

```bash
cd ~/Documents/claude-code/claude-time-tracker
npm run build
npm link
```
