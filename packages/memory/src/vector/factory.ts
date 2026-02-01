// packages/memory/src/vector/factory.ts

import {
  VectorMemoryBackend,
  VectorItem,
  VectorQueryResult,
  VectorQueryFilter,
  VectorBackendInfo,
  VectorBackendConfig,
  Vector,
  LegacyVectorMemoryBackend,
} from './backend';
import { SQLiteVectorBackend } from './sqlite/sqlite-backend';

// Re-export VectorBackendConfig for tests
export { VectorBackendConfig } from './backend';

/** Error thrown when a requested backend is not implemented */
export class VectorBackendNotImplementedError extends Error {
  constructor(backend: string) {
    super(`Vector backend "${backend}" is not implemented.`);
    this.name = 'VectorBackendNotImplementedError';
  }
}

/** Error thrown when a remote backend is used without opt-in */
export class RemoteBackendNotAllowedError extends Error {
  constructor(backend: string) {
    super(`Remote vector backend "${backend}" requires explicit opt-in.`);
    this.name = 'RemoteBackendNotAllowedError';
  }
}

const REMOTE_BACKENDS = ['qdrant', 'chroma', 'pgvector'];

/** Cosine similarity between two vectors */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

/** In-memory mock implementation for testing */
export class MockVectorMemoryBackend implements VectorMemoryBackend {
  private data: Map<string, Map<string, VectorItem>> = new Map();
  private initialized = false;

  async init(_ctx: object): Promise<void> {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async upsert(_ctx: object, repoId: string, items: VectorItem[]): Promise<void> {
    if (!this.data.has(repoId)) {
      this.data.set(repoId, new Map());
    }
    const repoData = this.data.get(repoId)!;
    for (const item of items) {
      repoData.set(item.id, item);
    }
  }

  async query(
    _ctx: object,
    repoId: string,
    vector: Float32Array,
    topK: number,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]> {
    const repoData = this.data.get(repoId);
    if (!repoData) return [];

    const results: VectorQueryResult[] = [];
    for (const item of repoData.values()) {
      // Apply filters
      if (filter?.type !== undefined && item.metadata.type !== filter.type) {
        continue;
      }
      if (filter?.stale !== undefined && item.metadata.stale !== filter.stale) {
        continue;
      }

      const score = cosineSimilarity(vector, item.vector);
      results.push({
        id: item.id,
        score,
        metadata: item.metadata,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async deleteByIds(_ctx: object, repoId: string, ids: string[]): Promise<void> {
    const repoData = this.data.get(repoId);
    if (!repoData) return;
    for (const id of ids) {
      repoData.delete(id);
    }
  }

  async wipeRepo(_ctx: object, repoId: string): Promise<void> {
    this.data.delete(repoId);
  }

  async info(_ctx: object): Promise<VectorBackendInfo> {
    return {
      backend: 'mock',
      dims: 384,
      embedderId: 'mock',
      location: 'memory',
      supportsFilters: true,
    };
  }

  /** Get the number of items stored for a repo (for testing) */
  getItemCount(repoId: string): number {
    return this.data.get(repoId)?.size ?? 0;
  }
}

/** Factory for creating vector memory backends */
export class VectorBackendFactory {
  /**
   * Create a vector memory backend from configuration
   * @param config Backend configuration
   * @param remoteOptIn Whether remote backends are allowed
   */
  static fromConfig(config: VectorBackendConfig, remoteOptIn: boolean): VectorMemoryBackend {
    const backend = config.backend;

    // Check for remote backends requiring opt-in
    if (REMOTE_BACKENDS.includes(backend) && !remoteOptIn) {
      throw new RemoteBackendNotAllowedError(backend);
    }

    switch (backend) {
      case 'mock':
        return new MockVectorMemoryBackend();

      case 'sqlite': {
        return new SQLiteVectorBackend(config.path, config.maxCandidates);
      }

      default:
        throw new VectorBackendNotImplementedError(backend);
    }
  }
}

/** Configuration for legacy vector storage (from shared config schema) */
export interface VectorStorageConfig {
  backend?: string;
  path?: string;
}

/**
 * Legacy wrapper that adapts the new VectorMemoryBackend to the old interface.
 * Used for backward compatibility with CLI and core packages.
 */
class LegacyVectorBackendAdapter implements LegacyVectorMemoryBackend {
  private backend: VectorMemoryBackend;
  private initialized = false;

  constructor(backend: VectorMemoryBackend) {
    this.backend = backend;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.backend.init({});
      this.initialized = true;
    }
  }

  async upsert(repoId: string, vectors: Vector[]): Promise<void> {
    await this.ensureInit();
    const items: VectorItem[] = vectors.map((v) => ({
      id: v.id,
      vector: new Float32Array(v.vector),
      metadata: {
        type: (v.metadata as { type?: string })?.type ?? 'unknown',
        stale: false,
        updatedAt: Date.now(),
      },
    }));
    await this.backend.upsert({}, repoId, items);
  }

  async query(repoId: string, vector: number[], topK: number): Promise<string[]> {
    await this.ensureInit();
    const results = await this.backend.query({}, repoId, new Float32Array(vector), topK);
    return results.map((r) => r.id);
  }

  async wipeRepo(repoId: string): Promise<void> {
    await this.ensureInit();
    await this.backend.wipeRepo({}, repoId);
  }

  async isRepoEmpty(repoId: string): Promise<boolean> {
    await this.ensureInit();
    const results = await this.backend.query({}, repoId, new Float32Array([0]), 1);
    return results.length === 0;
  }
}

/**
 * Legacy factory function for creating vector backends.
 * @deprecated Use VectorBackendFactory.fromConfig() instead
 */
export function createVectorMemoryBackend(
  config: VectorStorageConfig,
): LegacyVectorMemoryBackend {
  const backendName = config.backend ?? 'sqlite';
  
  const newConfig: VectorBackendConfig = {
    backend: backendName,
    path: config.path,
  };

  const backend = VectorBackendFactory.fromConfig(newConfig, false);
  return new LegacyVectorBackendAdapter(backend);
}
