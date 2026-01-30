# Quickstart Guide

This guide will help you get set up with the Orchestrator development environment.

## Prerequisites

- **Node.js**: Version 20 or higher (v25.4.0 recommended).
- **pnpm**: Version 9 or higher.

## Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd orchestrator
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

## Common Commands

The project uses [Turbo](https://turbo.build/) to manage tasks across the monorepo.

- **Build all packages:**

  ```bash
  pnpm build
  ```

- **Run all tests:**

  ```bash
  pnpm test
  ```

- **Lint code:**

  ```bash
  pnpm lint
  ```

- **Check types:**

  ```bash
  pnpm typecheck
  ```

- **Format code:**
  ```bash
  pnpm format
  ```

## Running the CLI

After building the project, you can execute the CLI directly:

```bash
# Build the CLI first
pnpm build

# Run the CLI
node packages/cli/dist/index.js --help
```

For detailed command usage, see the [CLI Reference](./cli.md).

## Viewing Run Artifacts

After each run, the orchestrator stores detailed logs, reports, and patches in a dedicated directory. This is essential for debugging and understanding the agent's behavior.

- **Location**: `.orchestrator/runs/<run_id>/`

To quickly summarize a run's results, use the `report` command:

```bash
# View a report for the last run
node packages/cli/dist/index.js report
```

For a deep dive into the artifacts and their schemas, see the [Observability Guide](./observability.md).

## Configuration

To configure the Orchestrator (providers, models, etc.), create a `.orchestrator.yaml` file in your project root or `~/.orchestrator/config.yaml`.

See the [Configuration Reference](./config.md) for details.

## Workspace Structure

The project is organized as a monorepo in the `packages/` directory:

- `packages/cli`: The command-line interface entry point.
- `packages/core`: Core business logic and domain entities.
- `packages/adapters`: Adapters for external integrations.
- `packages/exec`: Task execution engine.
- `packages/eval`: Evaluation logic.
- `packages/memory`: Memory and state management.
- `packages/repo`: Data access and repository layer.
- `packages/shared`: Shared utilities, types, and constants.
