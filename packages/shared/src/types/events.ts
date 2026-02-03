import { ProviderCapabilities } from './llm';
import type { RetrievalIntent } from './memory';

/**
 * Base interface for all orchestrator events.
 * All events include common metadata fields.
 */
export interface BaseEvent {
  /** Schema version for event format compatibility */
  schemaVersion: number;
  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;
  /** Unique identifier for the orchestration run */
  runId: string;
  /** Event type discriminator */
  type: string;
}

/**
 * Emitted when an orchestration run starts.
 */
export interface RunStarted extends BaseEvent {
  type: 'RunStarted';
  payload: {
    /** Unique identifier for the task */
    taskId: string;
    /** The goal or objective for this run */
    goal: string;
  };
}

/** Emitted when plan generation is requested */
export interface PlanRequested extends BaseEvent {
  type: 'PlanRequested';
  payload: {
    goal: string;
  };
}

/** Emitted when a plan has been created */
export interface PlanCreated extends BaseEvent {
  type: 'PlanCreated';
  payload: {
    planSteps: string[];
    // Can expand with more details as needed
  };
}

/** Emitted when context has been built for model consumption */
export interface ContextBuilt extends BaseEvent {
  type: 'ContextBuilt';
  payload: {
    /** Number of files included in context */
    fileCount: number;
    /** Estimated token count */
    tokenEstimate: number;
  };
}

/** Emitted when search queries have been built */
export interface QueriesBuilt extends BaseEvent {
  type: 'QueriesBuilt';
  payload: {
    /** Number of repository queries */
    repoQueriesCount: number;
    /** Number of memory queries */
    memoryQueriesCount: number;
  };
}

/** Emitted when a patch is proposed but not yet applied */
export interface PatchProposed extends BaseEvent {
  type: 'PatchProposed';
  payload: {
    /** Files that would be modified */
    filePaths: string[];
    /** Preview of the diff (may be truncated) */
    diffPreview: string;
  };
}

/** Emitted when a patch has been applied to the codebase */
export interface PatchApplied extends BaseEvent {
  type: 'PatchApplied';
  payload: {
    /** Description of changes */
    description?: string;
    /** Files that were modified */
    filesChanged: string[];
    /** Whether the patch was successfully applied */
    success: boolean;
  };
}

/** Emitted when a Git checkpoint (commit/stash) is created */
export interface CheckpointCreated extends BaseEvent {
  type: 'CheckpointCreated';
  payload: {
    /** Git ref for the checkpoint */
    checkpointRef: string;
    /** Human-readable label */
    label: string;
  };
}

/** Emitted when a patch fails to apply */
export interface PatchApplyFailed extends BaseEvent {
  type: 'PatchApplyFailed';
  payload: {
    error: string;
    details?: unknown;
  };
}

/** Emitted when a rollback to a previous state is performed */
export interface RollbackPerformed extends BaseEvent {
  type: 'RollbackPerformed';
  payload: {
    reason: string;
    targetRef: string;
  };
}

/** Emitted when a tool completes execution */
export interface ToolRun extends BaseEvent {
  type: 'ToolRun';
  payload: {
    toolName: string;
    input: unknown;
    output: unknown;
    durationMs: number;
  };
}

/** Emitted when a tool execution is requested */
export interface ToolRunRequested extends BaseEvent {
  type: 'ToolRunRequested';
  payload: {
    toolRunId: string;
    command: string;
    classification: string;
    reason: string;
  };
}

/** Emitted when a tool execution is approved */
export interface ToolRunApproved extends BaseEvent {
  type: 'ToolRunApproved';
  payload: {
    toolRunId: string;
    command: string;
  };
}

/** Emitted when a tool execution is blocked by policy */
export interface ToolRunBlocked extends BaseEvent {
  type: 'ToolRunBlocked';
  payload: {
    toolRunId: string;
    command: string;
    reason: string;
  };
}

/** Emitted when a tool starts executing */
export interface ToolRunStarted extends BaseEvent {
  type: 'ToolRunStarted';
  payload: {
    toolRunId: string;
  };
}

/** Emitted when a tool finishes executing */
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

/** Emitted when verification completes for a step */
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

/** Emitted when an orchestration run finishes */
export interface RunFinished extends BaseEvent {
  type: 'RunFinished';
  payload: {
    status: 'success' | 'failure' | 'cancelled';
    summary?: string;
  };
}

/** Emitted when the orchestration level is escalated */
export interface RunEscalated extends BaseEvent {
  type: 'RunEscalated';
  payload: {
    from: 'L0' | 'L1' | 'L2' | 'L3';
    to: 'L0' | 'L1' | 'L2' | 'L3';
    reason: 'non_improving' | 'patch_apply_failure';
  };
}

