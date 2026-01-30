import { EpisodicMemory, Memory, PatchStats, ProceduralMemory, RepoState, RunSummary, ToolRunMeta } from './types';
import { ToolRunResult } from '@orchestrator/shared';
import { EventBus } from '../registry';
import { VerificationReport } from '../verify/types';
export declare class MemoryWriter {
    private eventBus?;
    private runId;
    constructor(eventBus?: EventBus, runId?: string);
    private logRedactions;
    extractEpisodic(runSummary: RunSummary, repoState: RepoState, verificationReport?: VerificationReport, patchStats?: PatchStats): Promise<EpisodicMemory>;
    extractProcedural(toolRunMeta: ToolRunMeta, toolRunResult: ToolRunResult, repoState: RepoState): Promise<ProceduralMemory | null>;
    private generateTitle;
    getMemoryStore(): Map<string, Memory>;
}
export * from './reconciler';
//# sourceMappingURL=index.d.ts.map