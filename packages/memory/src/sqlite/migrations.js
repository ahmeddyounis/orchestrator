"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const migrations = [
    `
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      repoId TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('procedural', 'episodic', 'semantic')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      evidenceJson TEXT,
      gitSha TEXT,
      fileRefsJson TEXT,
      fileHashesJson TEXT,
      stale INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `,
    `
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
      title,
      content,
      content='memory_entries',
      content_rowid='rowid'
    );
  `,
    `
    CREATE TRIGGER IF NOT EXISTS memory_entries_after_insert
    AFTER INSERT ON memory_entries
    BEGIN
      INSERT INTO memory_entries_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;
  `,
    `
    CREATE TRIGGER IF NOT EXISTS memory_entries_after_delete
    AFTER DELETE ON memory_entries
    BEGIN
      INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
    END;
  `,
    `
    CREATE TRIGGER IF NOT EXISTS memory_entries_after_update
    AFTER UPDATE ON memory_entries
    BEGIN
      INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
      INSERT INTO memory_entries_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;
  `,
];
function runMigrations(db) {
    db.exec('BEGIN');
    try {
        migrations.forEach((migration) => {
            db.exec(migration);
        });
        db.exec('COMMIT');
    }
    catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}
//# sourceMappingURL=migrations.js.map