/** Emitted when data is written to memory */
export interface MemoryWrite extends BaseEvent {
  type: 'MemoryWrite';
  payload: {
    key: string;
    value: unknown;
  };
}

/** Emitted when user confirmation is requested */
export interface ConfirmationRequested extends BaseEvent {
  type: 'ConfirmationRequested';
  payload: {
    action: string;
    details?: string;
    defaultNo: boolean;
  };
}

/** Emitted when a confirmation request is resolved */
export interface ConfirmationResolved extends BaseEvent {
  type: 'ConfirmationResolved';
  payload: {
    approved: boolean;
    /** True if resolved via flag (yes/no) without user prompt */
    autoResolved: boolean;
  };
}

/** Emitted when a provider is selected for a role */
export interface ProviderSelected extends BaseEvent {
  type: 'ProviderSelected';
  payload: {
    role: 'planner' | 'executor' | 'reviewer';
    providerId: string;
    capabilities: ProviderCapabilities;
  };
}

/** Emitted when a provider API request starts */
export interface ProviderRequestStarted extends BaseEvent {
  type: 'ProviderRequestStarted';
  payload: {
    provider: string;
    model: string;
  };
}

/**
 * Emitted when a provider API request completes (success or failure).
 */
export interface ProviderRequestFinished extends BaseEvent {
  type: 'ProviderRequestFinished';
  payload: {
    provider: string;
    durationMs: number;
    success: boolean;
    error?: string;
    /** Number of retry attempts made (0 = succeeded on first try) */
    retries: number;
  };
}

/** Emitted when a subprocess is spawned */
export interface SubprocessSpawned extends BaseEvent {
  type: 'SubprocessSpawned';
  payload: {
    command: string[];
    cwd: string;
    pid: number;
    pty: boolean;
  };
}

/** Emitted when subprocess output is captured (may be sampled) */
export interface SubprocessOutputChunked extends BaseEvent {
  type: 'SubprocessOutputChunked';
  payload: {
    pid: number;
    stream: 'stdout' | 'stderr';
    chunk: string;
    /** True if some chunks were skipped for performance */
    isSampled?: boolean;
  };
}

/** Emitted when a subprocess exits */
export interface SubprocessExited extends BaseEvent {
  type: 'SubprocessExited';
  payload: {
    pid: number;
    exitCode: number | null;
    signal: string | number | null;
    durationMs: number;
    /** Error message for timeouts or spawn failures */
    error?: string;
  };
}

/** Emitted when subprocess output is parsed into structured data */
export interface SubprocessParsed extends BaseEvent {
  type: 'SubprocessParsed';
  payload: {
    kind: 'diff' | 'plan' | 'text';
    confidence: number;
  };
}

/** Emitted when the repository is scanned */
export interface RepoScan extends BaseEvent {
  type: 'RepoScan';
  payload: {
    fileCount: number;
    durationMs: number;
  };
}

/** Emitted when a repository search completes */
export interface RepoSearch extends BaseEvent {
  type: 'RepoSearch';
  payload: {
    query: string;
    matches: number;
    durationMs: number;
  };
}

/** Emitted when a plan step starts executing */
export interface StepStarted extends BaseEvent {
  type: 'StepStarted';
  payload: {
    step: string;
    index: number;
    total: number;
  };
}

/** Emitted when a plan step finishes */
export interface StepFinished extends BaseEvent {
  type: 'StepFinished';
  payload: {
    step: string;
    success: boolean;
    error?: string;
  };
}

/** Emitted when verification starts */
export interface VerificationStarted extends BaseEvent {
  type: 'VerificationStarted';
  payload: {
    mode: string;
  };
}

/** Emitted when verification finishes */
export interface VerificationFinished extends BaseEvent {
  type: 'VerificationFinished';
  payload: {
    passed: boolean;
    failedChecks: string[];
  };
}

/** Emitted when an L2 iteration starts */
export interface IterationStarted extends BaseEvent {
  type: 'IterationStarted';
  payload: {
    iteration: number;
    goal: string;
  };
}

/** Emitted when an L2 iteration finishes */
export interface IterationFinished extends BaseEvent {
  type: 'IterationFinished';
  payload: {
    iteration: number;
    result: 'success' | 'failure';
  };
}

/**
 * Emitted when a repair attempt is made in L2 mode.
 */
export interface RepairAttempted extends BaseEvent {
  type: 'RepairAttempted';
  payload: {
    iteration: number;
    patchPath: string;
  };
}

