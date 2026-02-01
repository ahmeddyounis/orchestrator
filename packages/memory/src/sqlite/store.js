'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createMemoryStore = createMemoryStore;
const node_fs_1 = require('node:fs');
const node_path_1 = require('node:path');
const node_sqlite_1 = require('node:sqlite');
const migrations_1 = require('./migrations');
const ranking_1 = require('../ranking');
const shared_1 = require('@orchestrator/shared');
function createMemoryStore() {
  let db = null;
  const init = (dbPath) => {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(dbPath), { recursive: true });
    db = new node_sqlite_1.DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    (0, migrations_1.runMigrations)(db);
  };
  const close = () => {
    if (db) {
      db.close();
      db = null;
    }
  };
  const upsert = (entry) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO memory_entries (
        id, repoId, type, title, content, evidenceJson, gitSha, fileRefsJson, fileHashesJson, stale, createdAt, updatedAt
      )
      VALUES (
        @id, @repoId, @type, @title, @content, @evidenceJson, @gitSha, @fileRefsJson, @fileHashesJson, @stale, @createdAt, @updatedAt
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
        updatedAt = excluded.updatedAt;
    `);
    stmt.run({
      ...entry,
      stale: entry.stale ? 1 : 0,
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
      evidenceJson: entry.evidenceJson ?? null,
      gitSha: entry.gitSha ?? null,
      fileRefsJson: entry.fileRefsJson ?? null,
      fileHashesJson: entry.fileHashesJson ?? null,
    });
  };
  const rowToEntry = (row) => {
    return {
      ...row,
      evidenceJson: row.evidenceJson ?? undefined,
      gitSha: row.gitSha ?? undefined,
      fileRefsJson: row.fileRefsJson ?? undefined,
      fileHashesJson: row.fileHashesJson ?? undefined,
      stale: Boolean(row.stale),
    };
  };
  const get = (id) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const stmt = db.prepare('SELECT * FROM memory_entries WHERE id = ?');
    const row = stmt.get(id);
    return row ? rowToEntry(row) : null;
  };
  const list = (repoId, type, limit) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    let query = 'SELECT * FROM memory_entries WHERE repoId = ?';
    const params = [repoId];
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
    const rows = stmt.all(...params);
    return rows.map(rowToEntry);
  };
  const listEntriesForRepo = (repoId) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const query = 'SELECT * FROM memory_entries WHERE repoId = ?';
    const stmt = db.prepare(query);
    const rows = stmt.all(repoId);
    return rows.map(rowToEntry);
  };
  const updateStaleFlag = (id, stale) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const now = Date.now();
    const stmt = db.prepare('UPDATE memory_entries SET stale = ?, updatedAt = ? WHERE id = ?');
    stmt.run(stale ? 1 : 0, now, id);
  };
  const status = (repoId) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const countsStmt = db.prepare(
      'SELECT type, COUNT(*) as count FROM memory_entries WHERE repoId = ? GROUP BY type',
    );
    const countsRows = countsStmt.all(repoId);
    const lastUpdatedStmt = db.prepare(
      'SELECT MAX(updatedAt) as lastUpdatedAt FROM memory_entries WHERE repoId = ?',
    );
    const lastUpdatedRow = lastUpdatedStmt.get(repoId);
    const staleStmt = db.prepare(
      'SELECT COUNT(*) as count FROM memory_entries WHERE repoId = ? AND stale = 1',
    );
    const staleRow = staleStmt.get(repoId);
    const entryCounts = {
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
  const search = (repoId, query, options) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
    const topK = options.topK ?? 10;
    const stmt = db.prepare(`
      SELECT me.*
      FROM memory_entries_fts fts
      JOIN memory_entries me ON fts.rowid = me.rowid
      WHERE memory_entries_fts MATCH ?
      AND me.repoId = ?
      ORDER BY bm25(memory_entries_fts)
      LIMIT ?;
    `);
    const rows = stmt.all(query, repoId, topK * 2); // Fetch more to allow for deduping
    const entries = rows.map(rowToEntry);
    const rerankedEntries = (0, ranking_1.rerank)(entries, options);
    return rerankedEntries.slice(0, topK);
  };
  const wipe = (repoId) => {
    if (!db) throw new shared_1.MemoryError('Database not initialized');
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
    updateStaleFlag,
    search,
    status,
    wipe,
  };
}
//# sourceMappingURL=store.js.map
