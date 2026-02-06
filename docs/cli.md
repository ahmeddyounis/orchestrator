# CLI Reference

This document provides a reference for the Orchestrator CLI commands.

## Global Options

These options can be used with any command:

- `--help`: Show help for a command.
- `--config <path>`: Specify a path to a config file.
- `--verbose`: Enable verbose logging.
- `--json`: Output machine-readable JSON (where supported).
- `--yes`: Auto-approve confirmations (subject to denylist).
- `--non-interactive`: Deny by default if confirmation is required.

## Main Commands

### `run`

The `run` command is the core of the orchestrator. You give it a task in natural language, and it will try to accomplish it.

**Usage:**

```bash
orchestrator run "<your task description>" [options]
```

**Arguments:**

- `<your task description>`: A detailed description of what you want to achieve.

**Options:**

- `--think <level>`: Think level: `L0`, `L1`, `L2`, `L3`, or `auto` (default: `auto`).
- `--budget <limits>`: Budget limits (e.g. `cost=5,iter=6,tool=10,time=20m`).
- `--planner/--executor/--reviewer <providerId>`: Override provider IDs.
- `--best-of <N>`: (L3) Generate `N` candidates and pick the best.
- `--verify <mode>`: `on`, `off`, or `auto`.
- `--verify-scope <scope>`: `targeted` or `full`.
- `--no-lint`, `--no-typecheck`, `--no-tests`: Disable parts of auto-verification.
- `--memory <mode>`: `on|off` plus advanced flags (`--memory-mode`, `--memory-vector-backend`, etc.).

---

### Example 1: Simple Task

A straightforward request to add a feature.

```bash
orchestrator run "Add a dark mode toggle to the settings page."
```

---

### Example 2: Complex Task with L2 Reasoning

For more complex problems, you can use `--think L2`. This is useful for tasks that require deep analysis or refactoring across multiple files.

Let's say you need to refactor a core piece of your application.

**Initial Prompt:**

```bash
orchestrator run --think L2 "The current user authentication logic is monolithic and hard to test. Refactor it into a modular structure with separate services for session management, password hashing, and user data retrieval."
```

**How L2 Works:**

1.  **Deeper Analysis**: The orchestrator will first analyze the codebase to understand the existing authentication logic, its dependencies, and potential risks of refactoring.
2.  **Multi-step Plan**: It will create a more detailed, multi-step plan. For example:
    - _Step 1: Create new service files for `session.ts`, `password.ts`, and `user-profile.ts`._
    - _Step 2: Migrate password hashing logic to `password.ts`._
    - _Step 3: Update login and registration endpoints to use the new services._
    - _Step 4: Run tests for each affected component._
3.  **Iterative Execution**: It will execute the plan step-by-step, verifying its work at each stage.

This approach allows the orchestrator to handle complex, multi-faceted tasks that would be difficult to complete in a single step.

---

### Example 3: Automated Diagnosis and Repair with L3

Use `--think L3` for the most complex problems, such as debugging a persistent failing test where the root cause is unclear. L3 generates multiple solutions and uses a `best-of-N` strategy to find the optimal fix.

**Initial Prompt:**

```bash
orchestrator run --think L3 --best-of 3 "The 'calculateTotal' test is failing due to a floating point precision error. Investigate and fix it."
```

**How L3 Works:**

1.  **Best-of-N Generation**: It generates 3 distinct candidate solutions for the problem.
2.  **Objective-First Ranking**: An AI **Reviewer** ranks the candidates based on how well they address the prompt.
3.  **Verification and Diagnosis**: Each candidate is tested. If tests fail, an AI **Judge** diagnoses the reason for the failure.
4.  **Final Selection**: The orchestrator selects the best candidate that both passes the tests and best aligns with the original goal.

For a complete explanation of the process and the artifacts it produces, see the [L3 Orchestration Guide](l3.md).

---

### `plan`

Generate a plan for a goal without executing it.

**Usage:**

```bash
orchestrator plan "<goal>" [options]
```

**Arguments:**

- `<goal>`: The goal to plan.

**Options:**

- `--planner <providerId>`: Override planner provider ID.
- `--depth <n>`: Expand each plan step into substeps up to depth `n` (1–5).
- `--max-substeps <n>`: Max substeps per expanded step (1–20).
- `--max-total-steps <n>`: Safety limit for total plan nodes (1–500).
- `--review`: Run a review pass over the generated outline.
- `--apply-review`: Apply reviewer revisions (if provided) before expansion.
- `--reviewer <providerId>`: Override reviewer provider ID for the plan review pass.

The command writes plan artifacts under `.orchestrator/runs/<runId>/` (including `plan.json`, `plan_raw.txt`, and optional `plan_review.*` / `plan_expand_*` files).

---

### `index`

This command manages the orchestrator's index of your codebase. The index is used to provide context for the `run` command.

**Usage:**

```bash
orchestrator index build
orchestrator index status
orchestrator index update
```

You should run this command whenever you make significant changes to your project.

### `report`

View a summary of the last run, or a specific run.

**Usage:**

```bash
orchestrator report [run_id]
```

**Arguments:**

- `[run_id]`: (Optional) The ID of the run to view. If not provided, it shows the last run.

### `eval`

Run an evaluation suite to measure the orchestrator's performance on a set of predefined tasks.

**Usage:**

```bash
orchestrator eval <path_to_suite_file>
```

For more details, see the [Evaluation Guide](eval.md).

### `export-bundle`

Create a zip bundle with debugging information (config, index, and selected runs).

**Usage:**

```bash
orchestrator export-bundle --runs 3 --output orchestrator-bundle.zip
orchestrator export-bundle --run <runId> --output orchestrator-bundle.zip
```
