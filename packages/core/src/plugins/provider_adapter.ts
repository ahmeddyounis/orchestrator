import type { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import type {
  Logger,
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import type {
  PluginConfig,
  PluginContext,
  PreparedPlugin,
  ProviderAdapterPlugin,
} from '@orchestrator/plugin-sdk';
import { setTimeout as setTimeoutCb } from 'node:timers';

function toPluginContext(ctx: AdapterContext): PluginContext {
  return {
    runId: ctx.runId,
    logger: ctx.logger,
    abortSignal: ctx.abortSignal,
    timeoutMs: ctx.timeoutMs,
  };
}

export class PluginProviderAdapter implements ProviderAdapter {
  private readonly pluginName: string;
  private readonly plugin: ProviderAdapterPlugin;
  private readonly initPromise: Promise<void>;

  public readonly stream?: (req: ModelRequest, ctx: AdapterContext) => AsyncIterable<StreamEvent>;

  constructor(args: {
    pluginName: string;
    prepared: PreparedPlugin<ProviderAdapterPlugin>;
    config: PluginConfig;
    logger: Logger;
  }) {
    this.pluginName = args.pluginName;
    this.plugin = args.prepared.createPlugin();

    const initCtx: PluginContext = {
      runId: `plugin-init:${args.pluginName}`,
      logger: args.logger.child({ plugin: args.pluginName }),
    };

    this.initPromise = this.plugin.init(args.config, initCtx);
    // Prevent unhandled promise rejections if init fails and the adapter is never used.
    void this.initPromise.catch(() => undefined);

    if (this.plugin.stream) {
      this.stream = (req, ctx) => this.streamWithInit(req, ctx);
    }
  }

  id(): string {
    return this.pluginName;
  }

  capabilities(): ProviderCapabilities {
    return this.plugin.capabilities();
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    await this.initPromise;
    return this.plugin.generate(req, toPluginContext(ctx));
  }

  private async *streamWithInit(
    req: ModelRequest,
    ctx: AdapterContext,
  ): AsyncGenerator<StreamEvent> {
    await this.initPromise;
    if (!this.plugin.stream) return;

    for await (const event of this.plugin.stream(req, toPluginContext(ctx))) {
      yield event;
    }
  }

  async shutdown(): Promise<void> {
    // Try to wait for init to settle, but don't block shutdown forever.
    await Promise.race([
      this.initPromise.catch(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeoutCb(resolve, 5000);
        timer.unref();
      }),
    ]);

    await this.plugin.shutdown();
  }
}
