# Tools & Execution Safety

The Orchestrator can execute shell commands (tools) during a run (for example: `pnpm test`, `pnpm lint`, or `pnpm typecheck`). To keep your system safe, it operates under a strict execution policy that is **deny-by-default** and **confirmation-first**.

## The Confirmation Prompt

When tool execution is enabled, Orchestrator will ask for your permission before running commands (unless you explicitly opt into auto-approval).

When a command is about to be executed, you will see a prompt like this:

```
? Execute the following command?
> pnpm install
(Y/n)
```

You must press `Y` to allow the command to run.

This confirmation step is a critical safety feature to prevent the orchestrator from performing unwanted actions.

## Configuration

Configuration is YAML and can be provided in:

- Repo config: `.orchestrator.yaml`
- User config: `~/.orchestrator/config.yaml`

Tool execution is controlled by `execution.tools`:

```yaml
configVersion: 1

execution:
  tools:
    enabled: true
    requireConfirmation: true
    autoApprove: false

    # Additional safety rails
    allowShell: false
    networkPolicy: deny
    envAllowlist: []
```

### `execution.tools.requireConfirmation`

- **Type**: `boolean`
- **Default**: `true` (when tools are enabled)

This setting controls the confirmation prompt. When `true`, you will be prompted before every command.

If you set this to `false`, the orchestrator may execute commands without asking for confirmation. This is **not recommended** unless you fully trust your configuration and environment.

### `execution.tools.networkPolicy`

- **Type**: `'deny' | 'allow'`
- **Default**: `'deny'`

Controls whether tools are allowed to access the network while executing. Keep this as `deny` unless you have a specific need.

### `execution.tools.allowlistPrefixes` / `denylistPatterns`

These provide coarse-grained allow/deny rules for tool commands. The defaults are conservative; expand only as needed.
