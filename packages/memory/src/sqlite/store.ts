import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations';
import { MemoryError } from '@orchestrator/shared';
import type {
  MemoryEntry,
  MemoryEntryType,
  MemoryStatus,
  LexicalHit,
  IntegrityStatus,
} from '../types';
import { createCrypto, type Crypto } from './crypto';

export interface LexicalSearchOptions {
  topK?: number;
}

export interface MemoryStoreOptions {
  dbPath: string;
  encryption?: {
    encryptAtRest: boolean;
    key: string;
  };
}

export interface MemoryStore {
  init(options: MemoryStoreOptions): void;
  upsert(entry: MemoryEntry): void;
  search(repoId: string, query: string, options: LexicalSearchOptions): LexicalHit[];
  get(id: string): MemoryEntry | null;
  list(repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[];
  listEntriesForRepo(repoId: string): MemoryEntry[];
  listEntriesWithoutVectors(repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[];
  markVectorUpdated(id: string): void;
  updateStaleFlag(id: string, stale: boolean): void;
  wipe(repoId: string): void;
  status(repoId: string): MemoryStatus;
  close(): void;
}

interface MemoryEntryDbRow {
  id: string;
  repoId: string;
  type: MemoryEntryType;
  title: string;
  content: string;
  evidenceJson: string | null;
  gitSha: string | null;
  fileRefsJson: string | null;
  fileHashesJson: string | null;
  stale: number;
  integrityStatus: IntegrityStatus;
  integrityReasonsJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export function createMemoryStore(): MemoryStore {
  let db: DatabaseSync | null = null;
  let crypto: Crypto | null = null;
  let isEncrypted = false;

  const toSafeFtsQuery = (raw: string): string => {
    const tokens = raw.match(/[a-zA-Z0-9_]+/g);
    if (!tokens || tokens.length === 0) return '';
    return tokens.map((t) => `"${t}"`).join(' AND ');
  };

  const init = (options: MemoryStoreOptions): void => {
    if (options.encryption?.encryptAtRest) {
      if (!options.encryption.key) {
        throw new MemoryError(
          'Encryption is enabled, but no encryption key was provided. Set the ORCHESTRATOR_ENC_KEY environment variable or configure security.encryption.keyEnv.',
          { details: { code: 'ENC_KEY_MISSING' } },
        );
      }
      crypto = createCrypto(options.encryption.key);
      isEncrypted = true;
    }

    mkdirSync(dirname(options.dbPath), { recursive: true });
    db = new DatabaseSync(options.dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
  };

  const close = (): void => {
    if (db) {
      db.close();
      db = null;
    }
  };

  const upsert = (entry: MemoryEntry): void => {
    if (!db) throw new MemoryError('Database not initialized');

    const now = Date.now();

    const entryToStore = { ...entry };
    if (isEncrypted && crypto) {
      entryToStore.content = crypto.encrypt(entry.content);
      if (entry.evidenceJson) {
        entryToStore.evidenceJson = crypto.encrypt(entry.evidenceJson);
      }
    }

    const stmt = db.prepare(
      `
      INSERT INTO memory_entries (
        id, repoId, type, title, content, evidenceJson, gitSha, fileRefsJson, fileHashesJson, stale,
        integrityStatus, integrityReasonsJson, createdAt, updatedAt
      )
      VALUES (
        @id, @repoId, @type, @title, @content, @evidenceJson, @gitSha, @fileRefsJson, @fileHashesJson, @stale,
        @integrityStatus, @integrityReasonsJson, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        repoId = excluded.repoId,
        type = excluded.type,
        title = excluded.title,
        content = excluded.content,
        evidenceJson = excluded.evidenceJson,
        gitSha = excluded.gitSha,
        fileRefsJson = excluded.fileRefsJson,
        fileHashesJson = excluded.fileHashesJson,
        stale = excluded.stale,
        integrityStatus = excluded.integrityStatus,
        integrityReasonsJson = excluded.integrityReasonsJson,
        updatedAt = excluded.updatedAt;
    `,
    );

    stmt.run({
      ...entryToStore,
      stale: entryToStore.stale ? 1 : 0,
      createdAt: entryToStore.createdAt ?? now,
      updatedAt: now,
      evidenceJson: entryToStore.evidenceJson ?? null,
      gitSha: entryToStore.gitSha ?? null,
      fileRefsJson: entryToStore.fileRefsJson ?? null,
      fileHashesJson: entryToStore.fileHashesJson ?? null,
      integrityStatus: entryToStore.integrityStatus ?? 'ok',
      integrityReasonsJson: entryToStore.integrityReasonsJson ?? null,
    });
  };

  const rowToEntry = (row: MemoryEntryDbRow): MemoryEntry => {
    const entry = {
      ...row,
      evidenceJson: row.evidenceJson ?? undefined,
      gitSha: row.gitSha ?? undefined,
      fileRefsJson: row.fileRefsJson ?? undefined,
      fileHashesJson: row.fileHashesJson ?? undefined,
      stale: Boolean(row.stale),
      integrityStatus: row.integrityStatus,
      integrityReasonsJson: row.integrityReasonsJson ?? undefined,
    };

    if (isEncrypted && crypto) {
      entry.content = crypto.decrypt(row.content);
      if (row.evidenceJson) {
        entry.evidenceJson = crypto.decrypt(row.evidenceJson);
      }
    }

    return entry;
  };

  const rowToLexicalHit = (row: MemoryEntryDbRow & { score: number }): LexicalHit => {
    const hit = {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      stale: Boolean(row.stale),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lexicalScore: row.score,
      integrityStatus: row.integrityStatus,
      integrityReasonsJson: row.integrityReasonsJson ?? undefined,
    };

    if (isEncrypted && crypto) {
      hit.content = crypto.decrypt(row.content);
    }

    return hit;
  };

  const get = (id: string): MemoryEntry | null => {
    if (!db) throw new MemoryError('Database not initialized');

    const stmt = db.prepare('SELECT * FROM memory_entries WHERE id = ?');
    const row = stmt.get(id) as MemoryEntryDbRow | undefined;

    return row ? rowToEntry(row) : null;
  };

  const list = (repoId: string, type?: MemoryEntryType, limit?: number): MemoryEntry[] => {
    if (!db) throw new MemoryError('Database not initialized');
    let query = 'SELECT * FROM memory_entries WHERE repoId = ?';
    const params: (string | number)[] = [repoId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY updatedAt DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as unknown as MemoryEntryDbRow[];
    return rows.map(rowToEntry);
  };

  const listEntriesWithoutVectors = (
    repoId: string,
    type?: MemoryEntryType,
    limit?: number,
  ): MemoryEntry[] => {
    if (!db) throw new MemoryError('Database not initialized');
    let query = `
      SELECT me.*
      FROM memory_entries me
      LEFT JOIN memory_vectors mv ON me.id = mv.memory_id
      WHERE me.repoId = ? AND mv.memory_id IS NULL
    `;
    const params: (string | number)[] = [repoId];

    if (type) {
      query += ' AND me.type = ?';
      params.push(type);
    }

    query += ' ORDER BY me.updatedAt DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as unknown as MemoryEntryDbRow[];
    return rows.map(rowToEntry);
  };

  const markVectorUpdated = (id: string): void => {
    if (!db) throw new MemoryError('Database not initialized');
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO memory_vectors (memory_id, updated_at) VALUES (?, ?)',
    );
    stmt.run(id, now);
  };

  const listEntriesForRepo = (repoId: string): MemoryEntry[] => {
    if (!db) throw new MemoryError('Database not initialized');
    const query = 'SELECT * FROM memory_entries WHERE repoId = ?';
    const stmt = db.prepare(query);
    const rows = stmt.all(repoId) as unknown as MemoryEntryDbRow[];
    return rows.map(rowToEntry);
  };

  const updateStaleFlag = (id: string, stale: boolean): void => {
    if (!db) throw new MemoryError('Database not initialized');
    const now = Date.now();
    const stmt = db.prepare('UPDATE memory_entries SET stale = ?, updatedAt = ? WHERE id = ?');
    stmt.run(stale ? 1 : 0, now, id);
  };

  const status = (repoId: string): MemoryStatus => {
    if (!db) throw new MemoryError('Database not initialized');

    const countsStmt = db.prepare(
      'SELECT type, COUNT(*) as count FROM memory_entries WHERE repoId = ? GROUP BY type',
    );
    const countsRows = countsStmt.all(repoId) as {
      type: MemoryEntryType;
      count: number;
    }[];

    const lastUpdatedStmt = db.prepare(
      'SELECT MAX(updatedAt) as lastUpdatedAt FROM memory_entries WHERE repoId = ?',
    );
    const lastUpdatedRow = lastUpdatedStmt.get(repoId) as
      | { lastUpdatedAt: number | null }
      | undefined;

    const staleStmt = db.prepare(
      'SELECT COUNT(*) as count FROM memory_entries WHERE repoId = ? AND stale = 1',
    );
    const staleRow = staleStmt.get(repoId) as { count: number } | undefined;

    const entryCounts: MemoryStatus['entryCounts'] = {
      procedural: 0,
      episodic: 0,
      semantic: 0,
      total: 0,
    };

    for (const row of countsRows) {
      entryCounts[row.type] = row.count;
      entryCounts.total += row.count;
    }

    return {
      entryCounts,
      staleCount: staleRow?.count ?? 0,
      lastUpdatedAt: lastUpdatedRow?.lastUpdatedAt ?? null,
    };
  };

  const search = (repoId: string, query: string, options: LexicalSearchOptions): LexicalHit[] => {
    if (!db) throw new MemoryError('Database not initialized');

    const safeQuery = toSafeFtsQuery(query);
    if (!safeQuery) {
      return [];
    }

    const topK = options.topK ?? 10;
    const stmt = db.prepare(
      `
      SELECT me.*, bm25(memory_entries_fts) as score
      FROM memory_entries_fts fts
      JOIN memory_entries me ON fts.rowid = me.rowid
      WHERE memory_entries_fts MATCH ?
      AND me.repoId = ?
      ORDER BY score
      LIMIT ?;
    `,
    );

    const rows = stmt.all(safeQuery, repoId, topK) as unknown as (MemoryEntryDbRow & {
      score: number;
    })[];
    const entries = rows.map(rowToLexicalHit);

    // The bm25 scores are negative, with lower values being better. We'll normalize them
    // so that a higher score is better. We'll simply invert them.
    const maxScore = Math.max(...entries.map((e) => Math.abs(e.lexicalScore)));

    return entries.map((e) => ({
      ...e,
      lexicalScore: 1 - Math.abs(e.lexicalScore) / maxScore,
    }));
  };

  const wipe = (repoId: string): void => {
    if (!db) throw new MemoryError('Database not initialized');
    // Foreign key with ON DELETE CASCADE will handle memory_vectors
    const stmt = db.prepare('DELETE FROM memory_entries WHERE repoId = ?');
    stmt.run(repoId);
  };

  return {
    init,
    close,
    upsert,
    get,
    list,
    listEntriesForRepo,
    listEntriesWithoutVectors,
    markVectorUpdated,
    updateStaleFlag,
    search,
    status,
    wipe,
  };
}
