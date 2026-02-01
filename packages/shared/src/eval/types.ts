// packages/shared/src/eval/types.ts

export const EVAL_SCHEMA_VERSION = 1;

export interface EvalSuite {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  name: string;
  description?: string;
  tasks: EvalTask[];
}

export interface EvalTask {
  id: string;
  title: string;
  repo: {
    fixturePath: string;
    ref?: string;
  };
  goal: string;
  command: 'run' | 'fix';
  thinkLevel?: 'L0' | 'L1' | 'L2' | 'auto';
  budgets?: {
    iter?: number;
    tool?: number;
    timeMs?: number;
    costUsd?: number;
  };
  verification: {
    enabled: boolean;
    mode: 'auto' | 'custom';
    scope?: 'targeted' | 'full';
    steps?: {
      name: string;
      command: string;
      required?: boolean;
    }[];
  };
  tools: {
    enabled: boolean;
    requireConfirmation: boolean;
    allowNetwork?: boolean;
  };
  successCriteria: Criterion[];
  tags?: string[];
}

export interface EvalResult {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  suiteName: string;
  startedAt: number;
  finishedAt: number;
  tasks: EvalTaskResult[];
  aggregates: EvalAggregates;
}

export interface EvalTaskResult {
  taskId: string;
  status: 'pass' | 'fail' | 'error' | 'skipped';
  runId?: string;
  durationMs: number;
  stopReason?: string;
  verificationPassed?: boolean;
  metrics?: {
    iterations?: number;
    toolRuns?: number;
    tokens?: number;
    estimatedCostUsd?: number;
    filesChanged?: number;
    linesChanged?: number;
  };
  artifacts?: {
    runDir?: string;
    summaryPath?: string;
    finalDiffPath?: string;
  };
  failure?: {
    kind: string;
    message: string;
  };
  criteria?: Array<{
    criterion: Criterion;
    result: CriterionResult;
  }>;
}

export interface Criterion {
  name: 'verification_pass' | 'file_contains' | 'script_exit';
  details?: any;
}

export interface CriterionResult {
  passed: boolean;
  message?: string;
  details?: unknown;
}

export interface EvalAggregates {
  totalTasks: number;
  passed: number;
  failed: number;
  skipped: number;
  error: number;
  totalDurationMs: number;
  totalCostUsd?: number;
  avgDurationMs: number;
  passRate: number;
}

export interface EvalComparison {
  passRateDelta: number;
  avgDurationDelta: number;
  totalCostDelta: number;
}
