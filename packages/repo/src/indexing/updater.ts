import { IndexNotFoundError } from '@orchestrator/shared';
import { RepoScanner, RepoFileMeta } from '../scanner';
import { IndexFile, loadIndex, saveIndexAtomic } from './store';
import { hashFile } from './hasher';
import { resolve } from 'path';

type IndexRecord = IndexFile['files'][0];

// Re-export error class for backward compatibility
export { IndexNotFoundError } from '@orchestrator/shared';

export interface IndexUpdateResult {
  added: string[];
  removed: string[];
  changed: string[];
  rehashedCount: number;
}

const MAX_FILE_SIZE_BYTES_TO_HASH = 1024 * 1024; // 1MB

export class IndexUpdater {
  private readonly repoScanner: RepoScanner;
  private readonly indexPath: string;

  constructor(indexPath: string) {
    this.repoScanner = new RepoScanner();
    this.indexPath = indexPath;
  }

  async update(repoRoot: string): Promise<IndexUpdateResult> {
    const existingIndex = await loadIndex(this.indexPath);
    if (!existingIndex) {
      throw new IndexNotFoundError('Index file not found. Please build the index first.');
    }

    const scanResult = await this.repoScanner.scan(repoRoot);

    const oldRecords = new Map<string, IndexRecord>(existingIndex.files.map((f) => [f.path, f]));
    const newRecords: IndexRecord[] = [];

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    let rehashedCount = 0;

    for (const fileMeta of scanResult.files) {
      const oldRecord = oldRecords.get(fileMeta.path);

      if (
        oldRecord &&
        oldRecord.mtimeMs === fileMeta.mtimeMs &&
        oldRecord.sizeBytes === fileMeta.sizeBytes
      ) {
        // Unchanged, reuse old record
        newRecords.push(oldRecord);
        oldRecords.delete(fileMeta.path);
      } else {
        // New or changed file, re-process
        rehashedCount++;
        const newRecord = await this.createRecord(repoRoot, fileMeta);
        newRecords.push(newRecord);

        if (oldRecord) {
          changed.push(fileMeta.path);
        } else {
          added.push(fileMeta.path);
        }
        oldRecords.delete(fileMeta.path);
      }
    }

    // Remaining oldRecords are deleted files
    for (const deletedPath of oldRecords.keys()) {
      removed.push(deletedPath);
    }

    // Deep copy and update stats
    const newStats = structuredClone(existingIndex.stats);
    newStats.fileCount = scanResult.files.length;
    // Note: A more accurate stat update would re-calculate textFileCount, byLanguage, etc.
    // This is a simplification for now.

    const newIndex: IndexFile = {
      ...existingIndex,
      updatedAt: Date.now(),
      files: newRecords.sort((a, b) => a.path.localeCompare(b.path)),
      stats: newStats,
    };

    await saveIndexAtomic(this.indexPath, newIndex);

    return {
      added,
      removed,
      changed,
      rehashedCount,
    };
  }

  private async createRecord(repoRoot: string, fileMeta: RepoFileMeta): Promise<IndexRecord> {
    const record: IndexRecord = {
      path: fileMeta.path,
      sizeBytes: fileMeta.sizeBytes,
      mtimeMs: fileMeta.mtimeMs,
      isText: fileMeta.isText,
      languageHint: fileMeta.languageHint,
    };

    if (fileMeta.isText && fileMeta.sizeBytes <= MAX_FILE_SIZE_BYTES_TO_HASH) {
      try {
        record.sha256 = await hashFile(resolve(repoRoot, fileMeta.path));
      } catch {
        // Ignore hashing errors (e.g., file deleted during scan)
      }
    }
    return record;
  }
}
