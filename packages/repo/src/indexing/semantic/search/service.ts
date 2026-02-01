import { Embedder } from '@orchestrator/adapters';
import { SemanticIndexStore } from '../store';
import { SemanticHit } from './types';

import { Embedder } from '@orchestrator/adapters';
import { EventBus } from '@orchestrator/shared';
import { SemanticIndexStore } from '../store';
import { SemanticHit } from './types';

function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  if (vecA.length !== vecB.length) {
    return -1;
  }

  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SemanticSearchServiceOptions {
  store: SemanticIndexStore;
  embedder: Embedder;
  eventBus: EventBus;
}

export class SemanticSearchService {
  private store: SemanticIndexStore;
  private embedder: Embedder;
  private eventBus: EventBus;

  constructor(options: SemanticSearchServiceOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
    this.eventBus = options.eventBus;
  }

  async search(query: string, topK: number, runId: string): Promise<SemanticHit[]> {
    const startTime = Date.now();

    const queryEmbeddingResult = await this.embedder.embed({
      texts: [query],
      normalize: true,
    });

    if (!queryEmbeddingResult.embeddings || queryEmbeddingResult.embeddings.length === 0) {
      return [];
    }
    const queryVector = queryEmbeddingResult.embeddings[0];

    const candidates = this.store.getAllChunksWithEmbeddings();
    const candidateCount = candidates.length;

    const scoredCandidates = candidates.map((candidate) => {
      const score = cosineSimilarity(queryVector, candidate.vector);
      return {
        ...candidate,
        score,
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    const hits = scoredCandidates.slice(0, topK).map((hit) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { vector, ...rest } = hit;
      return rest;
    });

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

