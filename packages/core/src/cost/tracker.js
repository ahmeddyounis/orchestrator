'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.CostTracker = void 0;
class CostTracker {
  usageMap = new Map();
  config;
  constructor(config) {
    this.config = config;
  }
  recordUsage(providerId, usage) {
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
  getProviderStats(providerId) {
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
  getSummary() {
    const total = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
    };
    const providers = {};
    let totalCost = null;
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
exports.CostTracker = CostTracker;
//# sourceMappingURL=tracker.js.map
