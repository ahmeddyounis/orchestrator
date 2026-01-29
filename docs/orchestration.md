# Orchestration Concepts

This document explains the core concepts of how the Orchestrator thinks, executes tasks, and manages resources.

## Thinking Levels

The Orchestrator operates at two distinct "thinking levels," controlled by the `--think` flag. Choosing the right level depends on the complexity of your task.

### L0: Reflex (Single-Pass)
**Best for:** Simple, well-defined tasks where the solution is immediate.

In L0 mode, the agent skips the planning phase. It directly interprets your goal and executes the necessary changes in a single pass. This is faster and consumes fewer tokens but is less robust for ambiguous or multi-step problems.

**Example Use Cases:**
- "Fix the typo in README.md"
- "Update the package version to 1.0.1"

### L1: Reasoning (Plan → Execute)
**Best for:** Complex tasks, feature implementation, or bug investigations.

In L1 mode (the default for `fix` and `run` when set to `auto`), the agent follows a structured process:
1.  **Plan:** It analyzes the codebase and creates a detailed plan of action.
2.  **Execute:** It executes the plan step-by-step.

This mode allows the agent to self-correct and handle dependencies between changes.

**Example Use Cases:**
- "Refactor the authentication logic to use JWT"
- "Implement the new user profile page"

## Budgets

You can constrain the agent's resource usage using the `--budget` flag. This prevents runaway costs or infinite loops.

**Available Budgets:**
- `tokens`: Maximum number of tokens (input + output) to consume.
- `cost`: Maximum estimated cost in USD (e.g., `cost=2.50`).
- `iter`: Maximum number of execution iterations/steps.
- `time`: Maximum execution time (e.g., `time=10m`).

**What happens when a budget is exhausted?**
The agent stops immediately. It will produce a summary of what was accomplished up to that point. The run is marked as `BudgetExceeded`.

## Execution Flow & Artifacts

When you run a command, the Orchestrator generates several artifacts in the `.orchestrator/runs/<runId>` directory:

- **`plan.json`**: The generated plan (L1 only).
- **`trace.jsonl`**: A detailed log of every tool call, thought, and result.
- **`summary.json`**: High-level result of the run.
- **`effective-config.json`**: The fully resolved configuration used for the run.

### Stop Reasons
- **Completed**: The agent finished the task successfully.
- **Failed**: The agent encountered an unrecoverable error.
- **BudgetExceeded**: A resource limit was hit.

> **Note:** Automated verification loops (running tests to validate changes) are coming in Milestone 8. Currently, you should verify changes manually after the run completes.
