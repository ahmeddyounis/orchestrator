// packages/memory/src/vector/factory.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  VectorBackendFactory,
  MockVectorMemoryBackend,
  VectorBackendNotImplementedError,
  RemoteBackendNotAllowedError,
} from './factory';
import type { VectorBackendConfig } from './backend';
import { SQLiteVectorBackend } from './sqlite/sqlite-backend';

describe('VectorBackendFactory', () => {
  describe('fromConfig', () => {
    it('should return a mock backend when specified', () => {
      const config: VectorBackendConfig = { backend: 'mock' };
      const backend = VectorBackendFactory.fromConfig(config, false);
      expect(backend).toBeDefined();
      expect(backend).toBeInstanceOf(MockVectorMemoryBackend);
    });

    it('should throw RemoteBackendNotAllowedError for a remote backend when remoteOptIn is false', () => {
      const config: VectorBackendConfig = { backend: 'qdrant' };
      expect(() => VectorBackendFactory.fromConfig(config, false)).toThrow(
        RemoteBackendNotAllowedError,
      );
      expect(() => VectorBackendFactory.fromConfig(config, false)).toThrow(
        'Remote vector backend "qdrant" requires explicit opt-in.',
      );
    });

    it('should throw VectorBackendNotImplementedError for a remote backend when remoteOptIn is true', () => {
      const config: VectorBackendConfig = { backend: 'chroma' };
      // It should throw NotImplementedError, but not the remote opt-in error
      expect(() => VectorBackendFactory.fromConfig(config, true)).toThrow(
        VectorBackendNotImplementedError,
      );
    });

    it('should return SQLiteVectorBackend for sqlite backend', () => {
      const config: VectorBackendConfig = { backend: 'sqlite' };
      const backend = VectorBackendFactory.fromConfig(config, false);
      expect(backend).toBeInstanceOf(SQLiteVectorBackend);
    });

    it('should throw VectorBackendNotImplementedError for an unknown backend with remoteOptIn', () => {
      const config: VectorBackendConfig = { backend: 'unknown' };
      expect(() => VectorBackendFactory.fromConfig(config, true)).toThrow(
        VectorBackendNotImplementedError,
      );
      expect(() => VectorBackendFactory.fromConfig(config, true)).toThrow(
        'Vector backend "unknown" is not implemented.',
      );
    });

    it('should throw RemoteBackendNotAllowedError for chroma without opt-in', () => {
      const config: VectorBackendConfig = { backend: 'chroma' };
      expect(() => VectorBackendFactory.fromConfig(config, false)).toThrow(
        RemoteBackendNotAllowedError,
      );
    });

    it('should throw RemoteBackendNotAllowedError for pgvector without opt-in', () => {
      const config: VectorBackendConfig = { backend: 'pgvector' };
      expect(() => VectorBackendFactory.fromConfig(config, false)).toThrow(
        RemoteBackendNotAllowedError,
      );
    });
  });
});

describe('MockVectorMemoryBackend', () => {
  let backend: MockVectorMemoryBackend;
  const ctx = {};
  const repoId = 'test-repo';

  beforeEach(() => {
    backend = new MockVectorMemoryBackend();
  });

  describe('init', () => {
    it('should initialize the backend', async () => {
      expect(backend.isInitialized()).toBe(false);
      await backend.init(ctx);
      expect(backend.isInitialized()).toBe(true);
    });
  });

  describe('upsert', () => {
    it('should store items', async () => {
      const items = [
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
      expect(backend.getItemCount(repoId)).toBe(2);
    });

    it('should update existing items', async () => {
      const item = {
        id: 'item-1',
        vector: new Float32Array([0.1, 0.2, 0.3]),
        metadata: { type: 'procedural', stale: false, updatedAt: Date.now() },
      };

      await backend.upsert(ctx, repoId, [item]);
      expect(backend.getItemCount(repoId)).toBe(1);

      // Update the same item
      item.metadata.stale = true;
      await backend.upsert(ctx, repoId, [item]);
      expect(backend.getItemCount(repoId)).toBe(1);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const items = [
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
  });

  describe('deleteByIds', () => {
    it('should delete specified items', async () => {
      const items = [
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
      expect(backend.getItemCount(repoId)).toBe(2);

      await backend.deleteByIds(ctx, repoId, ['item-1']);
      expect(backend.getItemCount(repoId)).toBe(1);
    });

    it('should handle non-existent ids gracefully', async () => {
      await backend.deleteByIds(ctx, repoId, ['non-existent']);
      // Should not throw
    });
  });

  describe('wipeRepo', () => {
    it('should delete all items for a repo', async () => {
      const items = [
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
      expect(backend.getItemCount(repoId)).toBe(2);

      await backend.wipeRepo(ctx, repoId);
      expect(backend.getItemCount(repoId)).toBe(0);
    });
  });

  describe('info', () => {
    it('should return backend metadata', async () => {
      const info = await backend.info(ctx);

      expect(info.backend).toBe('mock');
      expect(info.dims).toBe(384);
      expect(info.embedderId).toBe('mock');
      expect(info.location).toBe('memory');
      expect(info.supportsFilters).toBe(true);
    });
  });
});
