import { Config, ProviderConfig, EventBus } from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';
import { CostTracker } from './cost/tracker';
export type AdapterFactory = (config: ProviderConfig) => ProviderAdapter;
export declare class ProviderRegistry {
  private config;
  private costTracker?;
  private factories;
  private adapters;
  constructor(config: Config, costTracker?: CostTracker | undefined);
  registerFactory(type: string, factory: AdapterFactory): void;
  getAdapter(providerId: string): ProviderAdapter;
  resolveRoleProviders(
    roles: {
      plannerId: string;
      executorId: string;
      reviewerId: string;
    },
    context: {
      eventBus: EventBus;
      runId: string;
    },
  ): Promise<{
    planner: ProviderAdapter;
    executor: ProviderAdapter;
    reviewer: ProviderAdapter;
  }>;
}
//# sourceMappingURL=registry.d.ts.map
