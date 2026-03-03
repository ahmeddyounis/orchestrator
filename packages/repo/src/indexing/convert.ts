import { INDEX_SCHEMA_VERSION, type IndexFile as IndexDocument } from './store';
import type { Index } from './types';

function toEpochMs(value: Date | number): number {
  return typeof value === 'number' ? value : value.getTime();
}

export function legacyIndexToDocument(repoId: string, index: Index): IndexDocument {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repoId,
    repoRoot: index.repoRoot,
    builtAt: toEpochMs(index.builtAt as unknown as Date | number),
    updatedAt: toEpochMs(index.updatedAt as unknown as Date | number),
    headSha: index.headSha,
    files: index.files.map((f) => ({ ...f })),
    stats: index.stats,
  };
}

export function documentToLegacyIndex(doc: IndexDocument): Index {
  return {
    version: '1',
    repoRoot: doc.repoRoot,
    builtAt: new Date(doc.builtAt),
    updatedAt: new Date(doc.updatedAt),
    headSha: doc.headSha,
    files: doc.files.map((f) => ({ ...f })),
    stats: doc.stats,
  };
}
