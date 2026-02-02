// packages/shared/src/fs/io.ts
import { promises as fs } from 'fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from './path';
import { ensureDir as fseEnsureDir } from 'fs-extra';

export async function ensureDir(path: string): Promise<void> {
  await fseEnsureDir(dirname(path));
}

export async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  await ensureDir(path);
  const tempPath = join(dirname(path), `.tmp-${randomUUID()}`);
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, path);
}
