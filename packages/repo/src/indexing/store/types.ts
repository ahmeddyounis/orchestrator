export const INDEX_SCHEMA_VERSION = 1;

export interface IndexFile {
  schemaVersion: typeof INDEX_SCHEMA_VERSION;
  repoId: string;
  repoRoot: string;
  builtAt: number;
  updatedAt: number;
  headSha?: string;
  files: Array<{
    path: string;
    sizeBytes: number;
    mtimeMs: number;
    sha256?: string;
    isText: boolean;
    languageHint?: string;
  }>;
  stats: {
    fileCount: number;
    textFileCount: number;
    hashedCount: number;
    byLanguage: Record<string, { count: number; bytes: number }>;
  };
}
