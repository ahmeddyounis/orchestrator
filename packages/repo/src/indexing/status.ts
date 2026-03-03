import { OrchestratorConfig } from '@orchestrator/shared';
import { loadIndex as loadIndexFile, type IndexFile as StoredIndexFile } from './store';
import { RepoScanner } from '../scanner';
import path from 'path';

type DriftIndex = Pick<StoredIndexFile, 'repoRoot' | 'files'>;
type IndexRecord = DriftIndex['files'][number];

export interface IndexDrift {
  hasDrift: boolean;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  changes: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

export interface IndexStatus {
  isIndexed: boolean;
  indexPath?: string;
  builtAt?: string;
  updatedAt?: string;
  fileCount?: number;
  hashedCount?: number;
  drift?: IndexDrift;
}

async function loadIndex(config: OrchestratorConfig): Promise<StoredIndexFile | null> {
  if (!config.indexing?.path) return null;
  const rawPath = config.indexing.path;
  const indexPath = path.isAbsolute(rawPath) ? rawPath : path.join(config.rootDir, rawPath);
  return loadIndexFile(indexPath);
}

export async function checkDrift(index: DriftIndex, ignore?: string[]): Promise<IndexDrift> {
  const scanner = new RepoScanner();
  const snapshot = await scanner.scan(index.repoRoot, {
    excludes: ignore,
  });

  const indexedFiles = new Map<string, IndexRecord>(index.files.map((f) => [f.path, f]));
  const physicalFiles = new Map(snapshot.files.map((f) => [f.path, f]));

  const changes = {
    added: [] as string[],
    removed: [] as string[],
    modified: [] as string[],
  };

  for (const [path, indexedFile] of indexedFiles.entries()) {
    const physicalFile = physicalFiles.get(path);
    if (physicalFile) {
      if (
        indexedFile.mtimeMs !== physicalFile.mtimeMs ||
        indexedFile.sizeBytes !== physicalFile.sizeBytes
      ) {
        changes.modified.push(path);
      }
    } else {
      changes.removed.push(path);
    }
  }

  for (const path of physicalFiles.keys()) {
    if (!indexedFiles.has(path)) {
      changes.added.push(path);
    }
  }

  const changedCount = changes.modified.length;
  const addedCount = changes.added.length;
  const removedCount = changes.removed.length;
  const hasDrift = changedCount > 0 || addedCount > 0 || removedCount > 0;

  return {
    hasDrift,
    changedCount,
    addedCount,
    removedCount,
    changes,
  };
}

export async function getIndexStatus(config: OrchestratorConfig): Promise<IndexStatus> {
  const index = await loadIndex(config);
  if (!index) {
    return { isIndexed: false };
  }

  const drift = await checkDrift(index, config.indexing?.ignore);
  const rawPath = config.indexing?.path;
  const indexPath =
    rawPath && path.isAbsolute(rawPath) ? rawPath : path.join(config.rootDir, rawPath ?? '');

  return {
    isIndexed: true,
    indexPath,
    builtAt: new Date(index.builtAt).toISOString(),
    updatedAt: new Date(index.updatedAt).toISOString(),
    fileCount: index.files.length,
    hashedCount: index.files.filter((f) => f.sha256).length,
    drift,
  };
}
