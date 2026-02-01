// packages/repo/src/indexing/semantic/store/schema.ts

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS semantic_meta (
  repoId TEXT NOT NULL,
  repoRoot TEXT NOT NULL,
  embedderId TEXT NOT NULL,
  dims INTEGER NOT NULL,
  builtAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  schemaVersion INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_files (
  path TEXT PRIMARY KEY NOT NULL,
  fileHash TEXT NOT NULL,
  language TEXT NOT NULL,
  mtimeMs INTEGER NOT NULL,
  sizeBytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_chunks (
  chunkId TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  parentName TEXT,
  startLine INTEGER NOT NULL,
  endLine INTEGER NOT NULL,
  content TEXT NOT NULL,
  fileHash TEXT NOT NULL,
  FOREIGN KEY(path) REFERENCES semantic_files(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS semantic_embeddings (
  chunkId TEXT PRIMARY KEY NOT NULL,
  vectorB64 TEXT,
  vectorJson TEXT,
  FOREIGN KEY(chunkId) REFERENCES semantic_chunks(chunkId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_chunks_path ON semantic_chunks (path);
`;
