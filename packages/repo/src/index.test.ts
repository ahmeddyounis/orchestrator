import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { findRepoRoot } from './index';

describe('findRepoRoot', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-repo-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should find root with .git', async () => {
    const root = path.join(tmpDir, 'repo-git');
    await fs.mkdir(path.join(root, '.git'), { recursive: true });

    const subdir = path.join(root, 'packages', 'cli');
    await fs.mkdir(subdir, { recursive: true });

    const result = await findRepoRoot(subdir);
    expect(result).toBe(root);
  });

  it('should find root with pnpm-workspace.yaml', async () => {
    const root = path.join(tmpDir, 'repo-pnpm');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), '');

    const subdir = path.join(root, 'packages', 'cli');
    await fs.mkdir(subdir, { recursive: true });

    const result = await findRepoRoot(subdir);
    expect(result).toBe(root);
  });

  it('should find root with package.json workspaces', async () => {
    const root = path.join(tmpDir, 'repo-pkg');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ workspaces: [] }));

    const subdir = path.join(root, 'packages', 'cli');
    await fs.mkdir(subdir, { recursive: true });

    const result = await findRepoRoot(subdir);
    expect(result).toBe(root);
  });

  it('should throw if not found', async () => {
    const nonRepo = path.join(tmpDir, 'non-repo');
    await fs.mkdir(nonRepo, { recursive: true });
    await expect(findRepoRoot(nonRepo)).rejects.toThrow('Could not detect repository root');
  });

  it('should ignore package.json without workspaces', async () => {
    const root = path.join(tmpDir, 'repo-no-workspace');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'foo' }));

    const subdir = path.join(root, 'packages', 'cli');
    await fs.mkdir(subdir, { recursive: true });

    await expect(findRepoRoot(subdir)).rejects.toThrow('Could not detect repository root');
  });
});
