import fs from 'node:fs/promises';
import path from 'node:path';
import { IndexCorruptedError } from '@orchestrator/shared';
import { INDEX_SCHEMA_VERSION, type IndexFile } from './types';

export { INDEX_SCHEMA_VERSION } from './types';
export type { IndexFile } from './types';

// Re-export error class for backward compatibility
export { IndexCorruptedError } from '@orchestrator/shared';

export function validateIndex(indexFile: unknown): asserts indexFile is IndexFile {
  if (typeof indexFile !== 'object' || indexFile === null) {
    throw new IndexCorruptedError('Index is not an object.');
  }

  const { schemaVersion } = indexFile as IndexFile;
  if (schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new IndexCorruptedError(
      `Unsupported index schema version: found ${schemaVersion}, expected ${INDEX_SCHEMA_VERSION}.`,
    );
  }
  // Add more validation logic here as needed based on the spec
}

export async function loadIndex(indexPath: string): Promise<IndexFile | null> {
  try {
    await fs.access(indexPath);
  } catch {
    return null;
  }

  const content = await fs.readFile(indexPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new IndexCorruptedError(`Failed to parse index file: ${(error as Error).message}`);
  }

  validateIndex(parsed);

  return parsed;
}

export async function saveIndexAtomic(indexPath: string, indexFile: IndexFile): Promise<void> {
  validateIndex(indexFile);

  const tempPath = `${indexPath}.tmp`;
  const dir = path.dirname(indexPath);

  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(tempPath, JSON.stringify(indexFile, null, 2));
  await fs.rename(tempPath, indexPath);
}
