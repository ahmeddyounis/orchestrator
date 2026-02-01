export type MemoryEntryType = 'procedural' | 'episodic' | 'semantic';
export interface MemoryEntry {
    id: string;
    repoId: string;
    type: MemoryEntryType;
    title: string;
    content: string;
    evidenceJson?: string;
    gitSha?: string;
    fileRefsJson?: string;
    fileHashesJson?: string;
    stale?: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface MemoryStatus {
    entryCounts: {
        procedural: number;
        episodic: number;
        semantic: number;
        total: number;
    };
    staleCount: number;
    lastUpdatedAt: number | null;
}
export interface ProceduralMemoryQuery {
    titleContains?: string;
}
export type ProceduralMemoryEntry = MemoryEntry;
export interface ProceduralMemory {
    find(queries: ProceduralMemoryQuery[], limit: number): Promise<ProceduralMemoryEntry[][]>;
}
export type MemorySearchMode = 'lexical' | 'vector' | 'hybrid';
export interface MemorySearchRequest {
    query: string;
    mode: MemorySearchMode;
    topKLexical?: number;
    topKVector?: number;
    topKFinal: number;
    staleDownrank?: boolean;
    fallbackToLexicalOnVectorError?: boolean;
    proceduralBoost?: boolean;
    episodicBoostFailureSignature?: string;
}
export interface BaseHit {
    id: string;
    type: MemoryEntryType;
    stale: boolean;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}
export interface LexicalHit extends BaseHit {
    lexicalScore: number;
}
export interface VectorHit extends BaseHit {
    vectorScore: number;
}
export interface HybridHit extends LexicalHit, VectorHit {
    combinedScore: number;
}
export type MemoryHit = LexicalHit | VectorHit | HybridHit;
export interface MemorySearchResult {
    methodUsed: MemorySearchMode;
    hits: MemoryHit[];
    events: string[];
}
//# sourceMappingURL=types.d.ts.map