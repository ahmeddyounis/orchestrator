import { GitService, PatchApplier } from '@orchestrator/repo';
import { Config } from '@orchestrator/shared';
import { EventBus } from '../registry';
export interface ConfirmationProvider {
    confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean>;
}
export interface ApplyResult {
    success: boolean;
    error?: string;
    filesChanged?: string[];
}
export declare class ExecutionService {
    private eventBus;
    private git;
    private applier;
    private runId;
    private repoRoot;
    private config?;
    private confirmationProvider?;
    constructor(eventBus: EventBus, git: GitService, applier: PatchApplier, runId: string, repoRoot: string, config?: Config | undefined, confirmationProvider?: ConfirmationProvider | undefined);
    applyPatch(patchText: string, description: string): Promise<ApplyResult>;
}
//# sourceMappingURL=service.d.ts.map