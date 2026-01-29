# Tool Execution Safety Model

The Orchestrator CLI is designed to be safe by default. This document explains the guardrails, configuration options, and how to safely override defaults when necessary.

## Default Behavior

Out of the box, the CLI enforces a strict safety policy:

1.  **Confirmation Required**: All tool executions (shell commands, file edits) require explicit user confirmation unless they are on the **Allowlist**.
2.  **Denylist**: Certain dangerous commands (e.g., `rm -rf /`, `mkfs`) are blocked entirely and cannot be executed, even with confirmation.
3.  **Network Access**: Disabled by default. The agent cannot make external network requests unless explicitly allowed.
4.  **Timeout**: Tool executions have a default timeout (e.g., 10 minutes) to prevent hanging processes.

## Configuration

You can configure tool execution policies in your `.orchestrator.yaml` or `~/.orchestrator/config.yaml` file under the `execution.tools` section.

### Schema

```yaml
execution:
  tools:
    # Master switch to enable/disable all tools
    enabled: true # default: true (via flags, schema default is false but CLI enables it)

    # Require confirmation for all tools NOT in the allowlist
    requireConfirmation: true # default: true

    # Commands that can run without confirmation
    allowlistPrefixes:
      - 'pnpm test'
      - 'pnpm lint'
      - 'tsc'
      # ... see "Defaults" below

    # Commands that are strictly forbidden
    denylistPatterns:
      - 'rm -rf'
      - 'mkfs'
      # ... see "Defaults" below

    # Allow network access (e.g., curl, npm install)
    allowNetwork: false # default: false

    # Execution timeout in milliseconds
    timeoutMs: 600000 # default: 10 minutes

    # Maximum output size to capture
    maxOutputBytes: 1048576 # default: 1MB

    # Auto-approve all confirmations (use with caution!)
    autoApprove: false # default: false

    # fail if confirmation is required (for CI/CD)
    interactive: true # default: true
```

### Defaults

**Allowlist Prefixes (Safe to run):**

- `pnpm test`, `pnpm lint`, `pnpm -r test`, `pnpm -r lint`, `pnpm -r build`
- `turbo run test`, `turbo run build`
- `tsc`, `vitest`, `eslint`, `prettier`

**Denylist Patterns (Blocked):**

- `rm -rf`
- `mkfs`
- `:(){:|:&};:` (fork bomb)
- `curl .*\|\s*sh` (curl | sh)

## CLI Flags

You can override these settings per-run using CLI flags:

- **`--no-tools`**: Disable all tool usage. The agent can only think and plan.
- **`--yes`**: Auto-approve all confirmations. **Use with extreme caution.** This bypasses the `requireConfirmation` check but _still respects the Denylist_.
- **`--non-interactive`**: Run in non-interactive mode. If a tool requires confirmation and is not on the allowlist, the execution will fail. Ideal for CI/CD pipelines.

## Verification

Verification commands (e.g., tests, linters) are also executed via the `ToolExecutor`. This means they are subject to the same safety policies, including `allowlistPrefixes` and `denylistPatterns`.

If your verification commands are not on the allowlist, you will be prompted for confirmation before they run. You can add your common verification commands to the `allowlistPrefixes` in your config to avoid being prompted.

## Artifacts & Logs

Tool execution logs are stored in the run's artifact directory for auditing and debugging.

**Path:** `.orchestrator/runs/<run-id>/tool_logs/`

Each tool run produces separate stdout and stderr log files if configured, or they are captured in the main trace.

## Sandbox Modes (MVP)

Currently, the CLI supports only the `none` sandbox mode (running directly on the host machine).

- **`mode: none`**: Tools run directly in your shell. You are responsible for the safety of the environment.

**Future Support:**

- `docker`: Run tools inside an isolated Docker container.
- `devcontainer`: Use a devcontainer definition for the environment.

## Monorepo Example (pnpm + turbo)

For a monorepo setup, you might want to allow building and testing specific packages without constant confirmation.

```yaml
# .orchestrator.yaml
execution:
  tools:
    allowlistPrefixes:
      # Allow standard pnpm/turbo commands
      - 'pnpm -r test'
      - 'turbo run build'
      # Allow specific package scripts
      - 'pnpm --filter @my-app/core test'
```
