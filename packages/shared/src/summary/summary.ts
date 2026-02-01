import path from 'node:path';
import { atomicWrite } from '../fs/io.js';
import { redactForLogs } from '../redaction';

/**
 * Schema version for the run summary.
 *
 * @format
 */

export const RUN_SUMMARY_SCHEMA_VERSION = 1;

export interface RunSummary {
  schemaVersion: typeof RUN_SUMMARY_SCHEMA_VERSION;
  runId: string;
  command: string[];
  goal?: string;
  repoRoot: string;
  repoId?: string;
  startedAt: string; // ISO 8601
  finishedAt: string; // ISO 8601
  durationMs: number;
  status: 'success' | 'failure';
  stopReason?: string;
  thinkLevel: number;
  selectedProviders: {
    planner: string;
    executor: string;
    reviewer?: string;
  };
  budgets: {
    maxIterations: number;
    maxToolRuns: number;
    maxWallTimeMs: number;
    maxCostUsd?: number;
  };
  patchStats?: {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    finalDiffPath?: string;
  };
  verification?: {
    enabled: boolean;
    passed?: boolean;
    failedChecks?: number;
    reportPaths?: string[];
  };
  tools: {
    enabled: boolean;
    runs: Array<{
      command: string;
      exitCode: number;
      durationMs: number;
      stdoutPath?: string;
      stderrPath?: string;
      truncated: boolean;
    }>;
  };
  memory: {
    enabled: boolean;
    hitsUsedCount?: number;
    writesCount?: number;
    staleHitsCount?: number;
  };
  indexing?: {
    enabled: boolean;
    autoUpdated?: boolean;
    drift?: boolean;
    indexPath?: string;
  };
  costs: {
    perProvider: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number | null;
      }
    >;
    totals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
    };
  };
  artifacts: {
    manifestPath: string;
    tracePath: string;
    patchPaths?: string[];
    contextPaths?: string[];
    toolLogPaths?: string[];
  };
  telemetry?: {
    enabled: boolean;
    mode: 'local' | 'remote';
  };
}

export class SummaryWriter {
  static async write(summary: RunSummary, runDir: string): Promise<string> {
    const summaryPath = path.join(runDir, 'summary.json');
    // The summary object can be large, so we stringify it with indentation
    // to make it human-readable.
    const redactedSummary = redactForLogs(summary);
    const summaryJson = JSON.stringify(redactedSummary, null, 2);
    await atomicWrite(summaryPath, summaryJson);
    return summaryPath;
  }
}
