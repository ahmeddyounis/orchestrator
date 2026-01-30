# Indexing

The Orchestrator's indexing service is responsible for creating and maintaining a searchable index of your codebase. This index is used by various components, including the context provider and memory system, to quickly find relevant information.

## How it Works

The indexer periodically scans your project files, parsing them to extract key information such as file structure, declared symbols (classes, functions, variables), and other metadata. This data is stored in a local database, enabling fast and efficient search operations.

By default, the indexer respects your `.gitignore` and `.orchestrator/.ignore` files, ensuring that irrelevant or sensitive files are not included in the index.

## Automatic Updates

To ensure the index remains fresh and accurate, the Orchestrator automatically performs an incremental update at the start of each run. When you invoke a command like `orchestrator run`, the indexer first identifies any files that have been created, modified, or deleted since the last run.

This incremental update is designed to be fast and efficient, only re-indexing the files that have changed.

### `maxAutoUpdateFiles` Safeguard

In large repositories, a significant number of files might change between runs (e.g., after switching branches or pulling a large update). To prevent unexpectedly long indexing times, the Orchestrator includes a safeguard: `maxAutoUpdateFiles`.

If the number of files needing an update exceeds this threshold, the automatic update is skipped, and a warning is logged. This ensures that the run can proceed without a lengthy delay.

You can configure this value in your `.orchestrator/config.json`:

```json
{
  "indexing": {
    "maxAutoUpdateFiles": 100
  }
}
```

If you frequently encounter this warning, you can either increase the limit or manually trigger a full re-index during a convenient time using the `orchestrator index re-index` command.

## Manual Indexing

You can manually control the indexing process using the following commands:

| Command                       | Description                                         |
| :---------------------------- | :-------------------------------------------------- |
| `orchestrator index re-index` | Performs a full scan and rebuilds the entire index. |
| `orchestrator index status`   | Shows the current status of the index.              |
| `orchestrator index search`   | (Future) Searches the index for a given query.      |
