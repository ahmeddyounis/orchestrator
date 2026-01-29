import { Config, ProviderConfig, OrchestratorEvent } from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';

export type AdapterFactory = (config: ProviderConfig) => ProviderAdapter;

export interface EventBus {
  emit(event: OrchestratorEvent): Promise<void> | void;
}

export class RegistryError extends Error {
  constructor(
    message: string,
    public exitCode?: number,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class ProviderRegistry {
  private factories = new Map<string, AdapterFactory>();
  private adapters = new Map<string, ProviderAdapter>();

  constructor(private config: Config) {}

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
      throw new Error(`Provider '${providerId}' not found in configuration.`);
    }

    // Look up factory
    const factory = this.factories.get(providerConfig.type);
    if (!factory) {
      throw new RegistryError(
        `Unknown provider type '${providerConfig.type}' for provider '${providerId}'`,
        2,
      );
    }

    // Validate env vars
    if (providerConfig.api_key_env && !providerConfig.api_key) {
      throw new RegistryError(
        `Missing environment variable '${providerConfig.api_key_env}' for provider '${providerId}'`,
        2,
      );
    }

    // Create adapter
    const adapter = factory(providerConfig);
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
