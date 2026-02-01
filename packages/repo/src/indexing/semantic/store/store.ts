// packages/repo/src/indexing/semantic/store/store.ts

import Database, { type Database as DB } from 'better-sqlite3';
import { CREATE_TABLES_SQL } from './schema';
import {
  type Chunk,
  type Embedding,
  type FileMeta,
  type SemanticIndexMeta,
  SCHEMA_VERSION,
} from './types';

function float32ArrayToBase64(array: Float32Array): string {
  const buffer = Buffer.from(array.buffer);
  return buffer.toString('base64');
}

function base64ToFloat32Array(base64: string): Float32Array {
  const buffer = Buffer.from(base64, 'base64');
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT,
  );
}

export class SemanticIndexStore {
  private db: DB | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.exec(CREATE_TABLES_SQL);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private getDb(): DB {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  getMeta(): SemanticIndexMeta | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM semantic_meta');
    const meta = stmt.get() as any;
    if (meta) {
      return {
        ...meta,
      };
    }
    return null;
  }

  setMeta(meta: SemanticIndexMeta): void {
    const db = this.getDb();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO semantic_meta (repoId, repoRoot, embedderId, dims, builtAt, updatedAt, schemaVersion) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      meta.repoId,
      meta.repoRoot,
      meta.embedderId,
      meta.dims,
      meta.builtAt,
      meta.updatedAt,
      SCHEMA_VERSION,
    );
  }

  upsertFileMeta(fileMeta: FileMeta): void {
    const db = this.getDb();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO semantic_files (path, fileHash, language, mtimeMs, sizeBytes) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(
      fileMeta.path,
      fileMeta.fileHash,
      fileMeta.language,
      fileMeta.mtimeMs,
      fileMeta.sizeBytes,
    );
  }

  deleteFile(path: string): void {
    const db = this.getDb();
    // Deletion will cascade to chunks and embeddings due to FOREIGN KEY constraints
    const stmt = db.prepare('DELETE FROM semantic_files WHERE path = ?');
    stmt.run(path);
  }

  getAllFiles(): FileMeta[] {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM semantic_files');
    return stmt.all() as FileMeta[];
  }

  replaceChunksForFile(path: string, chunks: Chunk[]): void {
    const db = this.getDb();
    const transaction = db.transaction(() => {
      // First, delete existing chunks for the file.
      // This will cascade to embeddings.
      const deleteChunksStmt = db.prepare('DELETE FROM semantic_chunks WHERE path = ?');
      deleteChunksStmt.run(path);

      // Then, insert the new chunks.
      const insertChunkStmt = db.prepare(
        'INSERT INTO semantic_chunks (chunkId, path, language, kind, name, parentName, startLine, endLine, content, fileHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const chunk of chunks) {
        insertChunkStmt.run(
          chunk.chunkId,
          chunk.path,
          chunk.language,
          chunk.kind,
          chunk.name,
          chunk.parentName,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          chunk.fileHash,
        );
      }
    });
    transaction();
  }

  upsertEmbeddings(embeddings: Map<string, Float32Array>): void {
    const db = this.getDb();
    const transaction = db.transaction(() => {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO semantic_embeddings (chunkId, vectorB64) VALUES (?, ?)',
      );
      for (const [chunkId, vector] of embeddings.entries()) {
        stmt.run(chunkId, float32ArrayToBase64(vector));
      }
    });
    transaction();
  }

  getAllEmbeddings(): Map<string, Float32Array> {
    const db = this.getDb();
    const stmt = db.prepare(
      'SELECT chunkId, vectorB64 FROM semantic_embeddings WHERE vectorB64 IS NOT NULL',
    );
    const rows = stmt.all() as { chunkId: string; vectorB64: string }[];

    const embeddings = new Map<string, Float32Array>();
    for (const row of rows) {
      embeddings.set(row.chunkId, base64ToFloat32Array(row.vectorB64));
    }
    return embeddings;
  }
}
