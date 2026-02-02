# Vector and Hybrid Memory

The orchestrator's memory can operate in different modes to retrieve relevant context. Beyond standard lexical (keyword) search, it supports vector-based semantic search, which can often provide more contextually relevant results.

## Modes

You can control the retrieval mode using the `memory.retrieval.mode` configuration key or the `--memory-mode` CLI flag.

- **`lexical` (Default):** Uses a traditional full-text search (FTS) engine. This mode is fast, works entirely locally, and is effective for finding exact keywords and phrases.

- **`vector`:** Uses a vector database to find semantically similar context. Instead of matching keywords, it matches the _meaning_ of the query. This requires generating embeddings for your code and queries.

- **`hybrid`:** A combination of `lexical` and `vector` search. It retrieves results from both methods and then re-ranks them to produce a final, often superior, set of results. This is the recommended mode when using vector memory.

If vector search fails in `hybrid` mode (e.g., the vector database is unavailable), it will automatically fall back to `lexical` search.

## Embeddings

Vector search relies on "embeddings," which are numerical representations (vectors) of your code and queries.

Embeddings are configured via `memory.vector.embedder` (for example: `memory.vector.embedder.provider`).

1.  **`local-hash` (Default):** A simple, fast, and entirely local method that generates a hash-based representation. This does not require any external services or API keys. It provides basic semantic capabilities but is less sophisticated than provider-based embeddings.

2.  **Provider-based (`openai`):** Uses an external embedding model from OpenAI. This produces higher-quality embeddings, leading to better search results. However, it requires sending content to a third-party API and may incur costs.

### Privacy and Data Storage

A critical aspect of vector memory is understanding what data is stored where.

- **Local Storage:** The original source code and file content **always** remain on your local machine.
- **Vector Database:** The vector database stores:
  - The numerical vectors (embeddings).
  - Minimal metadata, such as the file path or an internal ID to link the vector back to the local content.

When using a **remote vector backend**, only these vectors and their associated metadata are sent and stored remotely. The raw code content is NOT sent to the remote vector database. However, when using a **provider-based embedder**, the content is sent to the embedding provider (e.g., OpenAI) to generate the vectors.

**Summary of Data Flow:**

| Component              | Data Sent/Stored                     | Location                                |
| ---------------------- | ------------------------------------ | --------------------------------------- |
| **Local Code**         | -                                    | Your local machine                      |
| **Embedding Provider** | Source code chunks to be embedded    | Third-party service (e.g., OpenAI)      |
| **Vector Backend**     | Numerical vectors + file identifiers | Local (SQLite) or Remote (Qdrant, etc.) |

## Backends

The orchestrator supports different backends for storing vectors, configured via `memory.vector.backend`.

### `sqlite` (Default)

This is the default backend. It's self-contained and stores all vectors in a single file on your local disk (`.orchestrator/memory_vectors.sqlite`). It's the simplest way to get started with vector memory.

**Configuration (`.orchestrator.yaml`):**

```yaml
memory:
  enabled: true
  retrieval:
    mode: hybrid
  vector:
    enabled: true
    backend: sqlite
    embedder:
      provider: local-hash
```

### `qdrant`

[Qdrant](https://qdrant.tech/) is a powerful, open-source vector database that can be run locally via Docker or used as a managed cloud service.

**WARNING:** Using a remote Qdrant instance requires your explicit consent, as vector data will be sent over the network.

**Configuration (`.orchestrator.yaml`):**

```yaml
memory:
  enabled: true
  retrieval:
    mode: hybrid
  vector:
    enabled: true
    backend: qdrant
    remoteOptIn: true
    embedder:
      provider: local-hash
    qdrant:
      url: http://localhost:6333
      collection: my-project-repo
```

You can enable this from the CLI:

```sh
orchestrator run "…" --memory-mode hybrid --memory-vector-backend qdrant --memory-remote-opt-in
```

### `chroma`

[Chroma](https://www.trychroma.com/) is another popular open-source vector database.

**WARNING:** Using a remote Chroma instance requires your explicit consent, as vector data will be sent over the network.

**Configuration (`.orchestrator.yaml`):**

```yaml
memory:
  enabled: true
  retrieval:
    mode: hybrid
  vector:
    enabled: true
    backend: chroma
    remoteOptIn: true
    embedder:
      provider: local-hash
    chroma:
      url: http://localhost:8000
      collection: my-project-repo
```

### `pgvector`

[pgvector](https://github.com/pgvector/pgvector) is a PostgreSQL extension for vector similarity search.

**WARNING:** Using a remote PostgreSQL instance requires your explicit consent, as vector data will be sent over the network.

**Configuration (`.orchestrator.yaml`):**

```yaml
memory:
  enabled: true
  retrieval:
    mode: hybrid
  vector:
    enabled: true
    backend: pgvector
    remoteOptIn: true
    embedder:
      provider: local-hash
    pgvector:
      connectionStringEnv: DATABASE_URL
```

## Backfilling and Wiping

When you first enable vector memory, the database is empty. You need to populate it with embeddings from your codebase.

### Backfilling

The `memory reembed` command generates embeddings and backfills missing vectors into the configured vector backend.

```sh
# Embed entries that don't have vectors yet
orchestrator memory reembed

# Force re-embedding for all files
orchestrator memory reembed --force-all
```

### Wiping

The `memory wipe` command clears memory entries for the current repository. If vector memory is enabled, it also wipes the vector backend entries for the repo.

```sh
orchestrator memory wipe
```

## Troubleshooting

- **Vector Backend Unavailable:** If a remote vector backend cannot be reached, `hybrid` mode will gracefully fall back to `lexical` search. The `vector` mode will fail.
- **`remoteOptIn` Error:** If you see an error like `Remote vector backend "qdrant" requires explicit opt-in`, you must set `memory.vector.remoteOptIn` to `true` in your config file or use the `--memory-remote-opt-in` flag. This is a safety measure to ensure you are aware that data is being sent to a remote service.
