// packages/memory/src/vector/noop.ts

import {
  VectorMemoryBackend,
  VectorItem,
  VectorQueryResult,
  VectorQueryFilter,
  VectorBackendInfo,
} from './backend';

/** No-op vector backend that does nothing - useful for testing or when vector search is disabled */
export class NoopVectorMemoryBackend implements VectorMemoryBackend {
  async init(_ctx: object): Promise<void> {
    // No-op
  }

  async upsert(_ctx: object, _repoId: string, _items: VectorItem[]): Promise<void> {
    // No-op
  }

  async query(
    _ctx: object,
    _repoId: string,
    _vector: Float32Array,
    _topK: number,
    _filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]> {
    return [];
  }

  async deleteByIds(_ctx: object, _repoId: string, _ids: string[]): Promise<void> {
    // No-op
  }

  async wipeRepo(_ctx: object, _repoId: string): Promise<void> {
    // No-op
  }

  async info(_ctx: object): Promise<VectorBackendInfo> {
    return {
      backend: 'noop',
      dims: 0,
      embedderId: 'none',
      location: 'none',
      supportsFilters: false,
    };
  }
}
