import type { RunSummary } from '@orchestrator/shared';

export interface CriterionResult {
  passed: boolean;
  message?: string;
  details?: unknown;
}

export type CriterionEvaluator = (summary: RunSummary, details?: any) => Promise<CriterionResult>;

export interface Criterion {
  name: 'verification_pass' | 'file_contains' | 'script_exit';
  details?: any;
}

export interface EvalTaskResult {
  taskId: string;
  runId: string;
  // ... other properties
  criteria: Array<{
    criterion: Criterion;
    result: CriterionResult;
  }>;
}
