import { Embedder, Embedding } from './embedder';
import { objectHash } from 'ohash';

export class CachingEmbedder implements Embedder {
  private cache: Map<string, Embedding[]> = new Map();

  constructor(private readonly underlyingEmbedder: Embedder) {}

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    const cacheKey = objectHash(texts);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const embeddings = await this.underlyingEmbedder.embedTexts(texts);
    this.cache.set(cacheKey, embeddings);
    return embeddings;
  }
}
