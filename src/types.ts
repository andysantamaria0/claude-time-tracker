export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  branch: string;
  feature: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  durationMs: number;
  endReason: 'exit' | 'idle' | 'manual' | 'project-switch';
  commits: string[];
  changedFiles: string[];
  prUrl?: string;
  conversationSummary?: string;
  airtableSynced: boolean;
  airtableRecordId?: string;
  emailSent: boolean;
}

export interface GitContext {
  branch: string;
  recentCommits: CommitInfo[];
  openPRs: PRInfo[];
  changedFiles: string[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  timestamp: string;
}

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  branch: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ConversationAnalysis {
  summary: string;
  suggestedFeatures: string[];
  filesDiscussed: string[];
  complexity: 'low' | 'medium' | 'high';
}

export interface FeatureSuggestion {
  text: string;
  source: 'pr' | 'commit' | 'branch' | 'conversation';
  confidence: number;
}
