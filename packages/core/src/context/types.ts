import { ContextPack, ContextSignal } from '@orchestrator/repo';
import { MemoryEntry } from '@orchestrator/memory';

export interface FusionBudgets {
  maxRepoContextChars: number;
  maxMemoryChars: number;
  maxSignalsChars: number;
}

export interface FusedContextMetadata {
  repoItems: {
    path: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
  }[];
  memoryHits: {
    id: string;
    truncated: boolean;
  }[];
  signals: {
    type: string;
    truncated: boolean;
  }[];
}

export interface FusedContext {
  prompt: string;
  metadata: FusedContextMetadata;
}

export interface ContextFuser {
  fuse(inputs: {
    repoPack: ContextPack;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    budgets: FusionBudgets;
  }): FusedContext;
}
