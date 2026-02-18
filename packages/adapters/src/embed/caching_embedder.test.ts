import { describe, it, expect, vi } from 'vitest';
import { CachingEmbedder } from './caching_embedder';
import type { Embedder } from './embedder';

describe('CachingEmbedder', () => {
  it('caches embeddings for identical inputs', async () => {
    const underlying: Embedder = {
      embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 2, 3])),
      dims: () => 3,
      id: () => 'underlying',
    };

    const embedder = new CachingEmbedder(underlying);

    const first = await embedder.embedTexts(['a', 'b']);
    const second = await embedder.embedTexts(['a', 'b']);

    expect(first).toEqual(second);
    expect(underlying.embedTexts).toHaveBeenCalledTimes(1);
  });

  it('delegates dims() and wraps id()', () => {
    const underlying: Embedder = {
      embedTexts: vi.fn(async () => [[0]]),
      dims: () => 42,
      id: () => 'my-embedder',
    };

    const embedder = new CachingEmbedder(underlying);
    expect(embedder.dims()).toBe(42);
    expect(embedder.id()).toBe('cached(my-embedder)');
  });
});

