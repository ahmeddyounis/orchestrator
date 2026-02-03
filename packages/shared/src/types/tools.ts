/**
 * Classification of a tool based on its behavior and risk level.
 * Used for policy enforcement and timeout configuration.
 *
 * - `read_only`: Safe read operations (file reads, searches)
 * - `build`: Compilation and build operations
 * - `test`: Test execution
 * - `format`: Code formatting operations
 * - `install`: Package installation
 * - `network`: Network operations (HTTP requests, etc.)
 * - `destructive`: Operations that modify files or state
 * - `unknown`: Unclassified tools (treated conservatively)
 */
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

/**
 * Policy configuration for tool execution.
 * Controls which tools can run, what confirmations are required,
 * and resource limits for tool execution.
 *
 * @example
 * ```typescript
 * const policy: ToolPolicy = {
 *   enabled: true,
 *   requireConfirmation: true,
 *   allowlistPrefixes: ['npm test', 'pnpm lint'],
 *   denylistPatterns: ['rm -rf', 'sudo'],
 *   networkPolicy: 'deny',
 *   envAllowlist: ['NODE_ENV', 'PATH'],
 *   allowShell: false,
 *   maxOutputBytes: 1024 * 1024,
 *   timeoutMs: 60000
 * };
 * ```
 */
export interface ToolPolicy {
  /** Whether tool execution is enabled */
  enabled: boolean;
  /** Whether to require user confirmation before running tools */
  requireConfirmation: boolean;
  /** Command prefixes that are always allowed */
  allowlistPrefixes: string[];
  /** Patterns that are always denied (regex strings) */
  denylistPatterns: string[];
  /** Network access policy */
  networkPolicy: 'deny' | 'allow';
  /** Environment variables allowed to be passed to tools */
  envAllowlist: string[];
  /** Whether to allow shell command execution */
  allowShell: boolean;
  /** Maximum output size in bytes before truncation */
  maxOutputBytes: number;
  /** Global timeout for tool execution in milliseconds */
  timeoutMs: number;
  /** Auto-approve tools without confirmation (overrides requireConfirmation) */
  autoApprove?: boolean;
  /** Run in interactive mode with TTY support */
  interactive?: boolean;
  /** Per-tool timeout configurations (overrides global timeoutMs) */
  toolTimeouts?: Record<string, ToolTimeoutConfig>;
}

/**
 * Request to execute a tool command.
 */
export interface ToolRunRequest {
  /** The command to execute */
  command: string;
  /** Working directory for command execution */
  cwd: string;
  /** Environment variables to pass to the command */
  env?: Record<string, string>;
  /** Human-readable reason for running this tool */
  reason: string;
  /** Classification of the tool for policy and timeout purposes */
  classification?: ToolClassification;
}

/**
 * Result of a tool execution.
 */
export interface ToolRunResult {
  /** Exit code of the process (0 = success) */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Path to captured stdout */
  stdoutPath: string;
  /** Path to captured stderr */
  stderrPath: string;
  /** Whether output was truncated due to size limits */
  truncated: boolean;
}
