
export interface LanguageStats {
  count: number;
  bytes: number;
}

export interface IndexStats {
  fileCount: number;
  textFileCount: number;
  hashedCount: number;
  byLanguage: Record<string, LanguageStats>;
}

export interface IndexFile {
  path: string;
  sha256?: string;
  sizeBytes: number;
  mtimeMs: number;
  isText: boolean;
  languageHint?: string;
}

export interface Index {
  version: '1';
  repoRoot: string;
  builtAt: Date;
  updatedAt: Date;
  headSha?: string;
  stats: IndexStats;
  files: IndexFile[];
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
