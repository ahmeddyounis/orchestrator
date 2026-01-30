import { Config, Usage } from '@orchestrator/shared';
export interface ProviderUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number | null;
}
export interface CostSummary {
  providers: Record<string, ProviderUsageStats>;
  total: ProviderUsageStats;
}
export declare class CostTracker {
  private usageMap;
  private config;
  constructor(config: Config);
  recordUsage(providerId: string, usage: Usage): void;
  private getProviderStats;
  getSummary(): CostSummary;
}
//# sourceMappingURL=tracker.d.ts.map
