import { describe, it, expect } from 'vitest';
import { CostTracker } from './tracker';
import { Config } from '@orchestrator/shared';

describe('CostTracker', () => {
  it('should start with empty stats', () => {
    const config: Config = { configVersion: 1, thinkLevel: 'L1' };
    const tracker = new CostTracker(config);
    const summary = tracker.getSummary();

    expect(summary.total.totalTokens).toBe(0);
    expect(summary.total.estimatedCostUsd).toBeNull();
    expect(Object.keys(summary.providers)).toHaveLength(0);
  });

  it('should track usage without pricing', () => {
    const config: Config = { configVersion: 1, thinkLevel: 'L1' };
    const tracker = new CostTracker(config);

    tracker.recordUsage('gpt-4', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });

    const summary = tracker.getSummary();
    const stats = summary.providers['gpt-4'];

    expect(stats.inputTokens).toBe(100);
    expect(stats.outputTokens).toBe(50);
    expect(stats.totalTokens).toBe(150);
    expect(stats.estimatedCostUsd).toBeNull();

    expect(summary.total.totalTokens).toBe(150);
    expect(summary.total.estimatedCostUsd).toBeNull();
  });

  it('should calculate cost with pricing', () => {
    const config: Config = {
      configVersion: 1,
      thinkLevel: 'L1',
      providers: {
        'gpt-4': {
          type: 'openai',
          model: 'gpt-4',
          pricing: {
            inputPerMTokUsd: 10, // $10 per million
            outputPerMTokUsd: 30, // $30 per million
          },
        },
      },
    };
    const tracker = new CostTracker(config);

    // 1M input, 1M output
    tracker.recordUsage('gpt-4', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    const summary = tracker.getSummary();
    const stats = summary.providers['gpt-4'];

    expect(stats.inputTokens).toBe(1_000_000);
    expect(stats.outputTokens).toBe(1_000_000);
    expect(stats.estimatedCostUsd).toBe(40); // 10 + 30

    expect(summary.total.estimatedCostUsd).toBe(40);
  });

  it('should handle mixed pricing (some known, some unknown)', () => {
    const config: Config = {
      configVersion: 1,
      thinkLevel: 'L1',
      providers: {
        'expensive-model': {
          type: 'openai',
          model: 'gpt-4',
          pricing: {
            inputPerMTokUsd: 10,
          },
        },
      },
    };
    const tracker = new CostTracker(config);

    // Known cost
    tracker.recordUsage('expensive-model', {
      inputTokens: 1_000_000,
    });

    // Unknown cost
    tracker.recordUsage('local-model', {
      inputTokens: 1_000_000,
    });

    const summary = tracker.getSummary();

    // expensive-model has cost
    expect(summary.providers['expensive-model'].estimatedCostUsd).toBe(10);

    // local-model has no cost
    expect(summary.providers['local-model'].estimatedCostUsd).toBeNull();

    // Total should include known costs
    expect(summary.total.estimatedCostUsd).toBe(10);
    expect(summary.total.inputTokens).toBe(2_000_000);
  });

  it('should accumulate costs over multiple records', () => {
    const config: Config = {
      configVersion: 1,
      thinkLevel: 'L1',
      providers: {
        'gpt-4': {
          type: 'openai',
          model: 'gpt-4',
          pricing: {
            inputPerMTokUsd: 10,
          },
        },
      },
    };
    const tracker = new CostTracker(config);

    tracker.recordUsage('gpt-4', { inputTokens: 1_000_000 });
    tracker.recordUsage('gpt-4', { inputTokens: 2_000_000 });

    const summary = tracker.getSummary();
    expect(summary.providers['gpt-4'].estimatedCostUsd).toBe(30);
  });
});
