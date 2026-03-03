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
}
