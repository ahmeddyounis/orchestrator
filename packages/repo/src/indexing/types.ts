export interface IndexFile {
  path: string;
  hash: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface Index {
  version: number;
  repoRoot: string;
  repoId: string; // e.g., hash of repoRoot
  createdAt: string;
  updatedAt: string;
  hashAlgorithm: 'sha256';
  files: Record<string, IndexFile>;
}

export interface IndexReport {
  repoRoot: string;
  repoId: string;
  indexPath: string;
  fileCount: number;
  hashedCount: number;
  updatedAt: string;
  delta?: {
    added: number;
    removed: number;
    changed: number;
  };
}
