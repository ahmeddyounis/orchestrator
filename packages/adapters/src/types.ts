import { Logger } from '@orchestrator/shared';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export interface AdapterContext {
  runId: string;
  logger: Logger;
  /**
   * Absolute path to the repo root being orchestrated (where `.orchestrator/` lives).
   * Optional for backward compatibility; adapters should fall back to `process.cwd()`.
   */
  repoRoot?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  retryOptions?: RetryOptions;
}
