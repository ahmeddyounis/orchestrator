import type { Config, RunSummary } from '@orchestrator/shared';
import { SummaryWriter, updateManifest } from '@orchestrator/shared';
import type { GitService } from '@orchestrator/repo';
import type { EventBus } from '../../registry';
import { PatchStore } from '../../exec/patch_store';
import { RunMemoryService } from './run-memory';
import { RunSummaryService } from './run-summary';
import type { RunArtifacts } from './types';
import type { VerificationReport } from '../../verify/types';

export type RunStopReason =
  | 'success'
  | 'budget_exceeded'
  | 'repeated_failure'
  | 'invalid_output'
  | 'error'
  | 'non_improving';

export interface FinalizedRunResult {
  status: 'success' | 'failure';
  runId: string;
  summary?: string;
  filesChanged?: string[];
  patchPaths?: string[];
  stopReason?: RunStopReason;
  recommendations?: string;
  memory?: Config['memory'];
  verification?: {
    enabled: boolean;
    passed: boolean;
    summary?: string;
    failedChecks?: string[];
    reportPaths?: string[];
  };
}

export interface RunFinalizerInput {
  runId: string;
  goal: string;
  startTime: number;
  status: 'success' | 'failure';
  thinkLevel: 'L1' | 'L2' | 'L3';
  stopReason: RunStopReason | undefined;
  summaryMsg: string;
  artifacts: Pick<RunArtifacts, 'root' | 'trace' | 'summary' | 'patchesDir' | 'manifest'>;
  baseRef: string;
  patchPaths: string[];
  contextPaths: string[];
  touchedFiles: Set<string>;
  eventBus: EventBus;
  escalationCount?: number;
  l3Metadata?: RunSummary['l3'];
  verification?: FinalizedRunResult['verification'];
  verificationPaths?: string[];
  verificationReport?: VerificationReport;
  extraArtifactPaths?: string[];
  suppressEpisodicMemoryWrite?: boolean;
}

export class RunFinalizerService {
  constructor(
    private readonly config: Config,
    private readonly git: GitService,
    private readonly runSummaryService: RunSummaryService,
    private readonly runMemoryService: RunMemoryService,
  ) {}

  async finalize(input: RunFinalizerInput): Promise<FinalizedRunResult> {
    const { eventBus } = input;

    if (input.stopReason) {
      await eventBus.emit({
        type: 'RunStopped',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: input.runId,
        payload: { reason: input.stopReason, details: input.summaryMsg },
      });
    }

    await eventBus.emit({
      type: 'RunFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: input.runId,
      payload: { status: input.status, summary: input.summaryMsg },
    });

    const finishedAt = new Date().toISOString();
    try {
      const finalDiff = await this.git.diff(input.baseRef);
      if (finalDiff.trim().length > 0) {
        const patchStore = new PatchStore(input.artifacts.patchesDir, input.artifacts.manifest);
        const finalDiffPath = await patchStore.saveFinalDiff(finalDiff);
        if (!input.patchPaths.includes(finalDiffPath)) input.patchPaths.push(finalDiffPath);
      }
    } catch {
      // Non-fatal: artifact generation should not fail the run.
    }

    try {
      await updateManifest(input.artifacts.manifest, (manifest) => {
        manifest.finishedAt = finishedAt;
        manifest.patchPaths = [...manifest.patchPaths, ...input.patchPaths];
        manifest.contextPaths = [...(manifest.contextPaths ?? []), ...input.contextPaths];
        if (input.verificationPaths && input.verificationPaths.length > 0) {
          manifest.verificationPaths = [
            ...(manifest.verificationPaths ?? []),
            ...input.verificationPaths,
          ];
        }
      });
    } catch {
      // Non-fatal: artifact updates should not fail the run.
    }

    const verification = input.verification ?? {
      enabled: false,
      passed: false,
      summary: 'Not run',
    };

    const runResult: FinalizedRunResult = {
      status: input.status,
      runId: input.runId,
      summary: input.summaryMsg,
      filesChanged: Array.from(input.touchedFiles),
      patchPaths: input.patchPaths,
      stopReason: input.stopReason,
      memory: this.config.memory,
      verification,
    };

    const summary = this.runSummaryService.build({
      runId: input.runId,
      goal: input.goal,
      startTime: input.startTime,
      status: input.status,
      thinkLevel: input.thinkLevel,
      runResult,
      artifacts: input.artifacts,
      escalationCount: input.escalationCount,
      l3Metadata: input.l3Metadata,
    });
    await SummaryWriter.write(summary, input.artifacts.root);

    await this.runMemoryService.writeEpisodicMemory(
      summary,
      {
        artifactsRoot: input.artifacts.root,
        patchPaths: input.patchPaths,
        extraArtifactPaths: [...input.contextPaths, ...(input.extraArtifactPaths ?? [])],
        verificationReport: input.verificationReport,
      },
      {
        eventBus,
        suppress: input.suppressEpisodicMemoryWrite,
      },
    );

    return runResult;
  }
}
