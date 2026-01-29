import { ProviderCapabilities } from './llm';

export interface BaseEvent {
  schemaVersion: number;
  timestamp: string;
  runId: string;
  type: string;
}

export interface RunStarted extends BaseEvent {
  type: 'RunStarted';
  payload: {
    taskId: string;
    goal: string;
  };
}

export interface PlanCreated extends BaseEvent {
  type: 'PlanCreated';
  payload: {
    planSteps: string[];
    // Can expand with more details as needed
  };
}

export interface ContextBuilt extends BaseEvent {
  type: 'ContextBuilt';
  payload: {
    fileCount: number;
    tokenEstimate: number;
  };
}

export interface PatchProposed extends BaseEvent {
  type: 'PatchProposed';
  payload: {
    filePaths: string[];
    diffPreview: string; // potentially truncated
  };
}

export interface PatchApplied extends BaseEvent {
  type: 'PatchApplied';
  payload: {
    filesChanged: string[];
    success: boolean;
  };
}

export interface ToolRun extends BaseEvent {
  type: 'ToolRun';
  payload: {
    toolName: string;
    input: unknown;
    output: unknown;
    durationMs: number;
  };
}

export interface VerifyResult extends BaseEvent {
  type: 'VerifyResult';
  payload: {
    command: string;
    exitCode: number;
    passed: boolean;
    stdout: string;
    stderr: string;
  };
}

export interface RunFinished extends BaseEvent {
  type: 'RunFinished';
  payload: {
    status: 'success' | 'failure' | 'cancelled';
    summary?: string;
  };
}

export interface MemoryWrite extends BaseEvent {
  type: 'MemoryWrite';
  payload: {
    key: string;
    value: unknown; // or string if it's strictly text
  };
}

export interface ConfirmationRequested extends BaseEvent {
  type: 'ConfirmationRequested';
  payload: {
    action: string;
    details?: string;
    defaultNo: boolean;
  };
}

export interface ConfirmationResolved extends BaseEvent {
  type: 'ConfirmationResolved';
  payload: {
    approved: boolean;
    autoResolved: boolean; // True if resolved via flag (yes/no) without prompt
  };
}

export interface ProviderSelected extends BaseEvent {
  type: 'ProviderSelected';
  payload: {
    role: 'planner' | 'executor' | 'reviewer';
    providerId: string;
    capabilities: ProviderCapabilities;
  };
}

export interface ProviderRequestStarted extends BaseEvent {
  type: 'ProviderRequestStarted';
  payload: {
    provider: string;
    model: string;
  };
}

export interface ProviderRequestFinished extends BaseEvent {
  type: 'ProviderRequestFinished';
  payload: {
    provider: string;
    durationMs: number;
    success: boolean;
    error?: string;
    retries: number;
  };
}

export type OrchestratorEvent =
  | RunStarted
  | PlanCreated
  | ContextBuilt
  | PatchProposed
  | PatchApplied
  | ToolRun
  | VerifyResult
  | RunFinished
  | MemoryWrite
  | ConfirmationRequested
  | ConfirmationResolved
  | ProviderSelected
  | ProviderRequestStarted
  | ProviderRequestFinished;
