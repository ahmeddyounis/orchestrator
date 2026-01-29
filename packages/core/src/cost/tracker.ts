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

export class CostTracker {
  private usageMap = new Map<string, ProviderUsageStats>();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  recordUsage(providerId: string, usage: Usage) {
    const stats = this.getProviderStats(providerId);

    const input = usage.inputTokens || 0;
    const output = usage.outputTokens || 0;
    const total = usage.totalTokens || input + output;

    stats.inputTokens += input;
    stats.outputTokens += output;
    stats.totalTokens += total;

    // Calculate cost
    const pricing = this.config.providers?.[providerId]?.pricing;
    if (pricing) {
      let cost = 0;
      let hasPricing = false;

      if (pricing.inputPerMTokUsd !== undefined) {
        cost += (input / 1_000_000) * pricing.inputPerMTokUsd;
        hasPricing = true;
      }
      if (pricing.outputPerMTokUsd !== undefined) {
        cost += (output / 1_000_000) * pricing.outputPerMTokUsd;
        hasPricing = true;
      }

      if (hasPricing) {
        stats.estimatedCostUsd = (stats.estimatedCostUsd || 0) + cost;
      }
    }
  }

  private getProviderStats(providerId: string): ProviderUsageStats {
    let stats = this.usageMap.get(providerId);
    if (!stats) {
      stats = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null,
      };
      this.usageMap.set(providerId, stats);
    }
    return stats;
  }

  getSummary(): CostSummary {
    const total: ProviderUsageStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
    };

    const providers: Record<string, ProviderUsageStats> = {};
    let totalCost: number | null = null;

    for (const [id, stats] of this.usageMap.entries()) {
      providers[id] = { ...stats };
      total.inputTokens += stats.inputTokens;
      total.outputTokens += stats.outputTokens;
      total.totalTokens += stats.totalTokens;

      if (typeof stats.estimatedCostUsd === 'number') {
        if (totalCost === null) totalCost = 0;
        totalCost += stats.estimatedCostUsd;
      }
    }

    total.estimatedCostUsd = totalCost;

    return {
      providers,
      total,
    };
  }
}
