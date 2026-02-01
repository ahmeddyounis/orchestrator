import type { MemoryEntry, MemoryEntryType, MemoryStatus, LexicalHit } from '../types';
export interface LexicalSearchOptions {
    topK?: number;
}
export interface MemoryStore {
    init(dbPath: string): void;
    upsert(entry: MemoryEntry): void;
    search(repoId: string, query: string, options: LexicalSearchOptions): LexicalHit[];
    get(id: string): MemoryEntry | null;
    list(repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[];
    listEntriesForRepo(repoId: string): MemoryEntry[];
    listEntriesWithoutVectors(repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[];
    markVectorUpdated(id: string): void;
    updateStaleFlag(id: string, stale: boolean): void;
    wipe(repoId: string): void;
    status(repoId: string): MemoryStatus;
    close(): void;
}
export declare function createMemoryStore(): MemoryStore;
//# sourceMappingURL=store.d.ts.map