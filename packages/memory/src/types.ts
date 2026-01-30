
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
