// packages/memory/src/vector/sqlite/sqlite-backend.ts

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  VectorMemoryBackend,
  VectorItem,
  VectorQueryResult,
  VectorQueryFilter,
  VectorBackendInfo,
} from '../backend';

const DEFAULT_MAX_CANDIDATES = 20_000;

/** Database row representation */
interface VectorRow {
  repoId: string;
  entryId: string;
  embedderId: string | null;
  dims: number;
  updatedAt: number;
  stale: number;
  type: string;
  vectorBlob: Uint8Array;
}

/** Cosine similarity between two Float32Arrays */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  return dotProduct / magnitude;
}

/** Convert Float32Array to Uint8Array (for BLOB storage) */
function float32ToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** Convert Uint8Array back to Float32Array */
function blobToFloat32(blob: Uint8Array): Float32Array {
  // Create a copy to ensure proper alignment
  const buffer = new ArrayBuffer(blob.length);
  const view = new Uint8Array(buffer);
  view.set(blob);
  return new Float32Array(buffer);
}

/** SQLite-backed vector store with brute-force cosine similarity search */
export class SQLiteVectorBackend implements VectorMemoryBackend {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private maxCandidates: number;

  constructor(dbPath?: string, maxCandidates: number = DEFAULT_MAX_CANDIDATES) {
    this.dbPath = dbPath ?? '.orchestrator/memory_vectors.sqlite';
    this.maxCandidates = maxCandidates;
  }

  /** Run database migrations */
  private runMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        repoId TEXT NOT NULL,
        entryId TEXT NOT NULL,
        embedderId TEXT,
        dims INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        vectorBlob BLOB NOT NULL,
        PRIMARY KEY (repoId, entryId)
      );
    `);

    // Create index for efficient filtering
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_vectors_repo_type_stale 
      ON memory_vectors (repoId, type, stale);
    `);
  }

  async init(_ctx: object): Promise<void> {
    if (this.db) return;

    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.runMigrations();
  }

  async upsert(_ctx: object, repoId: string, items: VectorItem[]): Promise<void> {
    if (!this.db) {
      throw new Error('SQLiteVectorBackend not initialized. Call init() first.');
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors 
      (repoId, entryId, embedderId, dims, updatedAt, stale, type, vectorBlob)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        const blob = float32ToBlob(item.vector);
        stmt.run(
          repoId,
          item.id,
          item.metadata.embedderId ?? null,
          item.metadata.dims ?? item.vector.length,
          item.metadata.updatedAt,
          item.metadata.stale ? 1 : 0,
          item.metadata.type,
          blob,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async query(
    _ctx: object,
    repoId: string,
    vector: Float32Array,
    topK: number,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]> {
    if (!this.db) {
      throw new Error('SQLiteVectorBackend not initialized. Call init() first.');
    }

    // Build query with optional filters
    let query = 'SELECT * FROM memory_vectors WHERE repoId = ?';
    const params: (string | number)[] = [repoId];

    if (filter?.type !== undefined) {
      query += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.stale !== undefined) {
      query += ' AND stale = ?';
      params.push(filter.stale ? 1 : 0);
    }

    // Enforce max candidates cap to avoid runaway memory
    query += ` LIMIT ${this.maxCandidates}`;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as unknown as VectorRow[];

    // Compute cosine similarity for each row
    const results: VectorQueryResult[] = [];
    for (const row of rows) {
      const storedVector = blobToFloat32(row.vectorBlob);
      const score = cosineSimilarity(vector, storedVector);

      results.push({
        id: row.entryId,
        score,
        metadata: {
          type: row.type,
          stale: row.stale === 1,
          updatedAt: row.updatedAt,
          embedderId: row.embedderId ?? undefined,
          dims: row.dims,
        },
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  async deleteByIds(_ctx: object, repoId: string, ids: string[]): Promise<void> {
    if (!this.db) {
      throw new Error('SQLiteVectorBackend not initialized. Call init() first.');
    }

    if (ids.length === 0) return;

    // Use placeholders for the IDs
    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `DELETE FROM memory_vectors WHERE repoId = ? AND entryId IN (${placeholders})`,
    );
    stmt.run(repoId, ...ids);
  }

  async wipeRepo(_ctx: object, repoId: string): Promise<void> {
    if (!this.db) {
      throw new Error('SQLiteVectorBackend not initialized. Call init() first.');
    }

    const stmt = this.db.prepare('DELETE FROM memory_vectors WHERE repoId = ?');
    stmt.run(repoId);
  }

  async info(_ctx: object): Promise<VectorBackendInfo> {
    return {
      backend: 'sqlite',
      dims: 384, // Default dimension
      embedderId: 'local-hash', // Default embedder
      location: this.dbPath,
      supportsFilters: true,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
