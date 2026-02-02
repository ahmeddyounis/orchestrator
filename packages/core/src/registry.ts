import { Config, ProviderConfig, ConfigError, EventBus } from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';
import { CostTracker } from './cost/tracker';
import { CostTrackingAdapter } from './cost/proxy';

export { EventBus };
export type AdapterFactory = (config: ProviderConfig) => ProviderAdapter;

export class RegistryError extends ConfigError {
  public readonly exitCode = 2;
}

export class ProviderRegistry {
  private factories = new Map<string, AdapterFactory>();
  private adapters = new Map<string, ProviderAdapter>();

  constructor(
    private config: Config,
    private costTracker?: CostTracker,
  ) {}

  registerFactory(type: string, factory: AdapterFactory) {
    this.factories.set(type, factory);
  }

  getAdapter(providerId: string): ProviderAdapter {
    // Check cache
    if (this.adapters.has(providerId)) {
      return this.adapters.get(providerId)!;
    }

    // Look up provider config
    const providerConfig = this.config.providers?.[providerId];
    if (!providerConfig) {
      throw new RegistryError(`Provider '${providerId}' not found`);
    }

    // Look up factory
    const factory = this.factories.get(providerConfig.type);
    if (!factory) {
      throw new RegistryError(
        `Unknown provider type '${providerConfig.type}' for provider '${providerId}'`,
      );
    }

    // Validate env vars
    let resolvedConfig = providerConfig;
    if (providerConfig.api_key_env && !providerConfig.api_key) {
      const fromEnv = process.env[providerConfig.api_key_env];
      if (!fromEnv) {
        throw new RegistryError(
          `Missing environment variable '${providerConfig.api_key_env}' for provider '${providerId}'`,
        );
      }
      resolvedConfig = { ...providerConfig, api_key: fromEnv };
    }

    // Create adapter
    let adapter = factory(resolvedConfig);

    if (this.costTracker) {
      adapter = new CostTrackingAdapter(providerId, adapter, this.costTracker);
    }

    this.adapters.set(providerId, adapter);
    return adapter;
  }

  async resolveRoleProviders(
    roles: { plannerId: string; executorId: string; reviewerId: string },
    context: { eventBus: EventBus; runId: string },
  ): Promise<{ planner: ProviderAdapter; executor: ProviderAdapter; reviewer: ProviderAdapter }> {
    const planner = this.getAdapter(roles.plannerId);
    await context.eventBus.emit({
      type: 'ProviderSelected',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: context.runId,
      payload: {
        role: 'planner',
        providerId: roles.plannerId,
        capabilities: planner.capabilities(),
      },
    });

    const executor = this.getAdapter(roles.executorId);
    await context.eventBus.emit({
      type: 'ProviderSelected',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: context.runId,
      payload: {
        role: 'executor',
        providerId: roles.executorId,
        capabilities: executor.capabilities(),
      },
    });

    const reviewer = this.getAdapter(roles.reviewerId);
    await context.eventBus.emit({
      type: 'ProviderSelected',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: context.runId,
      payload: {
        role: 'reviewer',
        providerId: roles.reviewerId,
        capabilities: reviewer.capabilities(),
      },
    });

    return { planner, executor, reviewer };
  }
}
