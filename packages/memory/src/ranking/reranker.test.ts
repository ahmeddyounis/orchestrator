import { describe, it, expect } from 'vitest';
import { rerank } from './reranker';
import type { MemoryEntry } from '../types';

const createMockEntry = (id: string, overrides: Partial<MemoryEntry>): MemoryEntry => ({
  id,
  repoId: 'test-repo',
  type: 'semantic',
  title: `Title for ${id}`,
  content: `Content for ${id}`,
  stale: false,
  createdAt: Date.now() - 10000,
  updatedAt: Date.now() - 5000,
  ...overrides,
});

describe('rerank', () => {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

  const entries: MemoryEntry[] = [
    createMockEntry('A', { type: 'procedural', updatedAt: sixtyDaysAgo }),
    createMockEntry('B', { type: 'episodic', stale: true, updatedAt: thirtyDaysAgo }),
    createMockEntry('C', { type: 'semantic', updatedAt: now - 1000 }),
    createMockEntry('D', { type: 'procedural', updatedAt: now - 2000, content: 'Content for A' }), // Duplicate of A
    createMockEntry('E', {
      type: 'episodic',
      title: 'Error: Something failed',
      updatedAt: thirtyDaysAgo,
    }),
  ];

  it('should downrank stale entries', () => {
    const reranked = rerank(entries, {
      intent: 'implementation',
      staleDownrank: true,
    });
    // Entry B is stale and should be ranked lower
    const entryBIndex = reranked.findIndex((e) => e.id === 'B');
    expect(entryBIndex).toBeGreaterThan(1);
  });

  it('should boost procedural entries during verification', () => {
    const reranked = rerank(entries, {
      intent: 'verification',
      staleDownrank: false,
    });
    // Procedural entries A and D should be at the top
    expect(reranked[0].type).toBe('procedural');
  });

  it('should boost episodic entries matching a failure signature', () => {
    const reranked = rerank(entries, {
      intent: 'implementation',
      staleDownrank: false,
      failureSignature: 'Error: Something failed',
    });
    // Entry E should be boosted
    expect(reranked[0].id).toBe('E');
  });

  it('should deduplicate entries with same content, keeping the newest', () => {
    const reranked = rerank(entries, {
      intent: 'planning',
      staleDownrank: false,
    });
    const ids = reranked.map((e) => e.id);
    // Entry A has same content as D, but D is newer. A should be removed.
    expect(ids).not.toContain('A');
    expect(ids).toContain('D');
  });

  it('should prioritize recency as a tie-breaker', () => {
    const freshEntries: MemoryEntry[] = [
      createMockEntry('old', { updatedAt: now - 10000 }),
      createMockEntry('new', { updatedAt: now - 1000 }),
    ];
    const reranked = rerank(freshEntries, {
      intent: 'planning',
      staleDownrank: false,
    });
    // With similar scores, the newer one should be first
    expect(reranked.map((e) => e.id)).toEqual(['new', 'old']);
  });
});
