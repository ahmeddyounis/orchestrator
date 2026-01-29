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
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  retryOptions?: RetryOptions;
}
