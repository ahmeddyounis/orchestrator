import { ProviderAdapter } from '../adapter';
import { ProcessManager, ProcessManagerOptions } from './process-manager';
import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import { AdapterContext } from '../types';

export abstract class SubprocessAdapter implements ProviderAdapter {
  abstract id(): string;
  abstract capabilities(): ProviderCapabilities;

  abstract generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;

  abstract stream?(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent>;

  protected createProcessManager(
    ctx: AdapterContext,
    options: Partial<ProcessManagerOptions> = {},
  ): ProcessManager {
    return new ProcessManager({
      logger: ctx.logger,
      runId: ctx.runId,
      timeoutMs: ctx.timeoutMs,
      ...options,
    });
  }
}
