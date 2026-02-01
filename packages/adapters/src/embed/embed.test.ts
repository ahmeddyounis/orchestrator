// packages/adapters/src/embed/embed.test.ts

import { LocalHashEmbedder } from './local_hash_embedder';

describe('LocalHashEmbedder', () => {
  it('should be deterministic', async () => {
    const embedder = new LocalHashEmbedder();
    const embeddings1 = await embedder.embedTexts(['hello world']);
    const embeddings2 = await embedder.embedTexts(['hello world']);
    expect(embeddings1).toEqual(embeddings2);
  });

  it('should have the correct dimensions', async () => {
    const embedder = new LocalHashEmbedder(128);
    const embeddings = await embedder.embedTexts(['hello world']);
    expect(embeddings[0]).toHaveLength(128);
    expect(embedder.dims()).toBe(128);
  });

  it('should produce different embeddings for different texts', async () => {
    const embedder = new LocalHashEmbedder();
    const embeddings1 = await embedder.embedTexts(['hello world']);
    const embeddings2 = await embedder.embedTexts(['hello there']);
    expect(embeddings1).not.toEqual(embeddings2);
  });

  it('should produce normalized vectors', async () => {
    const embedder = new LocalHashEmbedder();
    const embeddings = await embedder.embedTexts(['hello world']);
    const norm = Math.sqrt(embeddings[0].reduce((sum, val) => sum + val * val, 0));
    expect(norm).toBeCloseTo(1);
  });
});
