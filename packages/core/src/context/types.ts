import { ContextPack, ContextSignal } from '@orchestrator/repo';
import { MemoryEntry } from '@orchestrator/memory';
import type { ContextStackFrame } from '@orchestrator/shared';

export interface FusionBudgets {
  maxRepoContextChars: number;
  maxMemoryChars: number;
  maxSignalsChars: number;
  maxContextStackChars: number;
  maxContextStackFrames: number;
}

export interface FusedContextMetadata {
  contextStack: {
    kind: string;
    ts: string;
    runId?: string;
    truncated: boolean;
  }[];
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
    goal: string;
    repoPack: ContextPack;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    contextStack?: ContextStackFrame[];
    budgets: FusionBudgets;
  }): FusedContext;
}
