import type { OrchestratorEvent } from '../types/events';

export type MaybePromise<T> = T | Promise<T>;

export interface Logger {
  /** Persist a structured orchestrator event. */
  log(event: OrchestratorEvent): MaybePromise<void>;

  /** High-signal trace event with a human-readable message. */
  trace(event: OrchestratorEvent, message: string): MaybePromise<void>;

  debug(message: string): MaybePromise<void>;
  info(message: string): MaybePromise<void>;
  warn(message: string): MaybePromise<void>;
  error(error: Error, message?: string): MaybePromise<void>;

  child(bindings: Record<string, unknown>): Logger;
}
