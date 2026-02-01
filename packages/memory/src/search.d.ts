import { MemoryStore } from './sqlite';
import { VectorMemoryBackend } from './vector';
import { MemorySearchRequest, MemorySearchResult } from './types';
import { Embedder } from '@orchestrator/adapters';
export interface MemorySearchServiceDependencies {
    memoryStore: MemoryStore;
    vectorBackend: VectorMemoryBackend;
    embedder: Embedder;
    repoId: string;
}
export declare class MemorySearchService {
    private readonly deps;
    constructor(deps: MemorySearchServiceDependencies);
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    private lexicalSearch;
    private vectorSearch;
    private hybridSearch;
    private entryToBaseHit;
    private hydrateVectorHits;
}
//# sourceMappingURL=search.d.ts.map