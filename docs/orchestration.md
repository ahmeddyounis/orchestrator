# Orchestration Concepts

This document explains the core concepts of how the Orchestrator thinks, executes tasks, and manages resources.

## Thinking Levels

The Orchestrator operates at different "thinking levels," controlled by the `--think` flag. Choosing the right level depends on the complexity of your task.

### L1: Basic Reasoning

**Best for:** Simple, well-defined tasks that can be solved in a single step.

L1 mode is designed for straightforward changes. The agent analyzes the request, forms a plan, and executes it.

**Example Use Cases:**

- "Fix the typo in README.md"
- "Update the package version to 1.0.1"

### L2: Multi-Step Reasoning

**Best for:** Complex tasks, feature implementation, or bug investigations that require multiple sequential steps.

In L2 mode (the default), the agent follows a more robust Plan → Execute cycle:

1.  **Plan:** It analyzes the codebase and creates a detailed, multi-step plan of action.
2.  **Execute:** It executes the plan step-by-step, verifying its work along the way.

This mode allows the agent to self-correct, handle dependencies between changes, and tackle more ambitious tasks.

**Example Use Cases:**

- "Refactor the authentication logic to use JWT"
- "Implement the new user profile page"

### L3: Automated Diagnosis and Repair

**Best for:** The most complex problems, especially those involving hard-to-diagnose failing tests.

L3 mode uses a "best-of-N" approach to generate multiple candidate solutions. It then uses a Reviewer agent to rank them against the original objective and a Judge agent to diagnose any test failures. This allows it to "think outside the box" and find solutions that may not be obvious.

For a complete guide, see the [L3 Orchestration Documentation](l3.md).

**Example Use Cases:**

- "The checkout test is flaky; investigate and fix it."
- "There's a subtle bug in the caching logic that only appears under high load. Find and patch it."

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

- **`plan.json`**: The generated plan (L2/L3 only).
- **`trace.jsonl`**: A detailed log of every tool call, thought, and result.
- **`summary.json`**: High-level result of the run.
- **`effective-config.json`**: The fully resolved configuration used for the run.
- **L3 Artifacts**: For L3 runs, additional artifacts including candidate patches and rankings are stored in the `l3/` subdirectory.

### Stop Reasons

- **Completed**: The agent finished the task successfully.
- **Failed**: The agent encountered an unrecoverable error.
- **BudgetExceeded**: A resource limit was hit.
- **Verified**: The agent produced a change that passed all verification checks.
