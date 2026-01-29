# CLI Reference

This document provides a comprehensive reference for the Orchestrator CLI commands and options.

## Global Options

These options apply to all commands:

- `--help`: Display help for command.
- `--version`: Output the version number.
- `--json`: Output results as JSON. Useful for programmatic consumption.
- `--config <path>`: Path to an explicit configuration file. Overrides user and repo configs.
- `--verbose`: Enable verbose logging for debugging purposes.
- `--yes`: Automatically answer "yes" to all prompts.
- `--non-interactive`: Disable interactive prompts. Fails if a prompt is required and not answered via flags.

## Commands

### `run`

Run an agentic task to achieve a specified goal. **Best for general features, refactoring, or ad-hoc tasks.**

**Usage:**

```bash
orchestrator run <goal> [options]
```

**Arguments:**

- `<goal>`: The natural language description of the task to perform.

**Options:**

- `--think <level>`: Set thinking level (`L0`, `L1`, or `auto`). Defaults to `auto` (L1).
  - `L0`: Reflex mode (fast, single-pass).
  - `L1`: Reasoning mode (plan then execute).
- `--budget <key=value>`: Set budget limits. Can be specified multiple times.
  - Keys: `tokens`, `cost` (USD), `iter` (steps), `time` (duration).
- `--planner <providerId>`: Override the configured planner provider.
- `--executor <providerId>`: Override the configured executor provider.
- `--reviewer <providerId>`: Override the configured reviewer provider.
- `--allow-large-diff`: Allow large diffs without user confirmation. Useful for non-interactive runs.

**Examples:**

Run a simple task (L0 is efficient here):

```bash
orchestrator run "Update the README to include installation instructions" --think L0
```

Run a complex task with planning (L1):

```bash
orchestrator run "Refactor the login component to use hooks" --think L1
```

Run with specific budgets:

```bash
orchestrator run "Optimize database queries" --budget cost=2.00 --budget time=15m
```

**Monorepo Examples:**

Run a task in a specific package (pnpm):

```bash
# Using pnpm filtering to run in a specific package context
pnpm --filter @my-org/ui exec orchestrator run "Add a Button component"
```

Run a task across the workspace (Turbo):

```bash
# Orchestrator is aware of monorepo structures
orchestrator run "Update all packages to use React 19"
```

### `fix`

Fix an issue based on a goal. **Best for bug fixes and targeted repairs.**

Functionally similar to `run`, but uses a `fix/` branch prefix and defaults to L1 thinking to ensure careful analysis of the bug.

**Usage:**

```bash
orchestrator fix <goal> [options]
```

**Arguments:**

- `<goal>`: The description of the issue to fix.

**Options:**

- `--think <level>`: Set thinking level (`L0`, `L1`). Defaults to `L1`.
- `--budget <key=value>`: Set budget limits.

**Examples:**

Fix a specific bug:

```bash
orchestrator fix "The login button is misaligned on mobile"
```

Fix with a strict cost limit:

```bash
orchestrator fix "Resolve the race condition in the cache" --budget cost=0.50
```

### `plan`

Plan a task based on a goal without executing it. This is effectively the "Plan" phase of an L1 run, stopping before execution.

**Usage:**

```bash
orchestrator plan <goal> [options]
```

**Arguments:**

- `<goal>`: The goal to plan for.

**Examples:**

```bash
orchestrator plan "Migrate the database to PostgreSQL"
```

### `eval`

Run an evaluation suite.

**Usage:**

```bash
orchestrator eval --suite <path> [options]
```

**Options:**

- `--suite <path>`: (Required) Path to the evaluation suite file.

**Examples:**

```bash
orchestrator eval --suite ./evals/code-quality.yaml
```
