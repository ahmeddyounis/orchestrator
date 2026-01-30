import { OrchestratorConfig } from '@orchestrator/shared';
import { Index, IndexFile } from './types';
import { loadIndex as loadIndexFile } from './store';
import { RepoScanner } from '../scanner';
import path from 'path';


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

function loadIndex(config: OrchestratorConfig): Index | null {
  if (!config.indexing?.path) return null;
  const indexPath = path.join(config.rootDir, config.indexing.path);
  // This is a hack until we unify Index and IndexFile
  return loadIndexFile(indexPath) as unknown as Index | null;
}

export async function checkDrift(
  index: Index,
  ignore?: string[],
): Promise<IndexDrift> {
  const scanner = new RepoScanner();
  const snapshot = await scanner.scan(index.repoRoot, {
    excludes: ignore,
  });

  const indexedFiles = new Map(index.files.map((f: IndexFile) => [f.path, f]));
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

export async function getIndexStatus(
  config: OrchestratorConfig,
): Promise<IndexStatus> {
  const index = loadIndex(config);
  if (!index) {
    return { isIndexed: false };
  }

  const drift = await checkDrift(index, config.indexing?.ignore);

  return {
    isIndexed: true,
    indexPath: path.join(config.rootDir, config.indexing!.path!),
    builtAt: new Date(index.builtAt).toISOString(),
    updatedAt: new Date(index.updatedAt).toISOString(),
    fileCount: index.files.length,
    hashedCount: index.files.filter((f) => f.sha256).length,
    drift,
  };
}