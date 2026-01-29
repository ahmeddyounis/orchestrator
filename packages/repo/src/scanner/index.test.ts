import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RepoScanner } from './index';

describe('RepoScanner', () => {
  let tmpDir: string;
  let scanner: RepoScanner;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-scanner-test-'));
    scanner = new RepoScanner();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createFiles(files: Record<string, string | Buffer>) {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  }

  it('scans simple repo', async () => {
    await createFiles({
      'README.md': '# Hello',
      'src/index.ts': 'console.log("hi");',
      'package.json': '{}',
    });

    const snapshot = await scanner.scan(tmpDir);
    expect(snapshot.repoRoot).toBe(tmpDir);
    expect(snapshot.files).toHaveLength(3);
    expect(snapshot.files.map((f) => f.path)).toEqual([
      'package.json',
      'README.md',
      'src/index.ts',
    ]); // Sorted order
  });

  it('respects default ignores', async () => {
    await createFiles({
      'node_modules/foo/index.js': 'ignored',
      '.git/config': 'ignored',
      'dist/output.js': 'ignored',
      'src/index.ts': 'kept',
    });

    const snapshot = await scanner.scan(tmpDir);
    expect(snapshot.files.map((f) => f.path)).toEqual(['src/index.ts']);
  });

  it('respects .gitignore', async () => {
    await createFiles({
      '.gitignore': '*.log\nsecret/',
      'app.log': 'ignored',
      'secret/data.txt': 'ignored',
      'src/index.ts': 'kept',
      'other.txt': 'kept',
    });

    const snapshot = await scanner.scan(tmpDir);
    expect(snapshot.files.map((f) => f.path)).toEqual(['.gitignore', 'other.txt', 'src/index.ts']);
  });

  it('respects .orchestratorignore', async () => {
    await createFiles({
      '.orchestratorignore': 'foo.txt',
      'foo.txt': 'ignored',
      'bar.txt': 'kept',
    });

    const snapshot = await scanner.scan(tmpDir);
    expect(snapshot.files.map((f) => f.path)).toEqual(['.orchestratorignore', 'bar.txt']);
  });

  it('detects binary files', async () => {
    // Create a binary file (with NUL byte)
    const binaryContent = Buffer.from([0x00, 0x01, 0x02]);
    await createFiles({
      'data.bin': binaryContent,
      'script.sh': '#!/bin/bash\necho hi',
      'image.png': 'fake png content', // extension check might catch this
    });

    const snapshot = await scanner.scan(tmpDir);
    const binFile = snapshot.files.find((f) => f.path === 'data.bin');
    const shFile = snapshot.files.find((f) => f.path === 'script.sh');
    const pngFile = snapshot.files.find((f) => f.path === 'image.png');

    expect(binFile?.isText).toBe(false);
    expect(shFile?.isText).toBe(true);
    expect(pngFile?.isText).toBe(false); // is-binary-path should catch .png
  });

  it('sorts output deterministically', async () => {
    await createFiles({
      'b.txt': 'b',
      'a.txt': 'a',
      'c/d.txt': 'd',
    });
    const snapshot = await scanner.scan(tmpDir);
    expect(snapshot.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt', 'c/d.txt']);
  });
});
