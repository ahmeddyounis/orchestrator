# Memory

The Orchestrator's memory feature allows it to retain and recall information across interactions, enabling more context-aware and efficient task execution. This document provides an overview of how memory works, its safety features, and how to manage it.

## How it Works

Memory is stored locally in a SQLite database file within your project's `.orchestrator` directory. It is designed to be **local-first, private, and entirely under your control.**

### Memory Types

The system utilizes two primary types of memory:

1.  **Episodic Memory:** Stores events and observations from past interactions. This includes commands you've run, files you've edited, and the results of those actions. It helps the agent understand the history of your project.
2.  **Procedural Memory:** Stores learned procedures and preferences. For example, if you frequently use a specific set of commands to test your application, the agent can learn this procedure and automate it for you.

### Evidence-Gated Writes

To ensure that only high-quality, relevant information is saved, the Orchestrator uses an "evidence-gated" writing process. A piece of information is only committed to long-term memory if there is sufficient evidence that it is important and accurate. This prevents the memory from being cluttered with trivial or incorrect data.

### Redaction

To protect sensitive information, the memory system automatically redacts common secret formats (e.g., API keys, credentials) before they are stored. You can review the redaction implementation in `@orchestrator/shared/redaction.ts`.

### Per-Repo Isolation

Memory is strictly isolated on a per-repository basis. The agent uses a unique `repoId` (a hash of the repository's root path) to ensure that knowledge learned in one project is never accidentally applied to another.

## Configuration

To enable and configure memory, add the `memory` block to your `.orchestrator/config.json` file.

```json
{
  "memory": {
    "enabled": true
  }
}
```

For more advanced configurations, see the [Configuration Docs](./config.md).

## Managing Memory

You can interact with the memory system using the `memory` command.

| Command                     | Description                                                                 |
| :-------------------------- | :-------------------------------------------------------------------------- |
| `orchestrator memory show`  | Dumps the content of the memory database for inspection.                    |
| `orchestrator memory wipe`  | Deletes the memory database file, effectively wiping all learned knowledge. |
| `orchestrator memory query` | (Future) Allows querying the memory using natural language.                 |

### Wiping Memory

To completely reset the agent's knowledge for a project, you can:

1.  Run the `orchestrator memory wipe` command.
2.  Or, manually delete the `.orchestrator/memory.sqlite` file from your project directory.

## Best Practices & Troubleshooting

- **Stale Information:** If the agent seems to be using outdated information, wiping the memory is often the quickest solution.
- **Disabling Memory:** If you prefer the agent to operate without long-term context, you can set `"enabled": false` in the memory configuration.
- **Inspecting Memory:** Use `orchestrator memory show` to understand what the agent has learned. This can be useful for debugging unexpected behavior.
