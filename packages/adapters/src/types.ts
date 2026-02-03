import { Logger } from '@orchestrator/shared';

/**
 * Configuration options for retry behavior on transient failures.
 *
 * These options control how provider API calls are retried when encountering
 * rate limits, timeouts, or server errors.
 *
 * @example
 * ```typescript
 * const retryOptions: RetryOptions = {
 *   maxRetries: 5,        // More attempts for critical operations
 *   initialDelayMs: 2000, // Start with longer delay for rate-limited APIs
 *   maxDelayMs: 30000,    // Allow longer waits
 *   backoffFactor: 1.5,   // Gentler exponential growth
 * };
 * ```
 */
export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 10000 */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff. Default: 2 */
  backoffFactor?: number;
}

/**
 * Context passed to adapter methods for each request.
 * Provides access to logging, cancellation, and execution configuration.
 */
export interface AdapterContext {
  /** Unique identifier for the current orchestration run */
  runId: string;
  /** Logger instance for this request */
  logger: Logger;
  /**
   * Absolute path to the repo root being orchestrated (where `.orchestrator/` lives).
   * Optional for backward compatibility; adapters should fall back to `process.cwd()`.
   */
  repoRoot?: string;
  /** Signal to cancel the request */
  abortSignal?: AbortSignal;
  /** Maximum time in milliseconds for the request */
  timeoutMs?: number;
  /** Retry configuration for transient failures */
  retryOptions?: RetryOptions;
}
