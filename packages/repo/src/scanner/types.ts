export interface ScanOptions {
  excludes?: string[];
  maxFiles?: number;
  maxFileSize?: number;
}

export interface RepoFileMeta {
  path: string;
  absPath: string;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
  isText: boolean;
  languageHint?: string;
}

export interface RepoSnapshot {
  repoRoot: string;
  files: RepoFileMeta[];
  warnings: string[];
}
