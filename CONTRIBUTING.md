# Contributing to Orchestrator

Thank you for your interest in contributing! This document outlines the standards and process for developing in this repository.

## Development Setup

1. Ensure you have Node.js (>=20) and pnpm (>=9) installed.
2. Clone the repo and run `pnpm install`.
3. Verify your setup by running `pnpm build` and `pnpm test`.

## Coding Standards

We enforce high standards for code quality using ESLint, Prettier, and TypeScript.

- **Linting**: Run `pnpm lint` to check for issues. Use `pnpm lint:fix` to auto-fix common problems.
- **Formatting**: We use Prettier. Run `pnpm format` to format your code before committing.
- **TypeScript**: All code must be strictly typed. Run `pnpm typecheck` to ensure there are no type errors.

## Testing

We use [Vitest](https://vitest.dev/) for testing.

- **Run all tests**: `pnpm test`
- **Run specific package tests**: Navigate to the package directory (e.g., `cd packages/core`) and run `pnpm test`.

## Commit Conventions

Please write clear, concise commit messages.

- Use the imperative mood ("Add feature" not "Added feature").
- Reference issue numbers if applicable.

## Adding a New Package

1. Create a new directory in `packages/`.
2. Initialize a `package.json` with the name `@orchestrator/<package-name>`.
3. Add the basic configuration (tsconfig, etc.) matching existing packages.
4. Run `pnpm install` to link it in the workspace.
