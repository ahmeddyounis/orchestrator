import { ToolClassification, ToolRunRequest } from '@orchestrator/shared';
export interface RepoState {
    gitSha: string;
    repoId?: string;
    memoryDbPath?: string;
    artifactPaths?: string[];
}
export interface ToolRunMeta {
    request: ToolRunRequest;
    classification: ToolClassification;
    toolRunId: string;
}
export interface ProceduralMemory {
    type: 'procedural';
    id: string;
    title: string;
    content: string;
    gitSha: string;
    evidence: {
        command: string;
        exitCode: number;
        durationMs: number;
        toolRunId: string;
    };
    createdAt: Date;
    updatedAt: Date;
}
export interface PatchStats {
    filesChanged: string[];
    insertions: number;
    deletions: number;
}
export interface EpisodicMemory {
    type: 'episodic';
    id: string;
    title: string;
    content: string;
    gitSha: string;
    evidence: {
        artifactPaths: string[];
        failureSignature?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}
export type Memory = ProceduralMemory | EpisodicMemory;
//# sourceMappingURL=types.d.ts.map