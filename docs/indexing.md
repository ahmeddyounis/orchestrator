# Indexing

To understand your project, the Orchestrator creates an "index" of your code. This index is a local, searchable database of your files, classes, functions, and other symbols. It's the key to how the orchestrator can quickly find relevant code when you give it a task.

## Creating the Index

To create the index for your project, run this in your repository root:

```bash
orchestrator index build
```

This will scan your project and create the index in the `.orchestrator/` directory. You only need to do this once for each project.

## Automatic Updates & Staleness

Your code is always changing. The orchestrator knows this and will automatically update the index with your latest changes at the beginning of each `run` command.

This incremental update is very fast and ensures that the orchestrator is always working with the most up-to-date version of your code.

### What if I change branches?

If you make a large change, like switching git branches, the index might become "stale". The orchestrator will detect this and automatically re-index the necessary files to catch up.

You don't need to manually re-index every time you change a file. The orchestrator handles this for you.

## When to Manually Re-index

You should only need to manually run indexing commands in a few situations:

- When you first set up a project.
- If you've made massive changes to your project (e.g., upgrading a framework or refactoring the entire codebase).
- If the orchestrator seems to be confused or working with outdated information.

For incremental updates, prefer:

```bash
orchestrator index update
```

## Indexing Status

You can check the status of your index at any time:

```bash
orchestrator index status
```

This will tell you how many files are in the index and when it was last updated.
