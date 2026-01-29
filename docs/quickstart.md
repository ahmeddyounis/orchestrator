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
