import { Config, ToolPolicy } from '@orchestrator/shared';
import { GitService } from '@orchestrator/repo';
import { ProviderRegistry } from './registry';
import { UserInterface } from '@orchestrator/exec';
import { CostTracker } from './cost/tracker';
export interface OrchestratorOptions {
    config: Config;
    git: GitService;
    registry: ProviderRegistry;
    repoRoot: string;
    costTracker?: CostTracker;
    toolPolicy?: ToolPolicy;
    ui?: UserInterface;
}
export interface RunResult {
    status: 'success' | 'failure';
    runId: string;
    summary?: string;
    filesChanged?: string[];
    patchPaths?: string[];
    stopReason?: 'success' | 'budget_exceeded' | 'repeated_failure' | 'invalid_output' | 'error' | 'non_improving';
    recommendations?: string;
    memory?: Config['memory'];
    verification?: {
        enabled: boolean;
        passed: boolean;
        summary?: string;
        failedChecks?: string[];
        reportPaths?: string[];
    };
    lastFailureSignature?: string;
}
export interface RunOptions {
    thinkLevel: 'L0' | 'L1' | 'L2';
    runId?: string;
}
export declare class Orchestrator {
    private config;
    private git;
    private registry;
    private repoRoot;
    private costTracker?;
    private toolPolicy?;
    private ui?;
    private suppressEpisodicMemoryWrite;
    constructor(options: OrchestratorOptions);
    run(goal: string, options: RunOptions): Promise<RunResult>;
    private autoUpdateIndex;
    private shouldWriteEpisodicMemory;
    private resolveMemoryDbPath;
    private toArtifactRelPath;
    private collectArtifactPaths;
    private writeEpisodicMemory;
    runL0(goal: string, runId: string): Promise<RunResult>;
    runL1(goal: string, runId: string): Promise<RunResult>;
    private searchMemoryHits;
    runL2(goal: string, runId: string): Promise<RunResult>;
}
//# sourceMappingURL=orchestrator.d.ts.map