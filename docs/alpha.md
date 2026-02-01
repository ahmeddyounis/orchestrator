# Orchestrator Alpha

Welcome to the Alpha release of Orchestrator. This document provides an overview of the current capabilities and what's coming soon.

## What works today

- **Automated code changes**: The orchestrator can understand a request, analyze the codebase, and perform code changes to accomplish the task.
- **TypeScript Monorepo Support**: The primary focus for the alpha is on TypeScript monorepos using `pnpm` and `turbo`.
- **Interactive Mode**: The orchestrator works as an interactive CLI, where it will prompt for confirmations before making changes.
- **Context-aware Analysis**: The orchestrator builds an index of your codebase to provide context-aware analysis and code changes.
- **Verification**: The orchestrator can run tests and linting to verify the changes it makes.
- **Memory**: The orchestrator can remember past interactions to provide better context for future tasks.
- **Evaluation**: You can evaluate the orchestrator's performance on a suite of tests.

## Recommended Settings for Safety

For the best and safest experience during the alpha, we recommend the following settings in your `.orchestrator/config.json`:

```json
{
  "defaults": {
    "model": "gemini-1.5-pro-latest",
    "temperature": 0.0
  },
  "exec": {
    "confirm": true,
    "safeMode": true
  },
  "log": {
    "level": "info"
  }
}
```

- **`exec.confirm: true`**: This is the default and ensures the CLI will always ask for confirmation before executing any shell commands.
- **`exec.safeMode: true`**: This prevents the CLI from executing commands that are destructive or outside the workspace.

## Coming Soon

- **Docker Sandbox**: Running commands in a sandboxed environment for enhanced security.
- **Wider Language Support**: Expanding beyond TypeScript to other languages and project structures.
- **CI/CD Integration**: Better integration with CI/CD pipelines for automated workflows.

## Documentation

- [Quickstart](quickstart.md)
- [CLI Reference](cli.md)
- [Configuration](config.md)
- [Tools](tools.md)
- [Verification](verification.md)
- [Memory](memory.md)
- [Indexing](indexing.md)
- [Observability](observability.md)
- [Evaluation](eval.md)
