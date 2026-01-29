import { describe, it, expect, vi } from 'vitest';
import { BudgetManager } from './budget';
import { RunStateManager } from './manager';
import { serializeRunState } from './serialization';
import { RunState, Budget } from './types';
import { CostTracker } from '../cost/tracker';
import { Config } from '@orchestrator/shared';
import { BudgetExceededError } from './errors';

const mockConfig: Config = { verification: {} as any,
  configVersion: 1,
  thinkLevel: 'L1',
  providers: {
    mock: {
      type: 'mock',
      model: 'test-model',
      pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 2 }
    }
  }
};

describe('State Module', () => {
  const createRunState = (overrides?: Partial<RunState>): RunState => ({
    runId: 'test-run',
    repoRoot: '/tmp/test',
    startedAt: Date.now(),
    selectedProviders: ['mock'],
    iteration: 0,
    toolRuns: 0,
    checkpoints: [],
    artifacts: [],
    costTracker: new CostTracker(mockConfig),
    ...overrides,
  });

  const createBudget = (overrides?: Partial<Budget>): Budget => ({
    maxIterations: 10,
    maxToolRuns: 10,
    maxWallTimeMs: 10000,
    maxCostUsd: 1.0,
    ...overrides,
  });

  describe('BudgetManager', () => {
    it('checks iteration limit', () => {
      const state = createRunState({ iteration: 11 });
      const budget = createBudget({ maxIterations: 10 });
      const manager = new BudgetManager(budget, state);
      
      expect(() => manager.checkIteration()).toThrow(BudgetExceededError);
      expect(() => manager.checkIteration()).toThrow('Max iterations (10) exceeded');
    });

    it('checks tool runs limit', () => {
      const state = createRunState({ toolRuns: 11 });
      const budget = createBudget({ maxToolRuns: 10 });
      const manager = new BudgetManager(budget, state);
      
      expect(() => manager.checkToolRuns()).toThrow(BudgetExceededError);
    });

    it('checks wall time limit', () => {
      const start = Date.now() - 20000;
      const state = createRunState({ startedAt: start });
      const budget = createBudget({ maxWallTimeMs: 10000 });
      const manager = new BudgetManager(budget, state);
      
      expect(() => manager.checkWallTime()).toThrow(BudgetExceededError);
    });

    it('checks cost limit', () => {
      const state = createRunState();
      state.costTracker.recordUsage('mock', { inputTokens: 2000000, outputTokens: 0, totalTokens: 2000000 }); 
      // 2M tokens * $1/1M = $2
      
      const budget = createBudget({ maxCostUsd: 1.0 });
      const manager = new BudgetManager(budget, state);
      
      expect(() => manager.checkCost()).toThrow(BudgetExceededError);
    });
  });

  describe('RunStateManager', () => {
    it('emits OrchestrationStarted and BudgetSet on start', () => {
      const state = createRunState();
      const budget = createBudget();
      const manager = new RunStateManager(state, budget);
      
      const onStarted = vi.fn();
      const onBudgetSet = vi.fn();
      
      manager.on('OrchestrationStarted', onStarted);
      manager.on('BudgetSet', onBudgetSet);
      
      manager.start();
      
      expect(onStarted).toHaveBeenCalledWith(state);
      expect(onBudgetSet).toHaveBeenCalledWith(budget);
    });
  });

  describe('Serialization', () => {
    it('serializes RunState without circular refs and includes cost summary', () => {
      const state = createRunState();
      state.costTracker.recordUsage('mock', { inputTokens: 1000000, outputTokens: 0, totalTokens: 1000000 });
      
      const serialized = serializeRunState(state);
      
      expect(serialized.runId).toBe('test-run');
      expect(serialized.costTracker).toBeDefined();
      expect(serialized.costTracker.total.estimatedCostUsd).toBe(1);
      
      // Verify JSON stringify works
      const json = JSON.stringify(serialized);
      expect(json).toContain('"estimatedCostUsd":1');
    });
  });
});
