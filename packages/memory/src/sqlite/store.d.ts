import { RerankOptions } from '../ranking';
import type { MemoryEntry, MemoryEntryType, MemoryStatus } from '../types';
export interface MemoryStore {
  init(dbPath: string): void;
  upsert(entry: MemoryEntry): void;
  search(
    repoId: string,
    query: string,
    options: RerankOptions & {
      topK?: number;
    },
  ): MemoryEntry[];
  get(id: string): MemoryEntry | null;
  list(repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[];
  listEntriesForRepo(repoId: string): MemoryEntry[];
  updateStaleFlag(id: string, stale: boolean): void;
  wipe(repoId: string): void;
  status(repoId: string): MemoryStatus;
  close(): void;
}
export declare function createMemoryStore(): MemoryStore;
//# sourceMappingURL=store.d.ts.map
