// packages/repo/src/indexing/semantic/store/store.ts

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CREATE_TABLES_SQL } from './schema';
import { type Chunk, type FileMeta, type SemanticIndexMeta, SCHEMA_VERSION } from './types';

type DB = DatabaseSync;

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
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // node:sqlite may enable FK enforcement depending on build/runtime; we handle cascades manually.
    this.db.exec('PRAGMA foreign_keys = OFF');
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
    const metaRow = stmt.get() as SemanticIndexMeta | undefined;
    return metaRow ?? null;
  }

  getStats(): { fileCount: number; chunkCount: number; embeddingCount: number } {
    const db = this.getDb();
    const fileCount = (
      db.prepare('SELECT COUNT(*) as count FROM semantic_files').get() as {
        count: number;
      }
    ).count;
    const chunkCount = (
      db.prepare('SELECT COUNT(*) as count FROM semantic_chunks').get() as {
        count: number;
      }
    ).count;
    const embeddingCount = (
      db.prepare('SELECT COUNT(*) as count FROM semantic_embeddings').get() as {
        count: number;
      }
    ).count;

    return { fileCount, chunkCount, embeddingCount };
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
      meta.schemaVersion ?? SCHEMA_VERSION,
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
    db.exec('BEGIN TRANSACTION');
    try {
      // Delete embeddings/chunks explicitly so tests (and callers) don't rely on FK pragmas.
      db.prepare(
        'DELETE FROM semantic_embeddings WHERE chunkId IN (SELECT chunkId FROM semantic_chunks WHERE path = ?)',
      ).run(path);
      db.prepare('DELETE FROM semantic_chunks WHERE path = ?').run(path);
      db.prepare('DELETE FROM semantic_files WHERE path = ?').run(path);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  getAllFiles(): FileMeta[] {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM semantic_files');
    return stmt.all() as unknown as FileMeta[];
  }

  replaceChunksForFile(path: string, chunks: Chunk[]): void {
    const db = this.getDb();
    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare(
        'DELETE FROM semantic_embeddings WHERE chunkId IN (SELECT chunkId FROM semantic_chunks WHERE path = ?)',
      ).run(path);

      // First, delete existing chunks for the file.
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
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  upsertEmbeddings(embeddings: Map<string, Float32Array>): void {
    const db = this.getDb();
    db.exec('BEGIN TRANSACTION');
    try {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO semantic_embeddings (chunkId, vectorB64) VALUES (?, ?)',
      );
      for (const [chunkId, vector] of embeddings.entries()) {
        stmt.run(chunkId, float32ArrayToBase64(vector));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
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

  getAllChunksWithEmbeddings(): (Chunk & { vector: Float32Array })[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT c.*, e.vectorB64
      FROM semantic_chunks c
      JOIN semantic_embeddings e ON c.chunkId = e.chunkId
      WHERE e.vectorB64 IS NOT NULL
    `);

    const rows = stmt.all() as unknown as (Chunk & { vectorB64: string })[];

    return rows.map((row) => ({
      ...row,
      vector: base64ToFloat32Array(row.vectorB64),
    }));
  }
}
