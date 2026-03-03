import type { Config, RunSummary, ToolPolicy } from '@orchestrator/shared';
import type { CostTracker } from '../../cost/tracker';
import { DEFAULT_BUDGET } from '../../config/budget';
import type { RunArtifacts } from './types';

export interface RunSummaryBuildInput {
  runId: string;
  goal: string;
  startTime: number;
  status: 'success' | 'failure';
  thinkLevel: 'L0' | 'L1' | 'L2' | 'L3';
  runResult: {
    stopReason?: string;
    filesChanged?: string[];
    patchPaths?: string[];
    verification?: {
      enabled: boolean;
      passed: boolean;
      failedChecks?: string[];
      reportPaths?: string[];
    };
  };
  artifacts: Pick<RunArtifacts, 'root' | 'trace' | 'summary' | 'patchesDir' | 'manifest'>;
  escalationCount?: number;
  l3Metadata?: RunSummary['l3'];
}

export class RunSummaryService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
    private readonly deps: {
      costTracker?: CostTracker;
      toolPolicy?: ToolPolicy;
    } = {},
  ) {}

  build(input: RunSummaryBuildInput): RunSummary {
    const finishedAt = new Date();
    const patchStats = input.runResult.filesChanged
      ? {
          filesChanged: input.runResult.filesChanged.length,
          linesAdded: 0, // Note: Not easily available, default to 0
          linesDeleted: 0, // Note: Not easily available, default to 0
          finalDiffPath:
            input.runResult.patchPaths && input.runResult.patchPaths.length > 0
              ? input.runResult.patchPaths[input.runResult.patchPaths.length - 1]
              : undefined,
        }
      : undefined;

    const costSummary = this.deps.costTracker?.getSummary();

    return {
      schemaVersion: 1,
      runId: input.runId,
      command: ['run', input.goal],
      goal: input.goal,
      repoRoot: this.repoRoot,
      repoId: this.repoRoot, // Consider a more stable repo ID
      startedAt: new Date(input.startTime).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - input.startTime,
      status: input.status,
      stopReason: input.runResult.stopReason,
      thinkLevel: parseInt(input.thinkLevel.slice(1), 10),
      escalated: (input.escalationCount ?? 0) > 0,
      selectedProviders: {
        planner: this.config.defaults?.planner || 'default',
        executor: this.config.defaults?.executor || 'default',
        reviewer: this.config.defaults?.reviewer,
      },
      budgets: {
        maxIterations: this.config.budget?.iter ?? DEFAULT_BUDGET.iter,
        maxToolRuns: 999, // Not yet implemented
        maxWallTimeMs: this.config.budget?.time ?? DEFAULT_BUDGET.time,
        maxCostUsd: this.config.budget?.cost,
      },
      patchStats,
      verification: input.runResult.verification
        ? {
            enabled: input.runResult.verification.enabled,
            passed: input.runResult.verification.passed,
            failedChecks: input.runResult.verification.failedChecks?.length,
            reportPaths: input.runResult.verification.reportPaths,
          }
        : undefined,
      tools: {
        enabled: this.deps.toolPolicy !== undefined,
        runs: [], // Not yet implemented
      },
      memory: {
        enabled: this.config.memory?.enabled ?? false,
        // Deferring detailed stats for now
      },
      indexing: {
        enabled: this.config.indexing?.enabled ?? false,
        autoUpdated: false, // Deferring detailed stats for now
      },
      costs: {
        perProvider: costSummary?.providers || {},
        totals: {
          inputTokens: costSummary?.total.inputTokens || 0,
          outputTokens: costSummary?.total.outputTokens || 0,
          totalTokens: costSummary?.total.totalTokens || 0,
          estimatedCostUsd: costSummary?.total.estimatedCostUsd ?? null,
        },
      },
      artifacts: {
        manifestPath: input.artifacts.manifest,
        tracePath: input.artifacts.trace,
        patchPaths: input.runResult.patchPaths,
        contextPaths: [], // Not yet implemented
        toolLogPaths: [], // Not yet implemented
      },
      telemetry: {
        enabled: this.config.telemetry?.enabled ?? false,
        mode: this.config.telemetry?.mode ?? 'local',
      },
      l3: input.l3Metadata,
    };
  }
}
