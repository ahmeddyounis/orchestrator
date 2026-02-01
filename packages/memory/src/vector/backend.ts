// packages/memory/src/vector/backend.ts

/** Metadata stored alongside each vector */
export interface VectorMetadata {
  type: string;
  stale: boolean;
  updatedAt: number;
  embedderId?: string;
  dims?: number;
}

/** A vector item to be stored or retrieved */
export interface VectorItem {
  id: string;
  vector: Float32Array;
  metadata: VectorMetadata;
}

/** Result from a vector query */
export interface VectorQueryResult {
  id: string;
  score: number;
  metadata?: VectorMetadata;
}

/** Filter options for vector queries */
export interface VectorQueryFilter {
  type?: string;
  stale?: boolean;
}

/** Backend metadata information */
export interface VectorBackendInfo {
  backend: string;
  dims: number;
  embedderId: string;
  location: string;
  supportsFilters: boolean;
}

/** Configuration for a vector backend */
export interface VectorBackendConfig {
  backend: string;
  path?: string;
  maxCandidates?: number;
}

/**
 * Interface for vector memory backends.
 * All methods accept a context object as first parameter for future extensibility.
 */
export interface VectorMemoryBackend {
  /** Initialize the backend */
  init(ctx: object): Promise<void>;

  /** Insert or update vectors */
  upsert(ctx: object, repoId: string, items: VectorItem[]): Promise<void>;

  /** Query vectors by similarity, returning topK results sorted by score descending */
  query(
    ctx: object,
    repoId: string,
    vector: Float32Array,
    topK: number,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]>;

  /** Delete specific vectors by their IDs */
  deleteByIds(ctx: object, repoId: string, ids: string[]): Promise<void>;

  /** Delete all vectors for a repository */
  wipeRepo(ctx: object, repoId: string): Promise<void>;

  /** Get backend metadata */
  info(ctx: object): Promise<VectorBackendInfo>;

  /** Close the backend and release resources */
  close?(): Promise<void>;
}

// Legacy interface for backward compatibility
export interface Vector {
  id: string;
  vector: number[];
  metadata?: object;
}

// Legacy interface for backward compatibility
export interface LegacyVectorMemoryBackend {
  upsert(repoId: string, vectors: Vector[]): Promise<void>;
  query(repoId: string, vector: number[], topK: number): Promise<string[]>;
  wipeRepo(repoId: string): Promise<void>;
  isRepoEmpty(repoId: string): Promise<boolean>;
}
