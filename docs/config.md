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

# commandPolicy (Coming soon)
# Control which commands the agents are allowed to execute
commandPolicy:
  allow:
    - 'npm test'
    - 'ls -la'
  deny:
    - 'rm -rf /'
```

## Provider Configuration

Providers are the core AI models or agents used by the Orchestrator. You can define multiple providers and assign them to different roles (`planner`, `executor`, `reviewer`).

### Properties

- `type`: The type of provider. Common types include `openai`, `anthropic`, `google`, `ollama`.
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

## Command Policy (Placeholder)

_Note: Command policy enforcement is currently in development._

Command policies provide a security layer by restricting which shell commands the agents can execute.

```yaml
commandPolicy:
  deny:
    - 'rm -rf *'
```
