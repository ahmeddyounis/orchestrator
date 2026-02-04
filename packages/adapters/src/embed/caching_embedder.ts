import { Embedder } from './embedder';
import { LRUCache } from '@orchestrator/shared';
import { hash } from 'ohash';

/** Maximum number of embedding results to cache (LRU eviction) */
const EMBEDDING_CACHE_MAX_SIZE = 500;

export class CachingEmbedder implements Embedder {
  private cache: LRUCache<string, number[][]> = new LRUCache(EMBEDDING_CACHE_MAX_SIZE);

  constructor(private readonly underlyingEmbedder: Embedder) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    const cacheKey = hash(texts);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const embeddings = await this.underlyingEmbedder.embedTexts(texts);
    this.cache.set(cacheKey, embeddings);
    return embeddings;
  }

  dims(): number {
    return this.underlyingEmbedder.dims();
  }

  id(): string {
    return `cached(${this.underlyingEmbedder.id()})`;
  }
}
