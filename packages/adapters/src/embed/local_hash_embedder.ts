// packages/adapters/src/embed/local_hash_embedder.ts
import { Embedder } from './embedder';
import { createHash } from 'crypto';

export class LocalHashEmbedder implements Embedder {
  constructor(private readonly dimensions: number = 256) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedText(text));
  }

  dims(): number {
    return this.dimensions;
  }

  id(): string {
    return `local-hash-dim${this.dimensions}`;
  }

  private embedText(text: string): number[] {
    const hash = createHash('sha256').update(text).digest();
    const vector: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      const byteIndex = i % hash.length;
      const bitIndex = Math.floor(i / hash.length) % 8;
      const byte = hash[byteIndex];
      const bit = (byte >> bitIndex) & 1;
      vector.push(bit);
    }
    return vector;
  }
}
