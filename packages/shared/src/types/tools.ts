export type ToolClassification =
  | 'read_only'
  | 'build'
  | 'test'
  | 'format'
  | 'install'
  | 'network'
  | 'destructive'
  | 'unknown';

/**
 * Timeout configuration for a specific tool.
 */
export interface ToolTimeoutConfig {
  /** Maximum execution time in milliseconds */
  timeoutMs: number;
  /** Grace period for cleanup after timeout signal (ms) */
  gracePeriodMs?: number;
  /** Maximum memory usage in bytes (for resource limiting) */
  maxMemoryBytes?: number;
  /** Maximum CPU time in seconds (for resource limiting) */
  maxCpuSeconds?: number;
}

export interface ToolPolicy {
  enabled: boolean;
  requireConfirmation: boolean;
  allowlistPrefixes: string[];
  denylistPatterns: string[];
  networkPolicy: 'deny' | 'allow';
  envAllowlist: string[];
  allowShell: boolean;
  maxOutputBytes: number;
  timeoutMs: number;
  autoApprove?: boolean;
  interactive?: boolean;
  /** Per-tool timeout configurations (overrides global timeoutMs) */
  toolTimeouts?: Record<string, ToolTimeoutConfig>;
}

export interface ToolRunRequest {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  reason: string;
  classification?: ToolClassification;
}

export interface ToolRunResult {
  exitCode: number;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  truncated: boolean;
}
