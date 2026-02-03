import type { OrchestratorEvent } from '../types/events';

/**
 * A value that may be synchronous or a Promise.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Interface for logging throughout the orchestrator system.
 * Supports both structured event logging and traditional log levels.
 *
 * @example
 * ```typescript
 * // Log a structured event
 * logger.log({ type: 'RunStarted', ... });
 *
 * // Log with trace context
 * logger.trace(event, 'Starting execution of step 1');
 *
 * // Standard logging
 * logger.info('Processing completed');
 * logger.error(new Error('Failed'), 'Operation failed');
 *
 * // Create a child logger with additional context
 * const childLogger = logger.child({ stepId: '123' });
 * ```
 */
export interface Logger {
  /**
   * Persist a structured orchestrator event.
   * @param event - The event to log
   */
  log(event: OrchestratorEvent): MaybePromise<void>;

  /**
   * High-signal trace event with a human-readable message.
   * Combines structured event data with a human-readable summary.
   * @param event - The event being traced
   * @param message - Human-readable description
   */
  trace(event: OrchestratorEvent, message: string): MaybePromise<void>;

  /** Log a debug message (lowest priority, typically disabled in production) */
  debug(message: string): MaybePromise<void>;
  /** Log an informational message */
  info(message: string): MaybePromise<void>;
  /** Log a warning message */
  warn(message: string): MaybePromise<void>;
  /**
   * Log an error with optional message.
   * @param error - The error that occurred
   * @param message - Optional additional context
   */
  error(error: Error, message?: string): MaybePromise<void>;

  /**
   * Create a child logger with additional context bindings.
   * All logs from the child will include these bindings.
   * @param bindings - Key-value pairs to include in all child logs
   * @returns A new logger instance with the bindings applied
   */
  child(bindings: Record<string, unknown>): Logger;
}
