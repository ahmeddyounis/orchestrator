// packages/adapters/src/embed/local_hash_embedder.ts

import { createHash } from 'crypto';
import { Embedder } from './embedder';

export class LocalHashEmbedder implements Embedder {
  constructor(private readonly dimensions: number = 384) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const normalizedText = text.trim().toLowerCase();
      const hash = createHash('sha256').update(normalizedText).digest();

      const floatArray = new Array(this.dimensions).fill(0);
      for (let i = 0; i < this.dimensions; i++) {
        const hashIndex = i % hash.length;
        floatArray[i] = hash.readUInt8(hashIndex) / 255.0;
      }

      return this.l2Normalize(floatArray);
    });
  }

  dims(): number {
    return this.dimensions;
  }

  id(): string {
    return `local-hash:${this.dimensions}`;
  }

  private l2Normalize(arr: number[]): number[] {
    const sumOfSquares = arr.reduce((sum, val) => sum + val * val, 0);
    const norm = Math.sqrt(sumOfSquares);
    if (norm === 0) {
      return arr;
    }
    return arr.map((val) => val / norm);
  }
}
