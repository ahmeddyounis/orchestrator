import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { GitService } from './index';

const run = (cmd: string, args: string[], cwd: string) => {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'ignore' });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} ${args.join(' ')} failed with code ${code}`));
    });
    p.on('error', reject);
  });
};

describe('GitService', () => {
  let tmpDir: string;
  let gitService: GitService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-service-test-'));
    gitService = new GitService({ repoRoot: tmpDir });

    // Init git repo
    await run('git', ['init'], tmpDir);
    // Determine the default branch name (init.defaultBranch might vary)
    // We force it to main to be consistent
    await run('git', ['branch', '-m', 'main'], tmpDir).catch(() => {}); // might fail if no commits yet, which is fine
    await run('git', ['config', 'user.email', 'test@example.com'], tmpDir);
    await run('git', ['config', 'user.name', 'Test User'], tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects clean working tree', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
    await expect(gitService.ensureCleanWorkingTree()).resolves.not.toThrow();
  });

  it('detects dirty working tree', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'dirty.txt'), 'content');

    const status = await gitService.getStatusPorcelain();
    expect(status).toContain('?? dirty.txt');

    await expect(gitService.ensureCleanWorkingTree()).rejects.toThrow('Working tree is dirty');
    await expect(gitService.ensureCleanWorkingTree({ allowDirty: true })).resolves.not.toThrow();
  });

  it('gets current branch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    // Ensure we are on a branch
    await run('git', ['checkout', '-b', 'main'], tmpDir).catch(() => {}); // in case init didn't create it
    const branch = await gitService.currentBranch();
    expect(branch).toBe('main'); // default branch
  });

  it('creates and checks out branch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await gitService.createAndCheckoutBranch('agent/run-123');
    const branch = await gitService.currentBranch();
    expect(branch).toBe('agent/run-123');
  });

  it('handles existing branch in createAndCheckoutBranch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await run('git', ['branch', 'agent/run-123'], tmpDir);
    await gitService.createAndCheckoutBranch('agent/run-123');
    const branch = await gitService.currentBranch();
    expect(branch).toBe('agent/run-123');
  });

  it('stages all changes', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    await gitService.stageAll();
    const status = await gitService.getStatusPorcelain();
    expect(status).toContain('A  file.txt');
  });

  it('commits changes', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    await gitService.stageAll();
    await gitService.commit('Add file.txt');
    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
  });

  it('gets head sha', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    const sha = await gitService.getHeadSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('diffs to head', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    // Diff only shows changes to tracked files if they are modified.
    // Untracked files are not shown in 'git diff HEAD' unless staged?
    // 'git diff HEAD' shows staged and unstaged changes.
    // Untracked files are NOT shown in 'git diff HEAD'.

    // Let's stage it first so it is tracked?
    await gitService.stageAll();

    const diff = await gitService.diffToHead();
    expect(diff).toContain('diff --git a/file.txt b/file.txt');
  });

  it('creates a checkpoint', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');

    const checkpointSha = await gitService.createCheckpoint('My Checkpoint');

    // Should have created a commit
    const head = await gitService.getHeadSha();
    expect(checkpointSha).toBe(head);

    const status = await gitService.getStatusPorcelain();
    expect(status).toBe(''); // Clean after checkpoint
  });

  it('rolls back to checkpoint', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    const initialSha = await gitService.getHeadSha();

    // Make some changes
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    const checkpointSha = await gitService.createCheckpoint('Checkpoint 1');
    expect(checkpointSha).not.toBe(initialSha);

    // Make more changes
    await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'content2');

    // Rollback to checkpoint 1
    await gitService.rollbackToCheckpoint(checkpointSha);

    const currentSha = await gitService.getHeadSha();
    expect(currentSha).toBe(checkpointSha);

    // File 2 should be gone (clean -fd)
    const file2Exists = await fs
      .access(path.join(tmpDir, 'file2.txt'))
      .then(() => true)
      .catch(() => false);
    expect(file2Exists).toBe(false);

    // File 1 should exist
    const file1Exists = await fs
      .access(path.join(tmpDir, 'file.txt'))
      .then(() => true)
      .catch(() => false);
    expect(file1Exists).toBe(true);

    // Rollback to initial
    await gitService.rollbackToCheckpoint(initialSha);

    const currentSha2 = await gitService.getHeadSha();
    expect(currentSha2).toBe(initialSha);

    // File 1 should be gone
    const file1Exists2 = await fs
      .access(path.join(tmpDir, 'file.txt'))
      .then(() => true)
      .catch(() => false);
    expect(file1Exists2).toBe(false);
  });
});
