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
- `--non-interactive`: Disable interactive prompts. FAils if a prompt is required and not answered via flags.

## Commands

### `run`

Run an agentic task to achieve a specified goal.

**Usage:**

```bash
orchestrator run <goal> [options]
```

**Arguments:**

- `<goal>`: The natural language description of the task to perform.

**Options:**

- `--budget <key=value>`: Set budget overrides (e.g., `gpt4=100`). Can be specified multiple times for different keys.
- `--planner <providerId>`: Override the configured planner provider.
- `--executor <providerId>`: Override the configured executor provider.
- `--reviewer <providerId>`: Override the configured reviewer provider.
- `--allow-large-diff`: Allow large diffs without user confirmation. Useful for non-interactive runs.

**Examples:**

Run a simple task:

```bash
orchestrator run "Update the README to include installation instructions"
```

Run with specific providers:

```bash
orchestrator run "Refactor the login component" --planner o1 --executor claude-3-opus
```

Run with budget limits:

```bash
orchestrator run "Fix the bug in auth" --budget tokens=10000 --budget cost=5.00
```

### `fix`

Fix an issue based on a goal.

**Usage:**

```bash
orchestrator fix <goal> [options]
```

**Arguments:**

- `<goal>`: The description of the issue to fix.

**Examples:**

```bash
orchestrator fix "The login button is misaligned on mobile"
```

### `plan`

Plan a task based on a goal without executing it.

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
