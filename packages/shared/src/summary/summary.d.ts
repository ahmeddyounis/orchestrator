/**
 * Schema version for the run summary.
 *
 * @format
 */
export declare const RUN_SUMMARY_SCHEMA_VERSION = 1;
export interface RunSummary {
    schemaVersion: typeof RUN_SUMMARY_SCHEMA_VERSION;
    runId: string;
    command: string[];
    goal?: string;
    repoRoot: string;
    repoId?: string;
    startedAt: string;
    finishedAt: string;
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
        perProvider: Record<string, {
            total: number;
            details: Array<{
                model: string;
                promptTokens: number;
                completionTokens: number;
                cost: number;
            }>;
        }>;
        totals: {
            promptTokens: number;
            completionTokens: number;
            cost: number;
        };
    };
    artifacts: {
        manifestPath: string;
        tracePath: string;
        patchPaths?: string[];
        contextPaths?: string[];
        toolLogPaths?: string[];
    };
}
export declare class SummaryWriter {
    static write(summary: RunSummary, runDir: string): Promise<string>;
}
//# sourceMappingURL=summary.d.ts.map