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

### `orchestration` (Optional)

Fine-tune the behavior of different orchestration levels. For a detailed guide on L3, see the [L3 Orchestration documentation](l3.md).

```json
"orchestration": {
  "l3": {
    "maxBestOf": 5,
    "maxRounds": 1,
    "maxL3Retries": 1
  }
}
```

- `"l3.maxBestOf"`: A safety limit for the `--best-of` flag to prevent generating too many candidates and incurring high costs. Defaults to `5`.
- `"l3.maxRounds"`: The maximum number of refinement rounds the L3 agent can perform. Defaults to `1`.
- `"l3.maxL3Retries"`: The number of times the orchestrator will retry an L3 run if it fails to produce a valid solution. Defaults to `1`.

### `memory` (Optional)

Configure the memory feature. See the [Memory Guide](memory.md) for a high-level overview and the [Vector and Hybrid Memory Guide](memory-vector.md) for advanced usage.

- `"enabled"`: If `true`, the orchestrator will remember context from previous runs.

A minimal configuration just enables the feature:

```json
"memory": {
  "enabled": true
}
```

For advanced semantic search, you can configure retrieval modes and vector backends:

```json
"memory": {
  "enabled": true,
  "retrieval": {
    "mode": "hybrid", // "lexical", "vector", or "hybrid"
    "topK": 10,
    "topKVector": 8,
    "hybridWeights": {
      "lexical": 0.5,
      "vector": 0.5
    }
  },
  "vector": {
    "backend": "sqlite", // "sqlite", "qdrant", "chroma", "pgvector"
    "remoteOptIn": false,

    // Config for "qdrant" backend
    "qdrant": {
      "url": "http://localhost:6333",
      "collectionName": "my-project"
    },

    // Config for "chroma" backend
    "chroma": {
      "url": "http://localhost:8000",
      "collectionName": "my-project"
    },

    // Config for "pgvector" backend
    "pgvector": {
      "connectionStringEnv": "DATABASE_URL"
    }
  },
  "embeddings": {
    "provider": "local-hash" // or "openai", "anthropic", etc.
  }
}
```

- **`retrieval.mode`**: Can be `lexical` (keyword search), `vector` (semantic search), or `hybrid` (combined and re-ranked).
- **`vector.backend`**: The database for storing vectors. `sqlite` is the local default. `qdrant`, `chroma`, and `pgvector` are for remote databases.
- **`vector.remoteOptIn`**: Must be set to `true` to use a remote vector backend. This is a security measure to acknowledge that data (embeddings and file IDs) will be sent over the network.
- **`embeddings.provider`**: Determines how embeddings are created. `local-hash` is fast and fully private. Using a provider like `openai` yields better results but sends file content to the provider's API.
