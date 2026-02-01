// packages/memory/src/vector/noop.ts

import { Vector, VectorMemoryBackend } from './backend';

export class NoopVectorMemoryBackend implements VectorMemoryBackend {
  async upsert(repoId: string, vectors: Vector[]): Promise<void> {
    return;
  }

  async query(repoId: string, vector: number[], topK: number): Promise<string[]> {
    return [];
  }

  async wipeRepo(repoId: string): Promise<void> {
    return;
  }

  async isRepoEmpty(repoId: string): Promise<boolean> {
    return true;
  }
}
