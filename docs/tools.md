# Tools & Execution Safety

The Orchestrator can execute shell commands (tools) to perform tasks like running tests, linting code, or installing dependencies. To keep your system safe, it operates under a strict execution policy.

## The Confirmation Prompt

By default, the Orchestrator will always ask for your permission before running any shell command. When a command is about to be executed, you will see a prompt like this:

```
? Execute the following command?
> pnpm install
(Y/n)
```

You must press `Y` to allow the command to run.

This confirmation step is a critical safety feature to prevent the orchestrator from performing unwanted actions.

## Configuration

You can configure the execution policy in your `.orchestrator/config.json` file.

```json
{
  "exec": {
    "confirm": true,
    "safeMode": true
  }
}
```

### `exec.confirm`

-   **Type**: `boolean`
-   **Default**: `true`

This setting controls the confirmation prompt. When `true`, you will be prompted before every command.

If you set this to `false`, the orchestrator will execute commands without asking for confirmation. **This is not recommended unless you fully trust the orchestrator's actions.**

### `exec.safeMode`

-   **Type**: `boolean`
-   **Default**: `true`

Safe mode provides an additional layer of protection by preventing the execution of commands that are deemed potentially risky or destructive. This includes:

-   Commands that could delete files (e.g., `rm -rf`).
-   Commands that could modify system settings.
-   Commands that attempt to access files outside of the project directory.

Even with `confirm` set to `false`, `safeMode` will still block these commands. It is strongly recommended to keep `safeMode` enabled.