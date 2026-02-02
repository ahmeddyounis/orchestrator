# GA Readiness Checklist

This document provides a checklist and guidelines for moving from a Beta to a General Availability (GA) state. It focuses on safe defaults, operational procedures, and supportability.

## Default Configuration (Safe by Default)

For GA, the orchestrator should ship with conservative and safe default settings. This minimizes risk for new users and encourages explicit, intentional configuration for advanced features.

- **Plugins**: Disabled by default.
- **Memory**: Disabled by default.
- **Network Access**: Denied by default for tool execution.
- **Execution Confirmation**: Enabled by default when tools are enabled (`execution.tools.requireConfirmation: true`).

Here is a recommended baseline `~/.orchestrator/config.yaml` for new users:

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

memory:
  enabled: false
```

## Enabling Plugins Safely

Plugins extend the orchestrator's capabilities but should be enabled with care.

1.  **Review the Plugin**: Before enabling a plugin, understand what it does. Review its documentation and, if possible, its source code.
2.  **Project-Level Configuration**: Enable plugins in the project-level `.orchestrator.yaml` rather than the global user config. This scopes the plugin's functionality to a single, trusted project.
3.  **Restrict Permissions**: If the plugin requires access to external services or tools, ensure its permissions are as restrictive as possible.

Example of enabling a specific plugin for a project:

```yaml
# .orchestrator.yaml
plugins:
  enabled: true
  allowlistIds:
    - '@orchestrator/plugin-docs'
```

See the [Plugins documentation](plugins.md) for more details.

## Memory and Indexing Guidelines

- **Start with Memory Disabled**: Get a feel for the orchestrator's core functionality before enabling memory.
- **Local Indexing First**: The default indexer and memory backend run locally on your machine. No data leaves your workstation.
- **Opt-in for Remote Services**: Advanced features like remote vector databases or cloud-based embeddings require an explicit `remoteOptIn: true` flag in your configuration. This is a security gate to ensure you are aware that data will be sent over the network.

See the [Memory Guide](memory.md) for more information.

## Troubleshooting Decision Tree

When encountering an issue, follow this decision tree to diagnose the problem.

1.  **Is the configuration valid?**
    - Run `orchestrator doctor` to check your configuration for common issues.
    - Verify your API keys are correct and have the necessary permissions.

2.  **Is the index up to date?**
    - If you've made significant code changes, re-run `orchestrator index build`.
    - Check the `.orchestrator/index` directory to see when the index was last updated.

3.  **Is the issue with a specific tool or plugin?**
    - Try running the task with plugins disabled to isolate the issue.
    - Check the logs in `.orchestrator/logs` for errors related to tool execution.

4.  **Is the model producing unexpected results?**
    - Try a different model to see if the issue persists.
    - Simplify your prompt. Break down the request into smaller, more specific steps.

If you're still stuck, please refer to our [Support Guide](support.md) for instructions on how to file a bug report.
