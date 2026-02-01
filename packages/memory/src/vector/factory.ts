// packages/memory/src/vector/factory.ts

import {
  VectorMemoryBackend,
  VectorBackendContext,
  VectorUpsertItem,
  VectorQueryFilters,
  VectorQueryResult,
  VectorBackendInfo,
} from "./backend";

/**
 * Error thrown when a vector backend is not yet implemented.
 */
export class VectorBackendNotImplementedError extends Error {
  constructor(backend: string) {
    super(`Vector backend "${backend}" is not implemented.`);
    this.name = "VectorBackendNotImplementedError";
  }
}

/**
 * Error thrown when a remote backend is requested without opt-in.
 */
export class RemoteBackendNotAllowedError extends Error {
  constructor(backend: string) {
    super(
      `Remote vector backend "${backend}" requires explicit opt-in. ` +
        "Set remoteOptIn: true in your memory.vector config or ORCHESTRATOR_ALLOW_REMOTE_VECTORS=true in your environment."
    );
    this.name = "RemoteBackendNotAllowedError";
  }
}

/**
 * A mock implementation of VectorMemoryBackend for testing.
 * Stores vectors in memory and supports basic operations.
 */
export class MockVectorMemoryBackend implements VectorMemoryBackend {
  private store = new Map<string, Map<string, VectorUpsertItem>>();
  private initialized = false;

  async init(_ctx: VectorBackendContext): Promise<void> {
    this.initialized = true;
  }

  async upsert(
    _ctx: VectorBackendContext,
    repoId: string,
    items: VectorUpsertItem[]
  ): Promise<void> {
    if (!this.store.has(repoId)) {
      this.store.set(repoId, new Map());
    }
    const repoStore = this.store.get(repoId)!;
    for (const item of items) {
      repoStore.set(item.id, item);
    }
  }

  async query(
    _ctx: VectorBackendContext,
    repoId: string,
    queryVector: Float32Array,
    topK: number,
    filters?: VectorQueryFilters
  ): Promise<VectorQueryResult[]> {
    const repoStore = this.store.get(repoId);
    if (!repoStore) {
      return [];
    }

    const results: VectorQueryResult[] = [];
    for (const [id, item] of repoStore) {
      // Apply filters
      if (filters?.type !== undefined && item.metadata.type !== filters.type) {
        continue;
      }
      if (filters?.stale !== undefined && item.metadata.stale !== filters.stale) {
        continue;
      }

      // Compute cosine similarity
      const score = this.cosineSimilarity(queryVector, item.vector);
      results.push({ id, score });
    }

    // Sort by score descending and take topK
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async deleteByIds(
    _ctx: VectorBackendContext,
    repoId: string,
    ids: string[]
  ): Promise<void> {
    const repoStore = this.store.get(repoId);
    if (repoStore) {
      for (const id of ids) {
        repoStore.delete(id);
      }
    }
  }

  async wipeRepo(_ctx: VectorBackendContext, repoId: string): Promise<void> {
    this.store.delete(repoId);
  }

  async info(_ctx: VectorBackendContext): Promise<VectorBackendInfo> {
    return {
      backend: "mock",
      dims: 384,
      embedderId: "mock",
      location: "memory",
      supportsFilters: true,
    };
  }

  /** Check if the backend has been initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Get the number of items stored for a repo (for testing) */
  getItemCount(repoId: string): number {
    return this.store.get(repoId)?.size ?? 0;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/** Backends that are local and don't require remote opt-in */
const LOCAL_BACKENDS = new Set(["sqlite", "mock"]);

/**
 * Configuration for VectorBackendFactory.
 * Extends the schema's vector config to allow "mock" backend for testing.
 */
export interface VectorBackendConfig {
  backend: string;
}

/**
 * Factory for creating vector memory backends based on configuration.
 */
export class VectorBackendFactory {
  /**
   * Creates a VectorMemoryBackend instance based on the provided configuration.
   *
   * @param cfg - Vector configuration with at least a backend field
   * @param remoteOptIn - Whether remote backends are allowed
   * @returns A VectorMemoryBackend instance
   * @throws RemoteBackendNotAllowedError if a remote backend is requested without opt-in
   * @throws VectorBackendNotImplementedError if the backend is not yet implemented
   */
  static fromConfig(
    cfg: VectorBackendConfig,
    remoteOptIn: boolean
  ): VectorMemoryBackend {
    const backend = cfg.backend;

    // Mock backend is always available (for testing)
    if (backend === "mock") {
      return new MockVectorMemoryBackend();
    }

    // Check remote opt-in for non-local backends
    if (!LOCAL_BACKENDS.has(backend) && !remoteOptIn) {
      throw new RemoteBackendNotAllowedError(backend);
    }

    // TODO: Implement actual backends (sqlite, qdrant, chroma, pgvector)
    throw new VectorBackendNotImplementedError(backend);
  }
}
