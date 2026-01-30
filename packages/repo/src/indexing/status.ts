import { OrchestratorConfig } from '@orchestrator/shared';
import { Index, IndexFile } from './types';
import { loadIndex as loadIndexFile } from './store';
import { RepoScanner } from '../scanner';
import path from 'path';

export interface IndexDrift {
  changedCount: number;
  addedCount: number;
  removedCount: number;
  topChangedPaths: string[];
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

export async function getIndexStatus(
  config: OrchestratorConfig,
): Promise<IndexStatus> {
  const index = loadIndex(config);
  if (!index) {
    return { isIndexed: false };
  }

  const scanner = new RepoScanner();
  const snapshot = await scanner.scan(config.rootDir, {
    excludes: config.indexing?.ignore,
  });

  const indexedFiles = new Map(index.files.map((f: IndexFile) => [f.path, f]));
  const physicalFiles = new Map(snapshot.files.map((f) => [f.path, f]));

  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  const topChangedPaths: string[] = [];

  for (const [path, indexedFile] of indexedFiles.entries()) {
    const physicalFile = physicalFiles.get(path);
    if (physicalFile) {
      if (
        indexedFile.mtimeMs !== physicalFile.mtimeMs ||
        indexedFile.sizeBytes !== physicalFile.sizeBytes
      ) {
        changedCount++;
        if (topChangedPaths.length < 10) {
          topChangedPaths.push(path);
        }
      }
    } else {
      removedCount++;
    }
  }

  for (const path of physicalFiles.keys()) {
    if (!indexedFiles.has(path)) {
      addedCount++;
    }
  }

  const drift: IndexDrift = {
    changedCount,
    addedCount,
    removedCount,
    topChangedPaths,
  };

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


