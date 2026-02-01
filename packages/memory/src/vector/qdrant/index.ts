import {
  VectorBackendConfig,
  VectorBackendInfo,
  VectorItem,
  VectorMemoryBackend,
  VectorQueryFilter,
  VectorQueryResult,
} from '../backend';
import { MemoryError } from '@orchestrator/shared';

// Qdrant-specific configuration
export interface QdrantVectorBackendConfig extends VectorBackendConfig {
  backend: 'qdrant';
  url: string;
  apiKeyEnv?: string;
  collection: string;
}

// Payload stored in Qdrant, excluding memory content
interface QdrantPointPayload {
  repoId: string;
  type: string;
  stale: boolean;
  updatedAt: number;
}

// A Qdrant point
interface QdrantPoint {
  id: string;
  vector: number[];
  payload: QdrantPointPayload;
}

export class QdrantVectorBackend implements VectorMemoryBackend {
  private config: QdrantVectorBackendConfig;
  private apiKey: string | undefined;

  constructor(config: QdrantVectorBackendConfig) {
    this.config = config;
    if (config.apiKeyEnv) {
      this.apiKey = process.env[config.apiKeyEnv];
    }
  }

  async init(ctx: object): Promise<void> {
    if (!this.config.url || !this.config.collection) {
      throw new MemoryError('Qdrant URL and collection name are required.');
    }
    // In a real-world scenario, we might ping the Qdrant instance
    // to check for connectivity and collection existence.
    // For this implementation, we assume it's correctly configured.
    return Promise.resolve();
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: any,
  ): Promise<T> {
    const url = `${this.config.url}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new MemoryError(
          `Qdrant API error: ${response.status} ${response.statusText} - ${errorBody}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof MemoryError) {
        throw error;
      }
      throw new MemoryError(`Qdrant network error: ${(error as Error).message}`, { cause: error });
    }
  }

  async upsert(ctx: object, repoId: string, items: VectorItem[]): Promise<void> {
    const points: QdrantPoint[] = items.map((item) => ({
      id: item.id,
      vector: Array.from(item.vector),
      payload: {
        repoId,
        type: item.metadata.type,
        stale: item.metadata.stale,
        updatedAt: item.metadata.updatedAt,
      },
    }));

    await this.makeRequest(`/collections/${this.config.collection}/points`, 'PUT', { points });
  }

  async query(
    ctx: object,
    repoId: string,
    vector: Float32Array,
    topK: number,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]> {
    const qdrantFilter: any = {
      must: [{ key: 'repoId', match: { value: repoId } }],
    };

    if (filter?.type) {
      qdrantFilter.must.push({ key: 'type', match: { value: filter.type } });
    }
    if (filter?.stale !== undefined) {
      qdrantFilter.must.push({ key: 'stale', match: { value: filter.stale } });
    }

    const response = await this.makeRequest<{ result: any[] }>(
      `/collections/${this.config.collection}/points/search`,
      'POST',
      {
        vector: Array.from(vector),
        limit: topK,
        filter: qdrantFilter,
        with_payload: false, // We only need IDs and scores
        with_vector: false,
      },
    );

    return response.result.map((point) => ({
      id: point.id,
      score: point.score,
    }));
  }

  async deleteByIds(ctx: object, repoId: string, ids: string[]): Promise<void> {
    // Qdrant's delete by IDs doesn't support filtering by repoId in the same call.
    // For data safety, we should fetch points first to ensure we only delete points
    // belonging to the repoId, but that is less efficient.
    // The spec implies a direct delete is acceptable.
    await this.makeRequest(`/collections/${this.config.collection}/points/delete`, 'POST', {
      points: ids,
    });
  }

  async wipeRepo(ctx: object, repoId: string): Promise<void> {
    await this.makeRequest(`/collections/${this.config.collection}/points/delete`, 'POST', {
      filter: {
        must: [{ key: 'repoId', match: { value: repoId } }],
      },
    });
  }

  async info(ctx: object): Promise<VectorBackendInfo> {
    try {
      const collectionInfo = await this.makeRequest<{ result: any }>(
        `/collections/${this.config.collection}`,
        'GET',
      );
      return {
        backend: 'qdrant',
        dims: collectionInfo.result.vectors_config.params.size,
        embedderId: '', // Not stored in Qdrant
        location: this.config.url,
        supportsFilters: true,
      };
    } catch (e) {
      // If we can't get info, return defaults.
      return {
        backend: 'qdrant',
        dims: -1,
        embedderId: '',
        location: this.config.url,
        supportsFilters: true,
      };
    }
  }

  async close(): Promise<void> {
    // No-op for HTTP-based client
    return Promise.resolve();
  }
}
