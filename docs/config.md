# Configuration Reference

The Orchestrator uses a straightforward JSON configuration file to manage API providers, default models, and other settings.

## Configuration Precedence

Configuration settings are loaded from the following locations, with higher-precedence sources overriding lower ones:

1.  **Command-line flags**: Options passed directly to a command (e.g., `--l2`).
2.  **Project-specific config**: A `.orchestrator/config.json` file in your project's root directory.
3.  **User-level config**: A global `config.json` file located at `~/.orchestrator/config.json`.
4.  **Internal defaults**: The orchestrator's built-in default settings.

This means you can set a global default model in your user config and override it for a specific project in the project's config.

## Configuration Schema

Here is an example of a `config.json` file with all the common options:

```json
{
  "providers": {
    "gemini": {
      "apiKey": "YOUR_GEMINI_API_KEY"
    },
    "openai": {
      "apiKey": "YOUR_OPENAI_API_KEY"
    }
  },
  "defaults": {
    "model": "gemini-1.5-pro-latest"
  },
  "exec": {
    "confirm": true,
    "safeMode": true
  },
  "log": {
    "level": "info"
  },
  "memory": {
    "enabled": false
  }
}
```

### `providers` (Required)

This section is where you configure your AI model providers.

- `"gemini"`: Settings for Google Gemini models.
  - `"apiKey"`: Your Gemini API key.
- `"openai"`: Settings for OpenAI models.
  - `"apiKey"`: Your OpenAI API key.

**Security Note:** It is recommended to use your user-level config file (`~/.orchestrator/config.json`) for API keys to avoid committing them to your project's repository.

### `defaults` (Optional)

Set the default model to use for all runs.

- `"model"`: The ID of the model to use (e.g., `"gemini-1.5-pro-latest"`, `"gpt-4o"`).

### `exec` (Optional)

Control the execution of shell commands.

- `"confirm"`: If `true` (the default), the CLI will prompt for confirmation before executing any command. Set to `false` to disable prompts.
- `"safeMode"`: If `true` (the default), the orchestrator will not execute commands that it deems potentially destructive or outside the project workspace.

### `log` (Optional)

Configure logging verbosity.

- `"level"`: The log level. Can be `"debug"`, `"info"`, `"warn"`, or `"error"`. Defaults to `"info"`.

### `memory` (Optional)

Configure the memory feature.

- `"enabled"`: If `true`, the orchestrator will remember context from previous runs to improve its performance. See the [Memory Guide](memory.md) for more details.
