# Configuration Reference

The Orchestrator CLI uses a flexible configuration system that merges settings from multiple sources.

## Configuration File Locations

Configuration is loaded from the following locations, in order of precedence (highest to lowest):

1.  **CLI Flags**: Options passed directly to the command (e.g., `--planner`).
2.  **Explicit Config File**: File specified via `--config <path>`.
3.  **Repo Config**: `.orchestrator.yaml` in the current working directory.
4.  **User Config**: `~/.orchestrator/config.yaml` in your home directory.
5.  **Defaults**: Internal default settings.

## Configuration Schema

The configuration file is written in YAML. Below is the structure and available options.

```yaml
# Version of the config schema
configVersion: 1

# Define AI providers
providers:
  # Unique Provider ID
  openai-gpt4:
    type: 'openai' # Provider type (e.g., openai, anthropic, ollama)
    model: 'gpt-4' # Model name
    api_key_env: 'OPENAI_API_KEY' # Environment variable containing the API key
    supportsTools: true # Whether the model supports function calling

  local-llama:
    type: 'ollama'
    model: 'llama3'

  claude-agent:
    type: 'claude_code'
    # See docs/providers/claude-code.md for setup

  custom-script:
    type: 'stdio' # For custom providers communicating via stdio
    command: './scripts/my-agent.sh'

# Set default providers for specific roles
defaults:
  planner: 'openai-gpt4'
  executor: 'openai-gpt4'
  reviewer: 'local-llama'

# budgets (Coming soon)
budgets:
  tokens: 100000
  cost: 10.0

# Execution Policy
execution:
  allowDirtyWorkingTree: false
  tools:
    enabled: true
    requireConfirmation: true
    allowlistPrefixes:
      - 'npm test'
      - 'ls -la'
    denylistPatterns:
      - 'rm -rf'
```

## Provider Configuration

Providers are the core AI models or agents used by the Orchestrator. You can define multiple providers and assign them to different roles (`planner`, `executor`, `reviewer`).

### Properties

- `type`: The type of provider. Common types include `openai`, `anthropic`, `google`, `ollama`, and `claude_code` (see [Claude Code Provider](providers/claude-code.md)).
- `model`: The specific model identifier (e.g., `gpt-4-turbo`, `claude-3-opus-20240229`).
- `api_key_env`: The name of the environment variable that holds the API key. **Security Note:** Do not commit API keys directly to configuration files. Use `api_key_env`.
- `api_key`: (Optional) Direct API key string. Discouraged for security reasons.
- `command`: (Optional) Used for `stdio` type providers to specify the executable command.

## Roles

The Orchestrator divides work into three main roles:

1.  **Planner**: Breaks down the high-level goal into a step-by-step plan.
2.  **Executor**: Performs the actions (coding, command execution) defined in the plan.
3.  **Reviewer**: Checks the work of the executor against the requirements.

You can assign a specific `providerId` to each role in the `defaults` section.

## Budgets (Placeholder)

_Note: Budget enforcement is currently in development._

Budgets allow you to limit resource consumption per run.

```yaml
budgets:
  global_tokens: 50000
```

## Execution Policy

Control how the agent interacts with the local environment, including tool execution and git state.

```yaml
execution:
  # Whether to allow running when the git working tree is dirty
  allowDirtyWorkingTree: false # Default: false

  # Whether to skip creating git checkpoints (commits) before actions
  noCheckpoints: false # Default: false

  # Tool Execution Policy
  tools:
    # Master switch for tool execution.
    # Set to true to allow the agent to run commands.
    enabled: false # Default: false

    # Whether to require human confirmation for every command.
    requireConfirmation: true # Default: true

    # Commands starting with these prefixes are allowed (subject to confirmation).
    allowlistPrefixes:
      - 'pnpm test'
      - 'pnpm lint'
      - 'pnpm -r test'
      - 'pnpm -r lint'
      - 'pnpm -r build'
      - 'turbo run test'
      - 'turbo run build'
      - 'tsc'
      - 'vitest'
      - 'eslint'
      - 'prettier'

    # Commands matching these regex patterns are blocked automatically.
    denylistPatterns:
      - 'rm -rf'
      - 'mkfs'
      - ':(){:|:&};:' # fork bomb
      - 'curl .*\|\s*sh' # pipe to shell

    # Whether to allow tools to access the network (e.g., curl, npm install).
    allowNetwork: false # Default: false

    # Timeout for tool execution in milliseconds.
    timeoutMs: 600000 # Default: 10 minutes

    # Maximum size of stdout/stderr output to capture in bytes.
    maxOutputBytes: 1048576 # Default: 1MB
```
