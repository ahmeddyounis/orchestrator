import {
  Config,
  ProviderConfig,
  RegistryError,
  EventBus,
  validateProviderConfig,
  formatValidationResult,
  ConfigValidationResult,
} from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';
import { CostTracker } from './cost/tracker';
import { CostTrackingAdapter } from './cost/proxy';

export { EventBus };
export { RegistryError } from '@orchestrator/shared';
export { validateProviderConfig, formatValidationResult } from '@orchestrator/shared';
export type AdapterFactory = (config: ProviderConfig) => ProviderAdapter;

export class ProviderRegistry {
  private factories = new Map<string, AdapterFactory>();
  private adapters = new Map<string, ProviderAdapter>();

  constructor(
    private config: Config,
    private costTracker?: CostTracker,
  ) {}

  /**
   * Validates all provider configurations in the config against their adapter capabilities.
   * Call this after registering all factories to catch configuration errors early.
   *
   * @returns Map of provider ID to validation result
   */
  validateAllProviders(): Map<string, ConfigValidationResult> {
    const results = new Map<string, ConfigValidationResult>();

    if (!this.config.providers) {
      return results;
    }

    for (const [providerId, providerConfig] of Object.entries(this.config.providers)) {
      const result = this.validateProvider(providerId, providerConfig);
      if (result) {
        results.set(providerId, result);
      }
    }

    return results;
  }

  /**
   * Validates a single provider configuration.
   * Returns null if the factory is not registered (can't validate).
   */
  validateProvider(providerId: string, providerConfig: ProviderConfig): ConfigValidationResult | null {
    const factory = this.factories.get(providerConfig.type);
    if (!factory) {
      // Can't validate without a factory - this will be caught at adapter creation time
      return null;
    }

    // Create a temporary adapter to get capabilities
    // This is a trade-off: we instantiate to validate, but catch errors early
    try {
      // For validation, we create with a dummy config to get capabilities
      // Some adapters may throw during construction, which is also validation
      const tempAdapter = factory({ ...providerConfig, api_key: providerConfig.api_key || 'validation-placeholder' });
      const capabilities = tempAdapter.capabilities();
      return validateProviderConfig(providerConfig, capabilities, providerId);
    } catch (error) {
      // Construction failed - this is also a form of validation failure
      return null;
    }
  }

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

    // Validate config against adapter capabilities before creation
    try {
      const tempAdapter = factory(resolvedConfig);
      const capabilities = tempAdapter.capabilities();
      const validation = validateProviderConfig(resolvedConfig, capabilities, providerId);

      if (!validation.valid) {
        throw new RegistryError(
          `Invalid configuration for provider '${providerId}':\n${formatValidationResult(validation)}`,
        );
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        // Warnings are informational - adapter still created
      }
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      // If validation itself failed, continue with normal creation
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
