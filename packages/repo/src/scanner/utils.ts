import fs from 'node:fs/promises';
import isBinaryPath from 'is-binary-path';

export async function isBinaryFile(filePath: string): Promise<boolean> {
  // 1. Check extension
  if (isBinaryPath(filePath)) {
    return true;
  }

  // 2. Sample content for NUL bytes
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
    await handle.close();

    if (bytesRead === 0) return false; // Empty file is text-safe

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    // If we can't read, assume binary to be safe? Or text?
    // Usually ignoring unreadable files or treating as binary is safer for "snippet extraction".
    return true;
  }
}
export const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.turbo',
  '.next',
  'coverage',
  '.orchestrator',
];
