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

For the best and safest experience during the alpha, we recommend the following settings in your `.orchestrator.yaml` (repo) or `~/.orchestrator/config.yaml` (user):

```yaml
configVersion: 1

defaults:
  planner: openai
  executor: openai

providers:
  openai:
    type: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY

execution:
  tools:
    enabled: true
    requireConfirmation: true
    autoApprove: false
    networkPolicy: deny
```

- **`execution.tools.requireConfirmation: true`**: Ensures the CLI asks for confirmation before executing commands.
- **`execution.tools.networkPolicy: deny`**: Prevents tools from making outbound network requests by default.

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
