import { ContextFuser, FusedContext, FusionBudgets } from './types';
import { ContextPack, ContextSignal } from '@orchestrator/repo';
import { MemoryEntry } from '@orchestrator/memory';
export declare class SimpleContextFuser implements ContextFuser {
  fuse(inputs: {
    repoPack: ContextPack;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    budgets: FusionBudgets;
    goal: string;
  }): FusedContext;
  private packRepoContext;
  private packMemory;
  private packSignals;
}
//# sourceMappingURL=fusion.d.ts.map
