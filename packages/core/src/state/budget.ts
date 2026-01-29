import { EventEmitter } from 'events';
import { Budget, RunState } from './types';
import { BudgetExceededError } from './errors';

export class BudgetManager extends EventEmitter {
  constructor(private budget: Budget, private runState: RunState) {
    super();
  }

  public emitBudgetSet() {
    this.emit('BudgetSet', this.budget);
  }

  public checkIteration(): void {
    if (this.runState.iteration > this.budget.maxIterations) {
      throw new BudgetExceededError(`Max iterations (${this.budget.maxIterations}) exceeded`);
    }
  }

  public checkToolRuns(): void {
    if (this.runState.toolRuns > this.budget.maxToolRuns) {
      throw new BudgetExceededError(`Max tool runs (${this.budget.maxToolRuns}) exceeded`);
    }
  }

  public checkWallTime(): void {
    const elapsed = Date.now() - this.runState.startedAt;
    if (elapsed > this.budget.maxWallTimeMs) {
      throw new BudgetExceededError(`Max wall time (${this.budget.maxWallTimeMs}ms) exceeded`);
    }
  }

  public checkCost(): void {
    if (this.budget.maxCostUsd !== undefined) {
      const summary = this.runState.costTracker.getSummary();
      const totalCost = summary.total.estimatedCostUsd;
      
      // If cost is null/undefined, we treat it as 0 for check or ignore? 
      // Assuming 0 if unknown, or strictly check if we have data.
      // tracker.ts says estimatedCostUsd can be null.
      const currentCost = totalCost || 0;

      if (currentCost > this.budget.maxCostUsd) {
        throw new BudgetExceededError(`Max cost ($${this.budget.maxCostUsd}) exceeded`);
      }
    }
  }
}
