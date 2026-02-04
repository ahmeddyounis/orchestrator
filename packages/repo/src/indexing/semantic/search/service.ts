import { Embedder } from '@orchestrator/adapters';
import type { EventBus } from '@orchestrator/shared';
import { SemanticIndexStore } from '../store';
import { SemanticHit } from './types';
import { VectorIndex } from './vector-index';
import type { Chunk } from '../store/types';

export interface SemanticSearchServiceOptions {
  store: SemanticIndexStore;
  embedder: Embedder;
  eventBus: EventBus;
}

export class SemanticSearchService {
  private store: SemanticIndexStore;
  private embedder: Embedder;
  private eventBus: EventBus;
  private vectorIndex: VectorIndex | null = null;
  private indexVersion: number = 0;
  private lastKnownChunkCount: number = -1;

  constructor(options: SemanticSearchServiceOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
    this.eventBus = options.eventBus;
  }

  /**
   * Invalidates the vector index, forcing a rebuild on next search.
   * Call this after modifying the store.
   */
  invalidateIndex(): void {
    this.vectorIndex = null;
    this.indexVersion++;
  }

  private ensureIndex(candidates: (Chunk & { vector: Float32Array })[]): VectorIndex {
    const currentCount = candidates.length;
    if (this.vectorIndex === null || currentCount !== this.lastKnownChunkCount) {
      this.vectorIndex = new VectorIndex();
      this.vectorIndex.build(candidates);
      this.lastKnownChunkCount = currentCount;
    }
    return this.vectorIndex;
  }

  async search(query: string, topK: number, runId: string): Promise<SemanticHit[]> {
    const startTime = Date.now();

    const queryVectors = await this.embedder.embedTexts([query], { normalize: true });
    if (queryVectors.length === 0) return [];
    const queryVector = new Float32Array(queryVectors[0]);

    const candidates = this.store.getAllChunksWithEmbeddings();
    const candidateCount = candidates.length;

    let hits: SemanticHit[];

    // Use vector index for larger datasets, linear scan for small ones
    // The index overhead isn't worth it for very small datasets
    if (candidateCount <= 100) {
      // Linear scan for small datasets
      hits = VectorIndex.linearSearch(candidates, queryVector, topK);
    } else {
      // Use vector index for larger datasets
      const index = this.ensureIndex(candidates);
      hits = index.search(queryVector, topK);
    }

    const durationMs = Date.now() - startTime;

    await this.eventBus.emit({
      type: 'SemanticSearchFinished',
      schemaVersion: 1,
      runId,
      timestamp: new Date().toISOString(),
      payload: {
        query,
        topK,
        hitCount: hits.length,
        candidateCount,
        durationMs,
      },
    });

    return hits;
  }
}
