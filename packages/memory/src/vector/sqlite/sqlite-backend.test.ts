// packages/memory/src/vector/sqlite/sqlite-backend.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteVectorBackend } from './sqlite-backend';
import type { VectorItem } from '../backend';

function cosine(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  return dotProduct / magnitude;
}

describe('SQLiteVectorBackend', () => {
  let backend: SQLiteVectorBackend;
  let tempDir: string;
  const ctx = {};
  const repoId = 'test-repo';

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'vector-test-'));
    const dbPath = join(tempDir, 'vectors.sqlite');
    backend = new SQLiteVectorBackend(dbPath);
    await backend.init(ctx);
  });

  afterEach(async () => {
    await backend.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should initialize the backend and create tables', async () => {
      // Backend is already initialized in beforeEach
      const info = await backend.info(ctx);
      expect(info.backend).toBe('sqlite');
    });

    it('should be idempotent (can init multiple times)', async () => {
      // First init already done in beforeEach
      await backend.init(ctx);
      await backend.init(ctx);
      // Should not throw
      const info = await backend.info(ctx);
      expect(info.backend).toBe('sqlite');
    });
  });

  describe('upsert', () => {
    it('should store items', async () => {
      const items: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([0.1, 0.2, 0.3]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
        {
          id: 'item-2',
          vector: new Float32Array([0.4, 0.5, 0.6]),
          metadata: { type: 'episodic', stale: false, updatedAt: Date.now() },
        },
      ];

      await backend.upsert(ctx, repoId, items);

      const results = await backend.query(ctx, repoId, new Float32Array([0.1, 0.2, 0.3]), 10);
      expect(results.length).toBe(2);
    });

    it('should update existing items (upsert)', async () => {
      const item: VectorItem = {
        id: 'item-1',
        vector: new Float32Array([0.1, 0.2, 0.3]),
        metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
      };

      await backend.upsert(ctx, repoId, [item]);

      // Update the same item
      item.metadata.stale = true;
      item.vector = new Float32Array([0.7, 0.8, 0.9]);
      await backend.upsert(ctx, repoId, [item]);

      const results = await backend.query(ctx, repoId, new Float32Array([0.7, 0.8, 0.9]), 10);
      expect(results.length).toBe(1);
      expect(results[0].metadata?.stale).toBe(true);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const items: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([1, 0, 0]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
        {
          id: 'item-2',
          vector: new Float32Array([0, 1, 0]),
          metadata: { type: 'episodic', stale: true, updatedAt: Date.now() },
        },
        {
          id: 'item-3',
          vector: new Float32Array([0.9, 0.1, 0]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
      ];
      await backend.upsert(ctx, repoId, items);
    });

    it('should return results sorted by similarity', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      const results = await backend.query(ctx, repoId, queryVector, 10);

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('item-1');
      expect(results[0].score).toBeCloseTo(1.0);
      expect(results[1].id).toBe('item-3');
    });

    it('should respect topK limit', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      const results = await backend.query(ctx, repoId, queryVector, 2);

      expect(results.length).toBe(2);
    });

    it('should filter by type', async () => {
      const queryVector = new Float32Array([0.5, 0.5, 0]);
      const results = await backend.query(ctx, repoId, queryVector, 10, {
        type: 'procedural',
      });

      expect(results.length).toBe(2);
      expect(results.every((r) => r.id === 'item-1' || r.id === 'item-3')).toBe(true);
    });

    it('should filter by stale', async () => {
      const queryVector = new Float32Array([0.5, 0.5, 0]);
      const results = await backend.query(ctx, repoId, queryVector, 10, {
        stale: true,
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('item-2');
    });

    it('should return empty array for non-existent repo', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      const results = await backend.query(ctx, 'non-existent', queryVector, 10);

      expect(results).toEqual([]);
    });

    it('should handle upserting 5 items and querying topK with correct ordering', async () => {
      // From spec M16-09
      const items: VectorItem[] = [
        { id: 'v1', vector: new Float32Array([0.1, 0.1, 0.1]), metadata: { type: 't', stale: false, updatedAt: 1 } }, // Score ~0.17
        { id: 'v2', vector: new Float32Array([0.9, 0.9, 0.9]), metadata: { type: 't', stale: false, updatedAt: 1 } }, // Score ~0.9
        { id: 'v3', vector: new Float32Array([0.5, 0.5, 0.5]), metadata: { type: 't', stale: false, updatedAt: 1 } }, // Score ~0.5
        { id: 'v4', vector: new Float32Array([0.2, 0.2, 0.2]), metadata: { type: 't', stale: false, updatedAt: 1 } }, // Score ~0.2
        { id: 'v5', vector: new Float32Array([0.8, 0.8, 0.8]), metadata: { type: 't', stale: false, updatedAt: 1 } }, // Score ~0.8
      ];
      await backend.upsert(ctx, 'new-repo', items);

      const queryVector = new Float32Array([1, 1, 1]);
      const results = await backend.query(ctx, 'new-repo', queryVector, 3);

      expect(results.length).toBe(3);
      expect(results.map((r) => r.id)).toEqual(['v2', 'v5', 'v3']);
      expect(results[0].score).toBeCloseTo(cosine(queryVector, items[1].vector));
      expect(results[1].score).toBeCloseTo(cosine(queryVector, items[4].vector));
      expect(results[2].score).toBeCloseTo(cosine(queryVector, items[2].vector));
    });
  });

  describe('deleteByIds', () => {
    it('should delete specified items', async () => {
      const items: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([0.1, 0.2, 0.3]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
        {
          id: 'item-2',
          vector: new Float32Array([0.4, 0.5, 0.6]),
          metadata: { type: 'episodic', stale: false, updatedAt: Date.now() },
        },
      ];

      await backend.upsert(ctx, repoId, items);

      let results = await backend.query(ctx, repoId, new Float32Array([0.1, 0.2, 0.3]), 10);
      expect(results.length).toBe(2);

      await backend.deleteByIds(ctx, repoId, ['item-1']);

      results = await backend.query(ctx, repoId, new Float32Array([0.1, 0.2, 0.3]), 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('item-2');
    });

    it('should handle non-existent ids gracefully', async () => {
      await backend.deleteByIds(ctx, repoId, ['non-existent']);
      // Should not throw
    });

    it('should handle empty ids array', async () => {
      await backend.deleteByIds(ctx, repoId, []);
      // Should not throw
    });

    it('should delete multiple specified items', async () => {
      const items: VectorItem[] = [
        { id: 'd1', vector: new Float32Array([1, 0, 0]), metadata: { type: 't', stale: false, updatedAt: 1 } },
        { id: 'd2', vector: new Float32Array([0, 1, 0]), metadata: { type: 't', stale: false, updatedAt: 1 } },
        { id: 'd3', vector: new Float32Array([0, 0, 1]), metadata: { type: 't', stale: false, updatedAt: 1 } },
      ];
      await backend.upsert(ctx, repoId, items);

      await backend.deleteByIds(ctx, repoId, ['d1', 'd3']);

      const results = await backend.query(ctx, repoId, new Float32Array([1, 1, 1]), 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('d2');
    });
  });

  describe('wipeRepo', () => {
    it('should delete all items for a repo', async () => {
      const items: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([0.1, 0.2, 0.3]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
        {
          id: 'item-2',
          vector: new Float32Array([0.4, 0.5, 0.6]),
          metadata: { type: 'episodic', stale: false, updatedAt: Date.now() },
        },
      ];

      await backend.upsert(ctx, repoId, items);

      let results = await backend.query(ctx, repoId, new Float32Array([0.1, 0.2, 0.3]), 10);
      expect(results.length).toBe(2);

      await backend.wipeRepo(ctx, repoId);

      results = await backend.query(ctx, repoId, new Float32Array([0.1, 0.2, 0.3]), 10);
      expect(results.length).toBe(0);
    });

    it('should only delete items for the specified repo', async () => {
      const items1: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([0.1, 0.2, 0.3]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
      ];
      const items2: VectorItem[] = [
        {
          id: 'item-2',
          vector: new Float32Array([0.4, 0.5, 0.6]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
      ];

      await backend.upsert(ctx, 'repo-1', items1);
      await backend.upsert(ctx, 'repo-2', items2);

      await backend.wipeRepo(ctx, 'repo-1');

      const results1 = await backend.query(ctx, 'repo-1', new Float32Array([0.1, 0.2, 0.3]), 10);
      const results2 = await backend.query(ctx, 'repo-2', new Float32Array([0.4, 0.5, 0.6]), 10);

      expect(results1.length).toBe(0);
      expect(results2.length).toBe(1);
    });
  });

  describe('info', () => {
    it('should return backend metadata', async () => {
      const info = await backend.info(ctx);

      expect(info.backend).toBe('sqlite');
      expect(info.dims).toBe(384);
      expect(info.supportsFilters).toBe(true);
      expect(info.location).toContain('vectors.sqlite');
    });
  });

  describe('persistence', () => {
    it('should persist data across backend instances', async () => {
      const items: VectorItem[] = [
        {
          id: 'item-1',
          vector: new Float32Array([1, 0, 0]),
          metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
        },
      ];

      await backend.upsert(ctx, repoId, items);
      await backend.close();

      // Create new backend instance with same path
      const dbPath = join(tempDir, 'vectors.sqlite');
      const backend2 = new SQLiteVectorBackend(dbPath);
      await backend2.init(ctx);

      const results = await backend2.query(ctx, repoId, new Float32Array([1, 0, 0]), 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('item-1');

      await backend2.close();
    });
  });
});
