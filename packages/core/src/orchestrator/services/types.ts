import type { Config, JsonlLogger } from '@orchestrator/shared';
import type { EventBus } from '../../registry';

/**
 * Artifacts created for a run
 */
export interface RunArtifacts {
  root: string;
  trace: string;
  summary: string;
  patchesDir: string;
  manifest: string;
}

/**
 * Runtime context for a run
 */
export interface RunContext {
  runId: string;
  goal: string;
  startTime: number;
  artifacts: RunArtifacts;
  logger: JsonlLogger;
  eventBus: EventBus;
  config: Config;
  repoRoot: string;
}

/**
 * Budget configuration for a run
 */
export interface BudgetConfig {
  time?: number;
  iter?: number;
  cost?: number;
}

/**
 * Step execution state tracking
 */
export interface StepExecutionState {
  stepsCompleted: number;
  patchPaths: string[];
  contextPaths: string[];
  touchedFiles: Set<string>;
  consecutiveInvalidDiffs: number;
  consecutiveApplyFailures: number;
  lastApplyErrorHash: string;
}

/**
 * Creates a fresh step execution state
 */
export function createStepExecutionState(): StepExecutionState {
  return {
    stepsCompleted: 0,
    patchPaths: [],
    contextPaths: [],
    touchedFiles: new Set<string>(),
    consecutiveInvalidDiffs: 0,
    consecutiveApplyFailures: 0,
    lastApplyErrorHash: '',
  };
}
