import { CostTracker } from '../cost/tracker';

export interface Budget {
  maxIterations: number;
  maxToolRuns: number;
  maxWallTimeMs: number;
  maxCostUsd?: number;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'done' | 'failed';
}

export interface Plan {
  steps: PlanStep[];
}

export type Checkpoint = Record<string, unknown>;
export type Artifact = Record<string, unknown>;

export interface RunState {
  runId: string;
  repoRoot: string;
  startedAt: number;
  thinkLevel?: string; // e.g. "low", "high"
  selectedProviders: string[];
  iteration: number;
  toolRuns: number;
  checkpoints: Checkpoint[];
  lastError?: Error | string;
  artifacts: Artifact[];
  costTracker: CostTracker;
}
