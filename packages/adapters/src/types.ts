import { Logger } from '@orchestrator/shared';

export interface AdapterContext {
  runId: string;
  logger: Logger;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}
