import { describe, it, expect, beforeEach } from 'vitest';
import { IndexBuilder } from './builder';
import { vol, fs } from 'memfs';

describe('IndexBuilder', () => {
  const repoRoot = '/test-repo';

  beforeEach(() => {
    vol.reset();
    const files = {
      'package.json': JSON.stringify({ name: 'test-repo' }),
      'src/index.ts': 'console.log("hello");',
      'src/data.json': '{"key": "value"}',
      'README.md': '# Test Repo',
      'node_modules/some-lib/index.js': '// some lib',
      '.gitignore': 'node_modules',
    };
    vol.fromJSON(files, repoRoot);
  });

  it('should build an index from a repository', async () => {
    const builder = new IndexBuilder({ fs: fs.promises as any, fsSync: fs as any });
    const index = await builder.build(repoRoot);

    expect(index.repoRoot).toBe(repoRoot);
    expect(index.files).toHaveLength(5);

    // Files should be sorted
    expect(index.files.map((f) => f.path)).toEqual([
      '.gitignore',
      'package.json',
      'README.md',
      'src/data.json',
      'src/index.ts',
    ]);

    const indexTs = index.files.find((f) => f.path === 'src/index.ts');
    expect(indexTs).toBeDefined();

    if (indexTs) {
      expect(indexTs.isText).toBe(true);
      expect(indexTs.languageHint).toBe('typescript');
      expect(indexTs.sha256).toBe(
        '3781f94ea812bb33437de9049e04bc3af41a0e7397164b057379c08c3b0ac489',
      );
      expect(indexTs.sizeBytes).toBe(21);
    }

    expect(index.stats.fileCount).toBe(5);
    expect(index.stats.textFileCount).toBe(5);
    expect(index.stats.hashedCount).toBe(5);
    expect(index.stats.byLanguage['typescript']).toEqual({ count: 1, bytes: 21 });
    expect(index.stats.byLanguage['markdown']).toEqual({ count: 1, bytes: 11 });
    expect(index.stats.byLanguage['json']).toEqual({ count: 2, bytes: 36 });
  });

  it('should not hash files larger than maxFileSizeBytes', async () => {
    const builder = new IndexBuilder({
      maxFileSizeBytes: 10,
      fs: fs.promises as any,
      fsSync: fs as any,
    });
    const index = await builder.build(repoRoot);

    const indexTs = index.files.find((f) => f.path === 'src/index.ts');
    expect(indexTs).toBeDefined();
    if (indexTs) {
      expect(indexTs.sha256).toBeUndefined();
    }
    expect(index.stats.hashedCount).toBe(0); // All files are larger than 10 bytes
  });
});
