import { ProviderCapabilities } from './llm';
import type { RetrievalIntent } from './memory';
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
export interface PlanRequested extends BaseEvent {
  type: 'PlanRequested';
  payload: {
    goal: string;
  };
}
export interface PlanCreated extends BaseEvent {
  type: 'PlanCreated';
  payload: {
    planSteps: string[];
  };
}
export interface ContextBuilt extends BaseEvent {
  type: 'ContextBuilt';
  payload: {
    fileCount: number;
    tokenEstimate: number;
  };
}
export interface QueriesBuilt extends BaseEvent {
  type: 'QueriesBuilt';
  payload: {
    repoQueriesCount: number;
    memoryQueriesCount: number;
  };
}
export interface PatchProposed extends BaseEvent {
  type: 'PatchProposed';
  payload: {
    filePaths: string[];
    diffPreview: string;
  };
}
export interface PatchApplied extends BaseEvent {
  type: 'PatchApplied';
  payload: {
    description?: string;
    filesChanged: string[];
    success: boolean;
  };
}
export interface CheckpointCreated extends BaseEvent {
  type: 'CheckpointCreated';
  payload: {
    checkpointRef: string;
    label: string;
  };
}
export interface PatchApplyFailed extends BaseEvent {
  type: 'PatchApplyFailed';
  payload: {
    error: string;
    details?: unknown;
  };
}
export interface RollbackPerformed extends BaseEvent {
  type: 'RollbackPerformed';
  payload: {
    reason: string;
    targetRef: string;
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
export interface ToolRunRequested extends BaseEvent {
  type: 'ToolRunRequested';
  payload: {
    toolRunId: string;
    command: string;
    classification: string;
    reason: string;
  };
}
export interface ToolRunApproved extends BaseEvent {
  type: 'ToolRunApproved';
  payload: {
    toolRunId: string;
    command: string;
  };
}
export interface ToolRunDenied extends BaseEvent {
  type: 'ToolRunDenied';
  payload: {
    toolRunId: string;
    command: string;
    reason: string;
  };
}
export interface ToolRunStarted extends BaseEvent {
  type: 'ToolRunStarted';
  payload: {
    toolRunId: string;
  };
}
export interface ToolRunFinished extends BaseEvent {
  type: 'ToolRunFinished';
  payload: {
    toolRunId: string;
    exitCode: number;
    durationMs: number;
    stdoutPath: string;
    stderrPath: string;
    truncated: boolean;
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
    value: unknown;
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
    autoResolved: boolean;
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
export interface SubprocessSpawned extends BaseEvent {
  type: 'SubprocessSpawned';
  payload: {
    command: string[];
    cwd: string;
    pid: number;
    pty: boolean;
  };
}
export interface SubprocessOutputChunked extends BaseEvent {
  type: 'SubprocessOutputChunked';
  payload: {
    pid: number;
    stream: 'stdout' | 'stderr';
    chunk: string;
    isSampled?: boolean;
  };
}
export interface SubprocessExited extends BaseEvent {
  type: 'SubprocessExited';
  payload: {
    pid: number;
    exitCode: number | null;
    signal: string | number | null;
    durationMs: number;
    error?: string;
  };
}
export interface SubprocessParsed extends BaseEvent {
  type: 'SubprocessParsed';
  payload: {
    kind: 'diff' | 'plan' | 'text';
    confidence: number;
  };
}
export interface RepoScan extends BaseEvent {
  type: 'RepoScan';
  payload: {
    fileCount: number;
    durationMs: number;
  };
}
export interface RepoSearch extends BaseEvent {
  type: 'RepoSearch';
  payload: {
    query: string;
    matches: number;
    durationMs: number;
  };
}
export interface StepStarted extends BaseEvent {
  type: 'StepStarted';
  payload: {
    step: string;
    index: number;
    total: number;
  };
}
export interface StepFinished extends BaseEvent {
  type: 'StepFinished';
  payload: {
    step: string;
    success: boolean;
    error?: string;
  };
}
export interface VerificationStarted extends BaseEvent {
  type: 'VerificationStarted';
  payload: {
    mode: string;
  };
}
export interface VerificationFinished extends BaseEvent {
  type: 'VerificationFinished';
  payload: {
    passed: boolean;
    failedChecks: string[];
  };
}
export interface IterationStarted extends BaseEvent {
  type: 'IterationStarted';
  payload: {
    iteration: number;
    goal: string;
  };
}
export interface IterationFinished extends BaseEvent {
  type: 'IterationFinished';
  payload: {
    iteration: number;
    result: 'success' | 'failure';
  };
}
export interface RepairAttempted extends BaseEvent {
  type: 'RepairAttempted';
  payload: {
    iteration: number;
    patchPath: string;
  };
}
export interface ToolchainDetected extends BaseEvent {
  type: 'ToolchainDetected';
  payload: {
    packageManager: string;
    usesTurbo: boolean;
    commands: {
      testCmd?: string;
      lintCmd?: string;
      typecheckCmd?: string;
    };
  };
}
export interface RunStopped extends BaseEvent {
  type: 'RunStopped';
  payload: {
    reason: string;
    details?: string;
  };
}
export interface MemoryRedaction extends BaseEvent {
  type: 'MemoryRedaction';
  payload: {
    count: number;
    context: string;
  };
}
export interface MemorySearched extends BaseEvent {
  type: 'MemorySearched';
  payload: {
    query: string;
    topK: number;
    hitsCount: number;
    intent: RetrievalIntent;
  };
}
export interface MemoryStalenessReconciled extends BaseEvent {
  type: 'MemoryStalenessReconciled';
  payload: {
    details: string;
  };
}
export interface IndexAutoUpdateStarted extends BaseEvent {
  type: 'IndexAutoUpdateStarted';
  payload: {
    fileCount: number;
    reason: string;
  };
}
export interface IndexAutoUpdateFinished extends BaseEvent {
  type: 'IndexAutoUpdateFinished';
  payload: {
    filesAdded: number;
    filesRemoved: number;
    filesChanged: number;
  };
}
export type OrchestratorEvent =
  | RunStarted
  | PlanRequested
  | PlanCreated
  | ContextBuilt
  | QueriesBuilt
  | PatchProposed
  | PatchApplied
  | ToolRun
  | ToolRunRequested
  | ToolRunApproved
  | ToolRunDenied
  | ToolRunStarted
  | ToolRunFinished
  | VerifyResult
  | RunFinished
  | RunStopped
  | MemoryWrite
  | MemoryRedaction
  | MemorySearched
  | MemoryStalenessReconciled
  | IndexAutoUpdateStarted
  | IndexAutoUpdateFinished
  | ConfirmationRequested
  | ConfirmationResolved
  | ProviderSelected
  | ProviderRequestStarted
  | ProviderRequestFinished
  | SubprocessSpawned
  | SubprocessOutputChunked
  | SubprocessExited
  | SubprocessParsed
  | RepoScan
  | RepoSearch
  | CheckpointCreated
  | PatchApplyFailed
  | RollbackPerformed
  | ToolchainDetected
  | StepStarted
  | StepFinished
  | VerificationStarted
  | VerificationFinished
  | IterationStarted
  | IterationFinished
  | RepairAttempted
  | SemanticSearchFinishedEvent
  | SemanticSearchFailedEvent;
export interface SemanticSearchFailedEvent extends BaseEvent {
  type: 'SemanticSearchFailed';
  payload: {
    error: string;
  };
}
export interface SemanticSearchFinishedEvent extends BaseEvent {
  type: 'SemanticSearchFinished';
  payload: {
    query: string;
    topK: number;
    hitCount: number;
    candidateCount: number;
    durationMs: number;
  };
}
export interface EventBus {
  emit(event: OrchestratorEvent): Promise<void> | void;
}
export interface EventWriter {
  write(event: OrchestratorEvent): void;
  close(): Promise<void>;
}
//# sourceMappingURL=events.d.ts.map
