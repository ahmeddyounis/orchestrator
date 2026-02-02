# Verification

After making changes to your code, the Orchestrator can automatically run tests and other checks to verify that everything still works correctly. This is a crucial step to ensure the quality and safety of the changes.

## Automatic Verification

Verification is enabled by default. After the orchestrator has applied a code change, it will automatically perform the following steps:

1.  **Detect Test Commands**: The orchestrator inspects your `package.json` files to find your test and linting scripts. It looks for common script names like `"test"`, `"lint"`, and `"typecheck"`.
2.  **Run Checks**: It executes the detected commands. For a `pnpm` monorepo, it's smart enough to only run tests for the packages that were actually changed, which saves time.
3.  **Report Results**: If any of the verification steps fail, the orchestrator will report the failure and provide the error output. The proposed code changes will not be considered successful.

## Disabling Verification

While it's highly recommended to keep verification enabled, you can disable it for a specific run using `--verify off`:

```bash
orchestrator run "Update the README" --verify off
```

This is useful for tasks that don't affect the code, like updating documentation.

## Configuration

For most JavaScript/TypeScript projects, automatic detection works out of the box. You can tune verification in your `.orchestrator.yaml` or `~/.orchestrator/config.yaml`.

### Verification Scope

- **Targeted (default)**: The orchestrator only runs verification in the workspace packages that were directly affected by the changes. This is the default behavior in a monorepo and is much faster.
- **Full**: You can force the orchestrator to run verification across all packages, even if they weren't changed.

To force a full verification run for a single command:

```bash
orchestrator run "…" --verify-scope full
```

To configure defaults:

```yaml
verification:
  enabled: true
  mode: auto # auto | custom
  auto:
    enableLint: true
    enableTypecheck: true
    enableTests: true
    testScope: targeted # targeted | full
```

For a fully custom verification pipeline:

```yaml
verification:
  enabled: true
  mode: custom
  steps:
    - name: lint
      command: pnpm lint
      required: true
      timeoutMs: 600000
    - name: test
      command: pnpm test
      required: true
```
