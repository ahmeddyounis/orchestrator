import type { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import type {
  Logger,
  EventBus,
  OrchestratorEvent,
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
  private shutdownPromise: Promise<void> | undefined;
  private readonly eventBus: EventBus | undefined;
  private readonly runId: string | undefined;

  public readonly stream?: (req: ModelRequest, ctx: AdapterContext) => AsyncIterable<StreamEvent>;

  constructor(args: {
    pluginName: string;
    prepared: PreparedPlugin<ProviderAdapterPlugin>;
    config: PluginConfig;
    logger: Logger;
    events?: { eventBus: EventBus; runId: string };
  }) {
    this.pluginName = args.pluginName;
    this.plugin = args.prepared.createPlugin();
    this.eventBus = args.events?.eventBus;
    this.runId = args.events?.runId;

    const initCtx: PluginContext = {
      runId: `plugin-init:${args.pluginName}`,
      logger: args.logger.child({ plugin: args.pluginName }),
    };

    const initStartedAt = Date.now();
    this.emit({
      type: 'PluginInitStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId ?? initCtx.runId,
      payload: { pluginName: this.pluginName },
    });

    this.initPromise = this.plugin.init(args.config, initCtx).catch(async (error) => {
      this.emit({
        type: 'PluginInitFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: this.runId ?? initCtx.runId,
        payload: {
          pluginName: this.pluginName,
          durationMs: Date.now() - initStartedAt,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // Best-effort cleanup when init fails (avoid leaking resources).
      await this.shutdownOnce().catch(() => undefined);
      throw error;
    });

    void this.initPromise.then(
      () =>
        this.emit({
          type: 'PluginInitFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId ?? initCtx.runId,
          payload: {
            pluginName: this.pluginName,
            durationMs: Date.now() - initStartedAt,
            success: true,
          },
        }),
      () => undefined,
    );
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

    await this.shutdownOnce();
  }

  private shutdownOnce(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    const shutdownStartedAt = Date.now();
    this.emit({
      type: 'PluginShutdownStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId ?? `plugin-shutdown:${this.pluginName}`,
      payload: { pluginName: this.pluginName },
    });

    this.shutdownPromise = this.plugin
      .shutdown()
      .then(() => {
        this.emit({
          type: 'PluginShutdownFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId ?? `plugin-shutdown:${this.pluginName}`,
          payload: {
            pluginName: this.pluginName,
            durationMs: Date.now() - shutdownStartedAt,
            success: true,
          },
        });
      })
      .catch((error) => {
        this.emit({
          type: 'PluginShutdownFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId ?? `plugin-shutdown:${this.pluginName}`,
          payload: {
            pluginName: this.pluginName,
            durationMs: Date.now() - shutdownStartedAt,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      });
    return this.shutdownPromise;
  }

  private emit(event: OrchestratorEvent): void {
    if (!this.eventBus) return;
    void Promise.resolve(this.eventBus.emit(event)).catch(() => undefined);
  }
}
