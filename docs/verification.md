# Verification

The Orchestrator includes a verification step to ensure that changes are safe and meet quality standards. This typically involves running tests, linters, and other checks against your codebase.

## How it Works

When you run `orchestrator run` with verification enabled (the default), it will execute the verification commands defined in your `orchestrator.config.json` file. The Orchestrator attempts to automatically detect your project setup and configure sensible defaults.

### Automatic Detection (pnpm + turbo)

For monorepos using `pnpm` and `turborepo`, the Orchestrator will automatically detect which packages have changed and run the verification commands only for those packages. This is called **targeted verification**.

If you want to force verification to run for all packages, you can use the `--verify-scope=full` flag.

## Configuration

You can customize the verification behavior in your `orchestrator.config.json` file.

### Verification Commands

The `verify` section of the config file allows you to define the commands to run. You can specify commands for `format`, `lint`, and `test`.

**Example:**

```json
{
  "verify": {
    "format": "prettier --check .",
    "lint": "eslint .",
    "test": "vitest run"
  }
}
```

### Targeted vs. Full Verification

- **Targeted (default):** The Orchestrator only verifies changed packages. This is faster for large projects.
- **Full:** The Orchestrator verifies all packages. This is more thorough but slower.

You can control this with the `--verify-scope` flag or the `scope` property in the `verify` config.

**Example:**

```json
{
  "verify": {
    "scope": "full",
    "commands": {
      "format": "prettier --check .",
      "lint": "eslint .",
      "test": "vitest run"
    }
  }
}
```

## Logs and Reports

Verification logs are stored in the `.orchestrator/logs` directory. Each run will have a corresponding log file.

If verification fails, the output from the failed command will be in the log file, which can help you debug the issue.

## Common Failure Modes

- **Missing Dependencies:** Ensure that all dependencies are installed before running the orchestrator.
- **Blocked Tools:** If you have security software that might block the execution of certain command-line tools, you may need to add exceptions.
- **Timeouts:** Long-running verification steps might time out. You can adjust timeouts in the configuration.
- **Misconfigured Commands:** Ensure the commands in your config are correct and can run successfully in your local environment.

## Interpreting Verification Artifacts

The verification status is reported in the run summary.

- **Verified:** All verification steps passed.
- **Verification Failed:** One or more verification steps failed. Check the logs for details.
- **Verification Skipped:** Verification was disabled for the run.
