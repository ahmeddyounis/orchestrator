import { EventEmitter } from 'events';
import { Budget, RunState } from './types';
import { BudgetManager } from './budget';

export class RunStateManager extends EventEmitter {
  public budgetManager: BudgetManager;
  public state: RunState;

  constructor(state: RunState, budget: Budget) {
    super();
    this.state = state;
    this.budgetManager = new BudgetManager(budget, state);

    // Re-emit BudgetSet from BudgetManager if needed,
    // or just rely on consumers listening to this class if we emit it here.
    // The spec lists "BudgetSet" as an event to emit.
    // BudgetManager emits it in my implementation.
    // I can listen to BudgetManager and re-emit, or just have consumers access budgetManager.
    // But usually a manager wraps these things.

    this.budgetManager.on('BudgetSet', (b) => this.emit('BudgetSet', b));
  }

  start() {
    this.emit('OrchestrationStarted', this.state);
    this.budgetManager.emitBudgetSet();
  }
}
