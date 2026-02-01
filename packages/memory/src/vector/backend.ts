// packages/memory/src/vector/backend.ts

/**
 * Context for vector backend operations.
 * Provides cancellation support and optional timeout configuration.
 */
export interface VectorBackendContext {
  /** Signal to abort the operation */
  signal?: AbortSignal;
  /** Timeout in milliseconds for remote operations */
  timeoutMs?: number;
}

/**
 * Metadata for a vector item stored in the backend.
 */
export interface VectorItemMetadata {
  type: string;
  stale: boolean;
  updatedAt: number;
}

/**
 * Item to upsert into the vector backend.
 */
export interface VectorUpsertItem {
  id: string;
  vector: Float32Array;
  metadata: VectorItemMetadata;
}

/**
 * Result from a vector query.
 */
export interface VectorQueryResult {
  id: string;
  score: number;
}

/**
 * Filters for vector queries.
 */
export interface VectorQueryFilters {
  type?: string;
  stale?: boolean;
}

/**
 * Backend information returned by info().
 */
export interface VectorBackendInfo {
  backend: string;
  dims: number;
  embedderId: string;
  location: string;
  supportsFilters: boolean;
}

/**
 * Common interface for all vector memory storage backends.
 * All methods support cancellation via AbortSignal in the context.
 */
export interface VectorMemoryBackend {
  /**
   * Initializes the backend. Can be used for migrations, connecting to remote services, etc.
   */
  init(ctx: VectorBackendContext): Promise<void>;

  /**
   * Inserts or updates a batch of items.
   */
  upsert(
    ctx: VectorBackendContext,
    repoId: string,
    items: VectorUpsertItem[]
  ): Promise<void>;

  /**
   * Queries for the top K most similar items.
   */
  query(
    ctx: VectorBackendContext,
    repoId: string,
    queryVector: Float32Array,
    topK: number,
    filters?: VectorQueryFilters
  ): Promise<VectorQueryResult[]>;

  /**
   * Deletes items by their IDs.
   */
  deleteByIds(
    ctx: VectorBackendContext,
    repoId: string,
    ids: string[]
  ): Promise<void>;

  /**
   * Deletes all data associated with a repository.
   */
  wipeRepo(ctx: VectorBackendContext, repoId: string): Promise<void>;

  /**
   * Returns metadata about the backend.
   * Used by CLI status commands.
   */
  info(ctx: VectorBackendContext): Promise<VectorBackendInfo>;
}
