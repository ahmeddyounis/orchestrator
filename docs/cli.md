# CLI Reference

This document provides a reference for the Orchestrator CLI commands.

## Global Options

These options can be used with any command:

- `--help`: Show help for a command.
- `--config <path>`: Specify a path to a config file.
- `--verbose`: Enable verbose logging.

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

- `--l2`: (Optional) Enable Level 2 reasoning for more complex tasks. This allows the orchestrator to perform deeper analysis and chain multiple steps together.
- `--no-verify`: (Optional) Disable automatic verification (running tests and linting) after making changes.
- `--memory`: (Optional) Enable memory to allow the orchestrator to remember context from previous runs.

---

### Example 1: Simple Task

A straightforward request to add a feature.

```bash
orchestrator run "Add a dark mode toggle to the settings page."
```

---

### Example 2: Complex Task with L2 Reasoning

For more complex problems, you can use the `--l2` flag. This is useful for tasks that require deep analysis or refactoring across multiple files.

Let's say you need to refactor a core piece of your application.

**Initial Prompt:**

```bash
orchestrator run --l2 "The current user authentication logic is monolithic and hard to test. Refactor it into a modular structure with separate services for session management, password hashing, and user data retrieval."
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

### `index`

This command creates or updates the orchestrator's index of your codebase. The index is used to provide context for the `run` command.

**Usage:**

```bash
orchestrator index
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
orchestrator eval --suite <path_to_suite_file>
```

For more details, see the [Evaluation Guide](eval.md).
