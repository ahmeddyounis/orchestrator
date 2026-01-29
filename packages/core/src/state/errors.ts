export class BudgetExceededError extends Error {
  constructor(public reason: string) {
    super(`Budget exceeded: ${reason}`);
    this.name = 'BudgetExceededError';
  }
}
