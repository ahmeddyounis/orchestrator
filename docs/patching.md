# Patching & Recovery

The Orchestrator uses a robust patching model designed to ensure code integrity and recoverability. This document explains how patches are applied, how changes are isolated, and how to control the process.

## Branch Lifecycle

To prevent accidental damage to your main working branch, the Orchestrator automatically isolates its work:

1.  **Start**: A new branch `agent/<runId>` is created and checked out.
    *   `runId` is the timestamp of the run start.
2.  **Work**: All patches and modifications happen on this branch.
3.  **Completion**: The branch remains checked out so you can review changes.

### Clean Working Tree Policy
By default, the Orchestrator requires a clean working tree (no uncommitted changes) to start. This ensures that:
1.  Checkpoints capture only the agent's changes.
2.  Rollbacks don't accidentally wipe your uncommitted work.

## Checkpoints and Rollback

The system maintains a "checkpoint" mechanism using Git commits.

### How it works
1.  **Checkpoint**: After every successful patch application, the Orchestrator creates a git commit with the message `Checkpoint: After <description>`.
2.  **Rollback**: If a patch fails to apply (e.g., conflicts or errors), the system automatically rolls back to `HEAD` (the last successful checkpoint).

### Disabling Checkpoints (Auto-Commit)
You can disable the automatic creation of commit checkpoints by setting `execution.noCheckpoints: true` in your config.

**Warning**: Disabling checkpoints removes the incremental safety net. If a patch fails and triggers a rollback, it will revert to the state at the beginning of the run (or the last manual commit), potentially undoing *all* successful patches in that run.

## Allowing Dirty Working Tree

If you need to run the agent on top of uncommitted changes, you can enable `execution.allowDirtyWorkingTree: true`.

**⚠️ DANGER: DATA LOSS RISK**
If you enable this setting:
1.  **Committed Dirt**: If a checkpoint is created, your "dirty" changes will be included in the commit.
2.  **Wiped Dirt**: If a patch fails and a rollback occurs, `git reset --hard` is used. This **WILL DELETE** your original uncommitted changes.

**Recommendation**: Always commit or stash your changes before running the Orchestrator.

## Artifacts

At the end of a run, the Orchestrator saves a final diff of all changes made during the session.
-   Location: `.orchestrator/runs/<runId>/patches/diff.patch`
-   This file contains the unified diff of the entire `agent/<runId>` branch against the start state.

## How to Undo Everything

Since changes are isolated in a branch, undoing everything is safe and easy:

1.  Switch back to your original branch:
    ```bash
    git checkout main
    ```
    *(Replace `main` with your branch name)*

2.  Delete the agent branch:
    ```bash
    git branch -D agent/<runId>
    ```

## CLI Flags

-   `--allow-large-diff`: By default, large patches require user confirmation. Use this flag to auto-approve large patches.
