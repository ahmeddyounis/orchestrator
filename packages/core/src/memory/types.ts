import { ToolClassification, ToolRunRequest } from '@orchestrator/shared';

export interface RepoState {
  gitSha: string;
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
