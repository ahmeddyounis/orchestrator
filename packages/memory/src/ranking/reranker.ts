import type { MemoryEntry } from '../types';
import type { RetrievalIntent } from '@orchestrator/shared';

export interface RerankOptions {
  intent: RetrievalIntent;
  staleDownrank: boolean;
  failureSignature?: string;
}

// Simple normalization: lowercase and remove non-alphanumeric chars
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

export function rerank(entries: MemoryEntry[], options: RerankOptions): MemoryEntry[] {
  const { intent, staleDownrank } = options;
  const now = Date.now();

  const scoredEntries = entries.map((entry) => {
    let score = 1.0; // Start with a base score

    // 1. Staleness penalty
    if (staleDownrank && entry.stale) {
      score *= 0.1;
    }

    // 2. Procedural boost for verification
    if (intent === 'verification' && entry.type === 'procedural') {
      score *= 1.5;
    }

    // 3. Episodic boost for matching failure signature
    if (
      intent === 'implementation' &&
      entry.type === 'episodic' &&
      options.failureSignature &&
      entry.title.includes(options.failureSignature) // Simple title match
    ) {
      score *= 1.3;
    }

    // 4. Recency boost (e.g., within last 30 days)
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (now - entry.updatedAt < thirtyDays) {
      score *= 1.2;
    }

    return { ...entry, score };
  });

  // 5. Deduplication
  const uniqueEntries = new Map<string, (typeof scoredEntries)[0]>();
  for (const entry of scoredEntries) {
    const normalizedContent = normalize(entry.content);
    const existing = uniqueEntries.get(normalizedContent);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      uniqueEntries.set(normalizedContent, entry);
    }
  }

  const reranked = Array.from(uniqueEntries.values());

  // Sort by final score, then by recency as a tie-breaker
  reranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.updatedAt - a.updatedAt;
  });

  return reranked;
}
