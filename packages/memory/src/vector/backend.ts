// packages/memory/src/vector/backend.ts

export interface Vector {
  id: string;
  vector: number[];
  metadata?: object;
}

export interface VectorMemoryBackend {
  upsert(repoId: string, vectors: Vector[]): Promise<void>;
  query(repoId: string, vector: number[], topK: number): Promise<string[]>;
  wipeRepo(repoId: string): Promise<void>;
  isRepoEmpty(repoId: string): Promise<boolean>;
}