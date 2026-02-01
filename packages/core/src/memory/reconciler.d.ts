import type { MemoryStore } from '@orchestrator/memory';
import type { Index } from '@orchestrator/repo';
export declare function reconcileMemoryStaleness(repoId: string, index: Index, memoryStore: MemoryStore): Promise<{
    markedStaleCount: number;
    clearedStaleCount: number;
}>;
//# sourceMappingURL=reconciler.d.ts.map