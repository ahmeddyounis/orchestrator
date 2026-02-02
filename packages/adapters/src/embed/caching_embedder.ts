import { Embedder } from './embedder';
import { hash } from 'ohash';

export class CachingEmbedder implements Embedder {
  private cache: Map<string, number[][]> = new Map();

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
