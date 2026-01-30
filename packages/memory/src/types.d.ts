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
//# sourceMappingURL=types.d.ts.map
