import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { collectHunkFailures, readFileContext } from './patch_utils';

describe('patch_utils', () => {
  describe('collectHunkFailures', () => {
    it('keeps the earliest line per file and normalizes kinds', () => {
      const failures = collectHunkFailures([
        { file: 'a/src/a.ts', line: 10, kind: 'HUNK_FAILED' },
        { file: 'a/src/a.ts', line: 5, kind: 'EARLIER' }, // update (normalizedLine < existing.line)
        { file: 'a/src/a.ts', line: 12, kind: 'LATER' }, // ignored (normalizedLine >= existing.line)
        { file: 'b/src/b.ts', line: 3, kind: 123 }, // non-string kind -> undefined
      ]);

      expect(failures).toEqual([
        { filePath: 'src/a.ts', line: 5, kind: 'EARLIER' },
        { filePath: 'src/b.ts', line: 3, kind: undefined },
      ]);
    });
  });

  describe('readFileContext', () => {
    it('returns empty when attempting to read outside the repo root', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-patch-utils-'));
      await expect(
        Promise.resolve(readFileContext(tmpDir, '../outside.txt', 1, 3, 1000)),
      ).resolves.toBe('');
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns empty for empty files', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-patch-utils-'));
      await fs.writeFile(path.join(tmpDir, 'empty.txt'), '', 'utf8');

      expect(readFileContext(tmpDir, 'empty.txt', 1, 3, 1000)).toBe('');

      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('truncates long excerpts', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-patch-utils-'));
      await fs.writeFile(
        path.join(tmpDir, 'long.txt'),
        Array.from({ length: 50 }, () => 'x'.repeat(120)).join('\n'),
        'utf8',
      );

      const excerpt = readFileContext(tmpDir, 'long.txt', 25, 20, 40);
      expect(excerpt).toContain('... (truncated)');
      expect(excerpt.length).toBeGreaterThan(40);

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
