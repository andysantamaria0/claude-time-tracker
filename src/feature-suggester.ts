import type { GitContext, ConversationAnalysis, FeatureSuggestion } from './types.js';

export function buildSuggestions(
  gitContext: GitContext,
  analysis?: ConversationAnalysis,
): FeatureSuggestion[] {
  const suggestions: FeatureSuggestion[] = [];
  const seen = new Set<string>();

  // PR titles (highest confidence)
  const currentPR = gitContext.openPRs.find(pr => pr.branch === gitContext.branch);
  if (currentPR) {
    addSuggestion(suggestions, seen, {
      text: currentPR.title,
      source: 'pr',
      confidence: 1.0,
    });
  }

  // Recent commit messages
  for (const commit of gitContext.recentCommits.slice(0, 5)) {
    addSuggestion(suggestions, seen, {
      text: commit.message,
      source: 'commit',
      confidence: 0.8,
    });
  }

  // Branch name
  if (gitContext.branch && gitContext.branch !== 'main' && gitContext.branch !== 'master') {
    const branchFeature = branchToFeatureName(gitContext.branch);
    if (branchFeature) {
      addSuggestion(suggestions, seen, {
        text: branchFeature,
        source: 'branch',
        confidence: 0.6,
      });
    }
  }

  // Conversation analysis suggestions
  if (analysis?.suggestedFeatures) {
    for (const feat of analysis.suggestedFeatures) {
      addSuggestion(suggestions, seen, {
        text: feat,
        source: 'conversation',
        confidence: 0.7,
      });
    }
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

function addSuggestion(
  list: FeatureSuggestion[],
  seen: Set<string>,
  suggestion: FeatureSuggestion,
): void {
  const normalized = normalize(suggestion.text);
  if (!normalized || normalized.length < 3) return;

  // Check for duplicates (fuzzy)
  for (const existing of seen) {
    if (isSimilar(existing, normalized)) return;
  }

  seen.add(normalized);
  list.push(suggestion);
}

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Simple word overlap check
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.length / union.size > 0.6;
}

function branchToFeatureName(branch: string): string {
  return branch
    .replace(/^(feature|feat|fix|bugfix|hotfix|chore|refactor)\//i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase());
}
