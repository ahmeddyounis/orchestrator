# Verification

After making changes to your code, the Orchestrator can automatically run tests and other checks to verify that everything still works correctly. This is a crucial step to ensure the quality and safety of the changes.

## Automatic Verification

Verification is enabled by default. After the orchestrator has applied a code change, it will automatically perform the following steps:

1.  **Detect Test Commands**: The orchestrator inspects your `package.json` files to find your test and linting scripts. It looks for common script names like `"test"`, `"lint"`, and `"typecheck"`.
2.  **Run Checks**: It executes the detected commands. For a `pnpm` monorepo, it's smart enough to only run tests for the packages that were actually changed, which saves time.
3.  **Report Results**: If any of the verification steps fail, the orchestrator will report the failure and provide the error output. The proposed code changes will not be considered successful.

## Disabling Verification

While it's highly recommended to keep verification enabled, you can disable it for a specific run using the `--no-verify` flag:

```bash
orchestrator run "Update the README" --no-verify
```

This is useful for tasks that don't affect the code, like updating documentation.

## Configuration

For most JavaScript/TypeScript projects, the automatic detection will work out of the box. However, you can customize the verification commands in your `.orchestrator/config.json` file if needed.

```json
{
  "verification": {
    "commands": {
      "test": "pnpm test:unit",
      "lint": "pnpm lint:ci",
      "typecheck": "pnpm typecheck"
    }
  }
}
```

If you have a non-standard setup, you can specify the exact commands to run for testing, linting, and type-checking.

### Verification Scope

- **Targeted (default)**: The orchestrator only runs verification in the workspace packages that were directly affected by the changes. This is the default behavior in a monorepo and is much faster.
- **Full**: You can force the orchestrator to run verification across all packages, even if they weren't changed.

To force a full verification run, you can set the scope in your configuration:

```json
{
  "verification": {
    "scope": "full"
  }
}
```
