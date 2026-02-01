# Memory

The orchestrator has a sophisticated memory system that allows it to retain context between runs, leading to more efficient and intelligent assistance. This system is divided into short-term memory (for the current session) and long-term memory (persisted across sessions).

Long-term memory can be further enhanced with different retrieval strategies, including lexical search and advanced vector-based semantic search.

## How it Works

When memory is enabled, the orchestrator saves information about each run to a local database in your project's `.orchestrator` directory. This includes:

- The objectives of the run.
- Files that were read or modified.
- Commands that were executed.
- The final outcome.

On subsequent runs, the orchestrator can query this memory to retrieve relevant context, enabling "warm starts" for iterative development and a deeper understanding of your project's history.

## Enabling Memory

You can enable long-term memory in your configuration file by setting `memory.enabled` to `true`.

**`.orchestrator.jsonc`:**

```jsonc
{
  "memory": {
    "enabled": true,
  },
}
```

## Retrieval Modes: Lexical, Vector, and Hybrid

The real power of the memory system comes from its different retrieval modes, which determine how the orchestrator finds relevant information from its long-term store.

- **`lexical` (Default):** A fast and reliable keyword-based search.
- **`vector`:** A powerful semantic search that understands the _meaning_ of your query, not just the keywords.
- **`hybrid`:** The recommended mode, which combines the strengths of both `lexical` and `vector` search.

For a detailed explanation of these modes, how they work, and how to configure advanced backends (like Qdrant, Chroma, or pgvector), please see the **[Vector and Hybrid Memory](./memory-vector.md)** documentation.

## Privacy

Your memory database, including both lexical and vector data (if using the default `sqlite` backend), is stored locally within your project directory. It is never sent to any remote server.

If you configure a [remote vector backend](./memory-vector.md#backends), only numerical embeddings and file identifiers are sent, not your source code. Please read the privacy details carefully before enabling remote backends.

## Wiping Memory

To clear the memory for a project, use the `memory wipe` command.

```sh
# Wipe the lexical memory index
gemini memory wipe

# Wipe the vector memory index
gemini memory wipe --vector

# Wipe both
gemini memory wipe --all
```