/** Emitted when the project toolchain is detected */
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

/** Emitted when a run is stopped (cancelled or interrupted) */
export interface RunStopped extends BaseEvent {
  type: 'RunStopped';
  payload: {
    reason: string;
    details?: string;
  };
}

/** Emitted when sensitive data is redacted from memory */
export interface MemoryRedaction extends BaseEvent {
  type: 'MemoryRedaction';
  payload: {
    count: number;
    context: string;
  };
}

/** Emitted when memory is searched */
export interface MemorySearched extends BaseEvent {
  type: 'MemorySearched';
  payload: {
    query: string;
    topK: number;
    hitsCount: number;
    intent: RetrievalIntent;
  };
}

/** Emitted when stale memory entries are reconciled */
export interface MemoryStalenessReconciled extends BaseEvent {
  type: 'MemoryStalenessReconciled';
  payload: {
    details: string;
  };
}

/** Emitted when auto-index update starts */
export interface IndexAutoUpdateStarted extends BaseEvent {
  type: 'IndexAutoUpdateStarted';
  payload: {
    fileCount: number;
    reason: string;
  };
}

/** Emitted when auto-index update finishes */
export interface IndexAutoUpdateFinished extends BaseEvent {
  type: 'IndexAutoUpdateFinished';
  payload: {
    filesAdded: number;
    filesRemoved: number;
    filesChanged: number;
  };
}

/** Emitted when an L3 candidate is generated */
export interface CandidateGenerated extends BaseEvent {
  type: 'CandidateGenerated';
  payload: {
    iteration: number;
    candidateIndex: number;
    valid: boolean;
    providerId: string;
    durationMs: number;
    patchStats?: {
      filesChanged: number;
      linesAdded: number;
      linesDeleted: number;
    };
  };
}

/** Emitted when performance is measured for a specific operation */
export interface PerformanceMeasured extends BaseEvent {
  type: 'PerformanceMeasured';
  payload: {
    name: string;
    durationMs: number;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Union type of all orchestrator events.
 * Use this for type-safe event handling.
 */
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
  | ToolRunBlocked
  | ToolRunStarted
  | ToolRunFinished
  | VerifyResult
  | RunFinished
  | RunEscalated
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
  | CandidateGenerated
  | JudgeInvoked
  | JudgeDecided
  | JudgeFailed
  | SemanticSearchFinishedEvent
  | SemanticSearchFailedEvent
  | DiagnosisStarted
  | DiagnosisCompleted
  | PerformanceMeasured;

/** Emitted when L3 diagnosis starts */
export interface DiagnosisStarted extends BaseEvent {
  type: 'DiagnosisStarted';
  payload: {
    iteration: number;
    reason: string;
  };
}

/** Emitted when L3 diagnosis completes */
export interface DiagnosisCompleted extends BaseEvent {
  type: 'DiagnosisCompleted';
  payload: {
    iteration: number;
    selectedHypothesis: unknown;
  };
}

/** Emitted when the L3 judge is invoked to select between candidates */
export interface JudgeInvoked extends BaseEvent {
  type: 'JudgeInvoked';
  payload: {
    iteration: number;
    reason: 'no_passing_candidates' | 'objective_near_tie' | 'verification_unavailable';
    candidateCount: number;
  };
}

/** Emitted when the L3 judge makes a decision */
export interface JudgeDecided extends BaseEvent {
  type: 'JudgeDecided';
  payload: {
    iteration: number;
    winnerCandidateId: string;
    confidence: number;
    durationMs: number;
  };
}

/** Emitted when the L3 judge fails and a fallback is used */
export interface JudgeFailed extends BaseEvent {
  type: 'JudgeFailed';
  payload: {
    iteration: number;
    error: string;
    fallbackCandidateId: string;
  };
}

/** Emitted when semantic search fails */
export interface SemanticSearchFailedEvent extends BaseEvent {
  type: 'SemanticSearchFailed';
  payload: {
    error: string;
  };
}

/** Emitted when semantic search completes successfully */
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

/**
 * Interface for publishing orchestrator events.
 * Implementations can write to logs, send to external services, etc.
 */
export interface EventBus {
  /**
   * Emit an event to all registered listeners.
   * @param event - The event to emit
   */
  emit(event: OrchestratorEvent): Promise<void> | void;
}

/**
 * Interface for writing events to persistent storage.
 */
export interface EventWriter {
  /**
   * Write an event to storage.
   * @param event - The event to write
   */
  write(event: OrchestratorEvent): void;
  /**
   * Close the writer and flush any pending events.
   */
  close(): Promise<void>;
}
