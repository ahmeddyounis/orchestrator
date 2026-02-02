import { MemoryStore } from './sqlite';
import { VectorMemoryBackend, VectorQueryResult } from './vector';
import {
  MemorySearchRequest,
  MemorySearchResult,
  LexicalHit,
  VectorHit,
  MemoryEntry,
  BaseHit,
} from './types';
import { Embedder } from '@orchestrator/adapters';
import { MemoryError } from '@orchestrator/shared';
import { rerankHybrid } from './ranking';

export interface MemorySearchServiceDependencies {
  memoryStore: MemoryStore;
  vectorBackend: VectorMemoryBackend;
  embedder: Embedder;
  repoId: string;
}

export class MemorySearchService {
  constructor(private readonly deps: MemorySearchServiceDependencies) {}

  async search(request: MemorySearchRequest): Promise<MemorySearchResult> {
    switch (request.mode) {
      case 'lexical':
        return this.lexicalSearch(request);
      case 'vector':
        return this.vectorSearch(request);
      case 'hybrid':
        return this.hybridSearch(request);
      default:
        throw new MemoryError(`Unsupported search mode: ${request.mode}`);
    }
  }

  private async lexicalSearch(request: MemorySearchRequest): Promise<MemorySearchResult> {
    const { query, topKFinal } = request;
    const { memoryStore, repoId } = this.deps;

    const hits = memoryStore
      .search(repoId, query, {
        topK: topKFinal,
      })
      .filter((hit) => hit.integrityStatus !== 'blocked');

    return {
      methodUsed: 'lexical',
      hits,
      events: [],
    };
  }

  private async vectorSearch(request: MemorySearchRequest): Promise<MemorySearchResult> {
    const { query, topKFinal, topKVector = 10 } = request;
    const { vectorBackend, embedder, repoId } = this.deps;

    const queryVectors = await embedder.embedTexts([query]);
    const queryVector = queryVectors[0];
    const vectorHits = await vectorBackend.query(
      {},
      repoId,
      new Float32Array(queryVector),
      topKVector,
    );

    const hits: VectorHit[] = await this.hydrateVectorHits(vectorHits);

    return {
      methodUsed: 'vector',
      hits: hits.slice(0, topKFinal),
      events: [],
    };
  }

  private async hybridSearch(request: MemorySearchRequest): Promise<MemorySearchResult> {
    const {
      query,
      topKLexical = 10,
      topKVector = 10,
      fallbackToLexicalOnVectorError,
      topKFinal,
    } = request;
    const { embedder, repoId, vectorBackend } = this.deps;
    const events: string[] = [];

    const lexicalResult = await this.lexicalSearch({
      ...request,
      mode: 'lexical',
      topKFinal: topKLexical,
    });

    let vectorHits: VectorHit[] = [];
    try {
      const queryVectors = await embedder.embedTexts([query]);
      const queryVector = queryVectors[0];
      const rawVectorHits = await vectorBackend.query(
        {},
        repoId,
        new Float32Array(queryVector),
        topKVector,
      );
      vectorHits = await this.hydrateVectorHits(rawVectorHits);
    } catch (error: unknown) {
      events.push('VectorSearchFailed');
      const message = error instanceof Error ? error.message : String(error);
      if (fallbackToLexicalOnVectorError) {
        events.push('VectorSearchFailedFallback');
        return {
          ...lexicalResult,
          methodUsed: 'lexical', // It was hybrid, but fell back
          events,
        };
      } else {
        throw new MemoryError(`Vector search failed: ${message}`, { cause: error });
      }
    }

    const lexicalHits = lexicalResult.hits as LexicalHit[];

    const combined = rerankHybrid(lexicalHits, vectorHits, request);

    return {
      methodUsed: 'hybrid',
      hits: combined.slice(0, topKFinal),
      events,
    };
  }

  private entryToBaseHit(entry: MemoryEntry): BaseHit {
    return {
      id: entry.id,
      type: entry.type,
      stale: entry.stale ?? false,
      title: entry.title,
      content: entry.content,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      integrityStatus: entry.integrityStatus,
      integrityReasonsJson: entry.integrityReasonsJson,
    };
  }

  private async hydrateVectorHits(vectorHits: VectorQueryResult[]): Promise<VectorHit[]> {
    const { memoryStore } = this.deps;
    const hydrated: VectorHit[] = [];

    for (const hit of vectorHits) {
      const entry = memoryStore.get(hit.id);
      if (entry && entry.integrityStatus !== 'blocked') {
        hydrated.push({
          ...this.entryToBaseHit(entry),
          vectorScore: hit.score,
        });
      }
    }
    return hydrated;
  }
}
