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
